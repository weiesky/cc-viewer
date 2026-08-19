// 补齐 server/lib/perm-bridge.js 的分支覆盖：聚焦既有 test/perm-bridge.test.js 未覆盖的
// stdin 读取失败 catch 臂（perm-bridge.js:37-39）。
//
// perm-bridge.js 是一个独立可执行脚本（模块顶层即执行全部逻辑，无 export），
// 唯一可测方式是 spawn 子进程并通过 stdin / env 驱动其执行路径。
//
// 关键技巧：把子进程的 fd 0(stdin) 接到一个【只写】的 /dev/null 句柄上，
// 则 readFileSync(0, 'utf-8') 在内核层因 fd 不可读而抛 EBADF/EINVAL，
// 命中 try/catch 的 catch 臂 → process.exit(1)。
// （对比：把 stdin 接到可读的 /dev/null 只会读到空串，走的是 41-43 的空串分支，
//  而非 37-39 的 catch 分支。）
//
// 风格参照邻近的 test/perm-bridge.test.js（纯 spawn / 收集 stdout|stderr / 断言 exit code）。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(__dirname, '..', 'packages', 'app', 'server', 'lib', 'perm-bridge.js');

/**
 * 以指定 stdin 句柄运行 perm-bridge，收集 exit code / stdout / stderr。
 * env 必须 spread process.env（否则丢 NODE_V8_COVERAGE，子进程覆盖不计入）。
 */
function runBridgeWithStdin(stdinFd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, CCV_BYPASS_PERMISSIONS: '', ...env },
      stdio: [stdinFd, 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('perm-bridge.js 分支补齐：stdin 读取失败 catch 臂', () => {
  // perm-bridge.js:35-39
  //   try { stdinData = readFileSync(0, 'utf-8'); } catch { process.exit(1); }
  // 把 fd 0 接到只写句柄 → readFileSync 读取时抛错 → catch → exit 1。
  it('fd0 为只写句柄时 readFileSync(0) 抛错 → 命中 catch → exit 1（perm-bridge.js:37-39）', async () => {
    const writeOnlyFd = openSync('/dev/null', 'w'); // 只写，不可读
    try {
      const { code, stdout, stderr } = await runBridgeWithStdin(writeOnlyFd, { CCVIEWER_PORT: '9999' });
      // catch 臂直接 process.exit(1)：无任何 stdout/stderr 输出，仅退出码 1。
      assert.equal(code, 1, '只写 stdin 应触发 readFileSync 抛错 → catch → exit 1');
      assert.equal(stdout, '', 'catch 臂不写 stdout');
      assert.equal(stderr, '', 'catch 臂不写 stderr');
    } finally {
      try { closeSync(writeOnlyFd); } catch { /* 父进程句柄清理 */ }
    }
  });

  // 对照组：fd0 为【可读】的 /dev/null → readFileSync 成功返回空串 →
  // 走的是空串早退分支(41-43)，而非 catch(37-39)。两者均 exit 1，但路径不同。
  // 此用例确保对照成立，间接证明上一个用例命中的确是 catch 而非空串分支。
  it('fd0 为可读 /dev/null 时读到空串 → 走空串早退分支(41-43) 而非 catch → exit 1', async () => {
    const readableFd = openSync('/dev/null', 'r'); // 可读：readFileSync 成功返回 ''
    try {
      const { code, stdout, stderr } = await runBridgeWithStdin(readableFd, { CCVIEWER_PORT: '9999' });
      assert.equal(code, 1, '空 stdin 走空串分支 exit 1');
      assert.equal(stdout, '');
      assert.equal(stderr, '');
    } finally {
      try { closeSync(readableFd); } catch { /* noop */ }
    }
  });
});

// perm-bridge.js:25-26
//   const isHttps = rawProtocol === 'https';
//   const httpClient = isHttps ? https : http;
// 既有 test/perm-bridge.test.js 从不设 CCVIEWER_PROTOCOL=https，故三元的 https 臂(byte 1080-1087)
// 一直未覆盖。这里起一个【自签名 HTTPS】mock server，并以 CCVIEWER_PROTOCOL=https 驱动 bridge，
// 命中 isHttps 三元的 https 分支 + httpClient=https.request 的 200 成功路径。
// bridge 内 rejectUnauthorized:false，故自签名证书可被接受。
describe('perm-bridge.js 分支补齐：CCVIEWER_PROTOCOL=https → https 客户端臂', () => {
  let certDir = null;
  let cert = null;
  let key = null;
  let opensslOk = false;

  before(() => {
    // 私有临时目录放证书（并行隔离：mkdtemp 唯一目录，绝不写共享路径）。
    certDir = mkdtempSync(join(tmpdir(), 'ccv-branch-pb-cert-'));
    const certPath = join(certDir, 'cert.pem');
    const keyPath = join(certDir, 'key.pem');
    // 用系统 openssl 现场生成自签名证书；若环境缺 openssl，则标记跳过（不硬失败）。
    const r = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', certPath,
      '-days', '2', '-nodes', '-subj', '/CN=127.0.0.1',
    ], { stdio: 'ignore' });
    if (r.status === 0) {
      try {
        cert = readFileSync(certPath);
        key = readFileSync(keyPath);
        opensslOk = true;
      } catch { opensslOk = false; }
    }
  });

  after(() => {
    if (certDir) { try { rmSync(certDir, { recursive: true, force: true }); } catch { /* noop */ } }
  });

  it('https mock server approves → bridge 走 https 客户端臂 → permissionDecision=allow (perm-bridge.js:25-26)', async (t) => {
    if (!opensslOk) { t.skip('环境无 openssl，无法生成自签名证书'); return; }

    const server = createHttpsServer({ cert, key }, (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ decision: 'allow' }));
      });
    });
    const serverPort = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    try {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });
      const { code, stdout } = await runBridgeWithStdinString(input, {
        CCVIEWER_PORT: String(serverPort),
        CCVIEWER_PROTOCOL: 'https',
      });
      assert.equal(code, 0, 'https 成功审批应 exit 0');
      const out = JSON.parse(stdout.trim());
      assert.equal(out.hookSpecificOutput.permissionDecision, 'allow', 'https 路径下 server allow 应被透传');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

/**
 * 以字符串 stdin 运行 bridge（区别于上面的 fd 句柄版本），收集 exit/stdout/stderr。
 * env 必须 spread process.env，否则丢 NODE_V8_COVERAGE。
 */
function runBridgeWithStdinString(stdin, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath], {
      env: { ...process.env, CCV_BYPASS_PERMISSIONS: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}
