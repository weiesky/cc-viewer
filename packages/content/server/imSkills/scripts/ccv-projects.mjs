#!/usr/bin/env node
// ccv-projects.mjs — 语言无关的 ccv 项目管理助手（cc-viewer IM 技能 manage-ccv-projects 的共享脚本）。
//
// 所有语言版本的 SKILL.md 都调用本脚本，因此「列表 / 探测 / 启动 / 取地址」的行为完全一致，
// 各语言只翻译说明文字。用 Node 实现而非 shell，是为了跨平台（IM worker 也可能跑在 Windows，
// 那里没有 curl/seq/sed）。
//
// 子命令：
//   node ccv-projects.mjs list [--json]   列出启动过的 ccv 项目（过滤 IM_* / 不存在的目录，按最近使用倒序，
//                                          顺带标注哪些正在运行及其地址）。空列表打印 "(empty)"。
//   node ccv-projects.mjs probe <dir>     若该目录已有 ccv 实例在跑，打印其地址并退出 0；否则退出 3。
//   node ccv-projects.mjs start <dir>     已在跑→打印现有地址；没在跑→清理环境变量后启动、等就绪、打印地址。
//                                          成功时 **只在 stdout 打印一行地址**，便于 IM 原样转发给用户。
//
// 设计要点：
//   * 探测/取地址走本机 loopback 接口（127.0.0.1 免鉴权）：/api/project-dir、/api/local-url、/api/auth/state，
//     因此本脚本无需任何 token。
//   * 启动前必须清掉继承自 IM worker 的 CCV_HOST=127.0.0.1 / 端口段 / IM 标志，否则新实例只绑 loopback，
//     局域网根本打不开（这是最容易踩的坑）。只保留 CCV_LOG_DIR 以与主程序共用注册表/偏好。
//   * 「智能自适应 token」：开了密码登录(/api/auth/state.enabled=true)→回裸地址；否则回带 token 的地址。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT_MIN = 7008;   // 普通 ccv 项目实例的默认端口段起点
const PORT_MAX = 7099;   // 覆盖到 IM worker 段(7050-7099)以便 list 标注，但 IM_* 目录会被过滤掉
const PROJECT_PORT_MAX = 7049; // 我们启动的项目实例落在 7008-7049，启动轮询只扫这段更快

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg, code = 1) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

// 与 findcc.js 的 resolveLogDir/getClaudeConfigDir 保持一致：CCV_LOG_DIR 优先，否则 (CLAUDE_CONFIG_DIR|~/.claude)/cc-viewer
export function logDir() {
  const expand = (p) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
  const env = (process.env.CCV_LOG_DIR || '').trim();
  if (env && env !== 'tmp' && env !== 'temp') return path.resolve(expand(env));
  const cfg = (process.env.CLAUDE_CONFIG_DIR || '').trim();
  const base = cfg ? expand(cfg) : path.join(os.homedir(), '.claude');
  return path.join(base, 'cc-viewer');
}

export function loadWorkspaces() {
  const f = path.join(logDir(), 'workspaces.json');
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return Array.isArray(data.workspaces) ? data.workspaces : [];
  } catch {
    return [];
  }
}

// 目录归一化：尽量取 realpath，Windows 大小写不敏感。用于跨实例比对项目目录。
export function normDir(d) {
  let x;
  try { x = fs.realpathSync(d); } catch { x = path.resolve(d); }
  return process.platform === 'win32' ? x.toLowerCase() : x;
}

function getJson(port, urlPath, timeoutMs = 500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = '';
      res.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

// 扫描端口段，返回 Map<归一化项目目录, 端口>
async function scanRunning(min = PORT_MIN, max = PORT_MAX) {
  const ports = [];
  for (let p = min; p <= max; p++) ports.push(p);
  const found = await Promise.all(ports.map(async (p) => {
    const r = await getJson(p, '/api/project-dir', 400);
    return r && typeof r.dir === 'string' ? { port: p, dir: r.dir } : null;
  }));
  const map = new Map();
  for (const r of found) if (r) map.set(normDir(r.dir), r.port);
  return map;
}

// 纯函数：开了密码登录就去掉 ?token=...（回裸地址，用户用密码登录），否则原样带 token。抽出便于单测。
export function adaptiveUrl(url, passwordEnabled) {
  if (!url) return url;
  if (passwordEnabled) {
    const q = url.indexOf('?');
    if (q !== -1) return url.slice(0, q);
  }
  return url;
}

// 取某实例对用户可用的地址（智能自适应 token）
async function instanceUrl(port) {
  const lu = await getJson(port, '/api/local-url', 1500);
  const url = lu && typeof lu.url === 'string' ? lu.url : null;
  if (!url) return null;
  const auth = await getJson(port, '/api/auth/state', 1500);
  return adaptiveUrl(url, !!(auth && auth.enabled === true));
}

export function cleanEnv() {
  const env = { ...process.env };
  // 丢掉所有继承自 IM worker 的 CCV_*（会让新实例只绑 loopback / 抢 IM 端口 / 误入 IM 模式 /
  // 读错 base path / 带过来密码态等），只保留 CCV_LOG_DIR 以与主程序共用注册表/偏好。
  for (const k of Object.keys(env)) {
    if (k.startsWith('CCV_') && k !== 'CCV_LOG_DIR') delete env[k];
  }
  return env;
}

async function launch(dir) {
  const logFile = path.join(os.tmpdir(), `ccv-launch-${process.pid}-${Math.floor(Math.random() * 1e6)}.log`);
  const fd = fs.openSync(logFile, 'a');
  const child = spawn('ccv', ['--no-open'], {
    cwd: dir,
    env: cleanEnv(),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    shell: process.platform === 'win32', // Windows 上 ccv 是 ccv.cmd，需经 shell 解析
  });
  child.unref();
  fs.closeSync(fd);

  // finally 里 unlink，避免每次启动在 tmpdir 留下 ccv-launch-*.log（POSIX 上 unlink 已打开文件不影响子进程继续写；
  // Windows 上文件被占用 unlink 抛错被吞，行为不劣于从前）。
  const target = normDir(dir);
  try {
    for (let i = 0; i < 50; i++) {          // 最多 ~25s
      await sleep(500);
      const running = await scanRunning(PORT_MIN, PROJECT_PORT_MAX);
      const port = running.get(target);
      if (port) return { port };
    }
    let tail = '';
    try { tail = fs.readFileSync(logFile, 'utf-8').split('\n').slice(-15).join('\n'); } catch {}
    throw new Error(`ccv 启动超时（>25s）。日志尾部：\n${tail}`);
  } finally {
    try { fs.unlinkSync(logFile); } catch { /* 已删/被占用 */ }
  }
}

async function cmdList(asJson) {
  const running = await scanRunning();
  const items = loadWorkspaces()
    .filter((w) => w && typeof w.path === 'string')
    .filter((w) => !String(w.projectName || path.basename(w.path)).startsWith('IM_'))
    .filter((w) => fs.existsSync(w.path))
    .sort((a, b) => String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')));

  const out = [];
  for (const w of items) {
    const port = running.get(normDir(w.path));
    out.push({
      name: w.projectName || path.basename(w.path),
      path: w.path,
      lastUsed: w.lastUsed || null,
      running: !!port,
      url: port ? await instanceUrl(port) : null,
    });
  }

  if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return; }
  if (!out.length) { process.stdout.write('(empty)\n'); return; }
  for (const it of out) {
    const flag = it.running ? `  [running] ${it.url || ''}` : '';
    process.stdout.write(`${it.name}\t${it.path}\t${it.lastUsed || ''}${flag}\n`);
  }
}

async function cmdProbe(dirArg) {
  const dir = path.resolve(dirArg);
  const running = await scanRunning();
  const port = running.get(normDir(dir));
  if (!port) process.exit(3);
  const url = await instanceUrl(port);
  if (!url) process.exit(3);
  process.stdout.write(url + '\n');
}

async function cmdStart(dirArg) {
  const dir = path.resolve(dirArg);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`目录不存在或不是文件夹：${dir}`);
  if (path.basename(dir).startsWith('IM_')) fail(`拒绝启动内部 IM 目录：${dir}`);

  let port = (await scanRunning()).get(normDir(dir)); // 先探测是否已在跑
  if (!port) port = (await launch(dir)).port;          // 没在跑就启动（launch 失败会抛错）

  const url = await instanceUrl(port);
  if (!url) fail(`实例已在 127.0.0.1:${port} 运行，但取地址失败`);
  process.stdout.write(url + '\n');                    // 成功：只打印这一行地址
}

// 仅在被直接 `node ccv-projects.mjs ...` 执行时跑 CLI；被单测 import 时不触发（否则 IIFE 会 process.exit）。
function isMainModule() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  (async () => {
    const [, , cmd, arg] = process.argv;
    try {
      switch (cmd) {
        case 'list': await cmdList(process.argv.includes('--json')); break;
        case 'probe': if (!arg || arg.startsWith('--')) fail('usage: probe <dir>', 2); await cmdProbe(arg); break;
        case 'start': if (!arg || arg.startsWith('--')) fail('usage: start <dir>', 2); await cmdStart(arg); break;
        default: fail('usage: ccv-projects.mjs <list|probe|start> [dir] [--json]', 2);
      }
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
    }
  })();
}
