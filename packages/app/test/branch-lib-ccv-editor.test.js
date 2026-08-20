// 顶部静态 import 项目 shim（项目惯例；本目标无 src/utils 资产，但保持一致）。
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'server', 'lib', 'ccv-editor.js');

// ccv-editor.js 是 $EDITOR 包装 CLI：模块加载即跑 main()，并调用 process.exit，
// 唯一可观测面是 argv/env 入 + stdout/stderr/exitcode 出，故整文件用子进程黑盒驱动。
// 现有 test/ccv-editor.test.js 已覆盖 usage/端口/open/poll 主路径；本文件只补
// 单跑口径下仍未覆盖的【TIMEOUT 超时分支】(源码 52-55 行)。
//
// 该分支正常运行不可达(TIMEOUT=30min)。采用 launcher harness：写一个临时 .mjs，
// 在【canonical 动态 import 目标之前】patch Date.now 让时钟跳过 30 分钟，然后
// dynamic import('../server/lib/ccv-editor.js')。这样目标仍走真实文件、覆盖计入；
// 仅在测试侧控制时钟，不改源码。env 必须 spread process.env，否则子进程 NODE_V8_COVERAGE 丢失。

let workDir;

/** 轮询助手：避免固定 sleep 断言。 */
async function waitUntil(pred, { timeout = 5000, interval = 25 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await pred()) return true;
    if (Date.now() - start > timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** 跑一个 launcher .mjs 子进程；resolve { code, stdout, stderr }。 */
function runLauncher(launcherPath, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcherPath], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('ccv-editor.js 分支补充', { concurrency: false }, () => {
  before(() => {
    // 私有临时目录（并行隔离）：放 launcher 脚本 + 私有 CCV_LOG_DIR。
    workDir = fs.mkdtempSync(join(os.tmpdir(), 'ccv-branch-ccved-'));
  });

  after(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('轮询循环超过 TIMEOUT 时打印超时并以 1 退出 (源码 52-55 分支)', async () => {
    // 内嵌一个 http 服务器：editor-open 返回 200，editor-status 永远 done:false，
    // 所以 main() 的 while(true) 不会自然退出，只能靠 TIMEOUT 分支结束。
    // 在 import 目标前 patch Date.now，让循环内第二次读取时间即“已过 31 分钟”。
    const launcher = join(workDir, 'launch-timeout.mjs');
    const targetUrl = JSON.stringify(SCRIPT);
    const src = [
      "import http from 'node:http';",
      "const server = http.createServer((req, res) => {",
      "  if (req.url === '/api/editor-open') {",
      "    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return;",
      "  }",
      "  if (req.url.startsWith('/api/editor-status')) {",
      "    res.writeHead(200, { 'Content-Type': 'application/json' });",
      "    res.end(JSON.stringify({ done: false })); return;",
      "  }",
      "  res.writeHead(404); res.end();",
      "});",
      // listen(0) -> 内核分配端口，避免硬编码端口冲突。
      "await new Promise(r => server.listen(0, '127.0.0.1', r));",
      "process.env.CCV_EDITOR_PORT = String(server.address().port);",
      "process.argv[2] = 'timeout-probe.md';",
      "const realNow = Date.now.bind(Date);",
      "let calls = 0;",
      "Date.now = () => {",
      "  calls++;",
      // 第 1 次 = const start = Date.now()，之后每次都 +31min -> 第一轮循环检查即超时。
      "  return calls >= 2 ? realNow() + 31 * 60 * 1000 : realNow();",
      "};",
      `await import(${targetUrl});`,
    ].join('\n');
    fs.writeFileSync(launcher, src);

    const { code, stderr } = await runLauncher(launcher, { CCV_LOG_DIR: workDir });
    assert.equal(code, 1, '超时后以 1 退出');
    assert.match(stderr, /Editor session timed out/, '打印超时信息');
  });

  it('resolve 后 filePath 为空时打印 Usage 并以 1 退出 (源码 15-18 真分支)', async () => {
    // `resolve(...)` 自然不会返回空(总归 cwd/'.')，故 `!filePath` 真分支在正常运行不可达。
    // 用 ESM loader hook 把 `node:path` 的 resolve 替成恒返回 '' 的 shim，在【canonical
    // 动态 import 目标之前】register；目标仍走真实文件、覆盖计入，仅测试侧改 path.resolve。
    const loader = join(workDir, 'empty-path-loader.mjs');
    fs.writeFileSync(loader, [
      "export async function resolve(specifier, context, nextResolve) {",
      "  if (specifier === 'node:path' || specifier === 'path') {",
      "    return { url: 'ccv-path-shim:main', shortCircuit: true };",
      "  }",
      "  return nextResolve(specifier, context);",
      "}",
      "export async function load(url, context, nextLoad) {",
      "  if (url === 'ccv-path-shim:main') {",
      "    const source = [",
      "      \"import * as real from 'node:path/posix';\",",
      "      \"export const resolve = () => '';\",",
      "      \"export const dirname = real.dirname;\",",
      "      \"export const join = real.join;\",",
      "      \"export default { resolve, dirname: real.dirname, join: real.join };\",",
      "    ].join('\\n');",
      "    return { format: 'module', source, shortCircuit: true };",
      "  }",
      "  return nextLoad(url, context);",
      "}",
    ].join('\n'));

    const launcher = join(workDir, 'launch-empty-path.mjs');
    const targetUrl = JSON.stringify(SCRIPT);
    fs.writeFileSync(launcher, [
      "import { register } from 'node:module';",
      "register('./empty-path-loader.mjs', import.meta.url);",
      // 带一个真实文件名，确保命中的是 resolve 返回空(而非 argv 缺省分支)。
      "process.argv[2] = 'something.md';",
      "process.env.CCV_EDITOR_PORT = '12345';",
      `await import(${targetUrl});`,
    ].join('\n'));

    const { code, stderr } = await runLauncher(launcher, { CCV_LOG_DIR: workDir });
    assert.equal(code, 1, 'filePath 为空时以 1 退出');
    assert.match(stderr, /Usage: ccv-editor <file>/, '打印 Usage 信息');
  });

  it('argv[2] 缺省时走 || \'\' 默认实参分支 (源码 14 行右值)', async () => {
    // 不传文件参数 -> process.argv[2] 为 undefined，命中 `process.argv[2] || ''` 的默认分支。
    // resolve('') 返回 cwd(真值)，故 `!filePath` 不触发，转而在缺端口处退出，校验默认实参确被求值。
    const launcher = join(workDir, 'launch-default-arg.mjs');
    const targetUrl = JSON.stringify(SCRIPT);
    const src = [
      // 确保无第三个 argv，且 CCV_EDITOR_PORT 为空 -> 在端口检查处以 1 退出。
      "process.argv.length = 2;",
      "process.env.CCV_EDITOR_PORT = '';",
      `await import(${targetUrl});`,
    ].join('\n');
    fs.writeFileSync(launcher, src);

    const { code, stderr } = await runLauncher(launcher, { CCV_LOG_DIR: workDir, CCV_EDITOR_PORT: '' });
    assert.equal(code, 1);
    assert.match(stderr, /CCV_EDITOR_PORT not set/);
  });
});
