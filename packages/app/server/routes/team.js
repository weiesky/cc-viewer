// Concept docs + CCV process management + team-status routes (moved verbatim from server.js).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { CONCEPTS_DIR } from '../_paths.js';
import { buildTeamStatusResponse } from '../lib/team-runtime.js';

// GET /api/concept?lang=zh&doc=Tool-Bash
function concept(req, res, parsedUrl, isLocal, deps) {
  const lang = parsedUrl.searchParams.get('lang') || 'zh';
  const doc = parsedUrl.searchParams.get('doc') || '';
  // 安全校验：只允许字母、数字、连字符
  if (!/^[a-zA-Z0-9-]+$/.test(doc) || !/^[a-z]{2}(-[a-zA-Z]{2,})?$/.test(lang)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid parameters' }));
    return;
  }
  let mdPath = join(CONCEPTS_DIR, lang, `${doc}.md`);
  if (!existsSync(mdPath) && lang !== 'zh') {
    mdPath = join(CONCEPTS_DIR, 'zh', `${doc}.md`);
  }
  if (existsSync(mdPath)) {
    const content = readFileSync(mdPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

// CCV 进程列表
async function ccvProcesses(req, res, parsedUrl, isLocal, deps) {
  if (platform() === 'win32') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ processes: [] }));
    return;
  }
  try {
    const { stdout } = await deps.execAsync('lsof -iTCP:7008-7099 -sTCP:LISTEN -P -n', { timeout: 5000 }).catch(() => ({ stdout: '' }));
    const lines = stdout.trim().split('\n').filter(Boolean);
    // Parse lsof output: skip header, filter node processes, dedupe by PID:port
    const seen = new Map(); // pid -> port
    for (const line of lines.slice(1)) {
      const parts = line.trim().split(/\s+/);
      const cmd = parts[0];
      if (cmd !== 'node') continue;
      const pid = parseInt(parts[1], 10);
      if (!pid) continue;
      // lsof 输出: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME (STATE)
      // 端口在 NAME 列（倒数第二列），如 *:7008，最后一列是 (LISTEN)
      const nameField = parts[parts.length - 2] || '';
      const portMatch = nameField.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = portMatch[1];
      if (!seen.has(pid)) seen.set(pid, port);
    }
    // 获取所有候选进程的 PPID，过滤掉 PPID 也在 CCV 进程集合中的子进程（即 ccv -c/-d 启动的 claude 子进程）
    const ccvPids = new Set(seen.keys());
    const filteredPids = [];
    for (const [pid] of seen) {
      try {
        const { stdout: ppidOut } = await deps.execAsync(`ps -o ppid= -p ${pid}`, { timeout: 2000 }).catch(() => ({ stdout: '' }));
        const ppid = parseInt(ppidOut.trim(), 10);
        if (ppid && ccvPids.has(ppid)) continue; // 是某个 CCV 进程的子进程，跳过
      } catch {}
      filteredPids.push(pid);
    }
    const processes = [];
    for (const pid of filteredPids) {
      const port = seen.get(pid);
      let startTime = '';
      let command = '';
      try {
        const { stdout: psOut } = await deps.execAsync(`ps -p ${pid} -o lstart=,command=`, { timeout: 3000 }).catch(() => ({ stdout: '' }));
        const psLine = psOut.trim();
        // lstart format: "Day Mon DD HH:MM:SS YYYY rest..."
        const lsMatch = psLine.match(/^\w+\s+(\w+)\s+(\d+)\s+([\d:]+)\s+(\d{4})\s+(.*)/);
        if (lsMatch) {
          const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
          const mon = String(months[lsMatch[1]] || 1).padStart(2, '0');
          const day = String(lsMatch[2]).padStart(2, '0');
          const time = lsMatch[3];
          const year = lsMatch[4];
          startTime = `${year}年${mon}月${day}日 ${time}`;
          const rawCmd = lsMatch[5];
          // Extract path after lib/ (e.g. node_modules/cc-viewer/cli.js -d → cc-viewer/cli.js -d)
          const libMatch = rawCmd.match(/lib\/(.+)/);
          command = libMatch ? libMatch[1] : rawCmd;
        }
      } catch {}
      const isCurrent = pid === process.pid;
      processes.push({ port, pid, command, startTime, isCurrent });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ processes }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// CCV 进程关闭
function ccvProcessesKill(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    try {
      const { pid } = JSON.parse(body);
      if (!Number.isInteger(pid) || pid <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid PID' }));
        return;
      }
      if (pid === process.pid) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cannot kill current process' }));
        return;
      }
      // 安全检查：确认是监听 CCV 端口范围 (7008-7099) 的 node 进程
      const { stdout: lsofOut } = await deps.execAsync(`lsof -iTCP:7008-7099 -sTCP:LISTEN -P -n -p ${pid}`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
      const lsofLines = lsofOut.trim().split('\n').filter(Boolean).slice(1);
      const isNodeOnCcvPort = lsofLines.some(line => line.trim().split(/\s+/)[0] === 'node');
      if (!isNodeOnCcvPort) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not a CCV process' }));
        return;
      }
      process.kill(pid, 'SIGTERM');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// Team 运行时状态检测（fs-only：目录存在性 + inbox mtime）
function teamStatus(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', async () => {
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      // 固定文案避免把 JSON.parse 的原始 err.message 回显给客户端
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
    try {
      const result = await buildTeamStatusResponse(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

export const teamRoutes = [
  { method: 'GET', match: 'exact', path: '/api/concept', handler: concept },
  { method: 'GET', match: 'exact', path: '/api/ccv-processes', handler: ccvProcesses },
  { method: 'POST', match: 'exact', path: '/api/ccv-processes/kill', handler: ccvProcessesKill },
  { method: 'POST', match: 'exact', path: '/api/team-status', handler: teamStatus },
];
