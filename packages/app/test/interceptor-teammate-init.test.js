/**
 * interceptor.js — teammate 子进程 import-time 初始化分支。
 *
 * _isTeammate 由 process.argv 含 --agent-name / --parent-session-id 在模块求值期决定，
 * 必须在独立进程里于 import 前注入 argv。1.7.0 起 teammate 不再定位/复用 leader 的 v1
 * 日志文件（findRecentLog 已随 v1 写路径退役）：teammate 与其他进程一样写自己的 v2
 * session（meta.leader 记录归属，读侧按 §10 re-join）。此处钉住 import-time 仍成立的
 * 不变量：projectName/logDir 由 cwd 派生、LOG_FILE 恒空、v2 writer 携带 leader 元数据。
 *
 * 独立测试文件 = 独立进程；interceptor.js 在保护清单：只测不改。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

// 独立 LOG_DIR，避免与其它 interceptor 测试共享。
const logDir = mkdtempSync(join(tmpdir(), 'ccv-tm-init-'));
process.env.CCV_LOG_DIR = logDir;
process.env.CCV_PROXY_MODE = '1';      // teammate 下顶层条件 `(!CCV_PROXY_MODE || _isTeammate)`
                                        // 仍为 true → 会 setup；我们只关心 import-time 初始化，不驱动 fetch
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_IM_PLATFORM;

// 在一个已知 cwd 下运行，使 _projectName=basename(cwd) 可预测。
const workCwd = mkdtempSync(join(tmpdir(), 'ccv-tm-proj-'));
const projectName = basename(workCwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
const projLogDir = join(logDir, projectName);

const savedArgv = process.argv.slice();
const savedCwd = process.cwd();

let mod;
before(async () => {
  // teammate 模式 import 即自执行 setupInterceptor → fake fetch 必须先就位。
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  // 注入 teammate argv + 切到已知 cwd（在 import 之前）。
  process.argv = [process.argv[0], process.argv[1], '--agent-name', 'worker-1', '--team-name', 'fix-stuff'];
  process.chdir(workCwd);
  mod = await import('../server/interceptor.js');
});

after(() => {
  process.argv = savedArgv;
  try { process.chdir(savedCwd); } catch { /* noop */ }
  try { rmSync(logDir, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(workCwd, { recursive: true, force: true }); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 30).unref(); // 顶层 watchFile 阻止退出
});

describe('teammate 子进程 import 初始化', () => {
  it('_isTeammate 路径：projectName/logDir 由 cwd 派生；LOG_FILE 恒空（不再复用 leader v1 日志）', () => {
    assert.equal(mod._projectName, projectName, '_projectName 应为 basename(cwd) 规范化结果');
    assert.equal(mod._logDir, projLogDir, '_logDir 应为 LOG_DIR/projectName');
    // 1.7.0：findRecentLog / leader 日志复用已随 v1 写路径退役 → LOG_FILE 恒为空串。
    assert.equal(mod.LOG_FILE, '', 'teammate 不再指向 leader 日志文件');
    // 首个 sid 请求到来前也没有 v2 session dir。
    assert.equal(mod.getLiveLogSource(), '', '首请求前 live source 为空');
  });

  it('v2 writer 携带 teammate leader 元数据（读侧 §10 re-join 的归属依据）', () => {
    assert.ok(mod._v2Writer.enabled, 'teammate 进程 v2 writer 应启用');
    assert.deepEqual(mod._v2Writer._leader, { agentName: 'worker-1', teamName: 'fix-stuff' },
      'leader 元数据来自 --agent-name/--team-name argv');
  });
});
