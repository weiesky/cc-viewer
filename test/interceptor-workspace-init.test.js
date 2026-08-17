/**
 * interceptor.js — workspace 模式 import 初始化 + 未选工作区时的 _writeWorkspaceActive 短路。
 *
 * CCV_WORKSPACE_MODE=1 时模块顶层把 _projectName/_logDir/LOG_FILE 全置空（延迟到选工作区再 init）。
 * 此时 _getActiveProfileFilePath() 因 _projectName/_logDir 为空返回 null → setActiveProfileForWorkspace
 * 调用 _writeWorkspaceActive 命中 `if (!p)` 诊断短路分支（返回 false）。
 *
 * 独立测试文件 = 独立进程；interceptor.js 在保护清单：只测不改。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const logDir = mkdtempSync(join(tmpdir(), 'ccv-ws-init-'));
process.env.CCV_LOG_DIR = logDir;
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
process.env.CCV_WORKSPACE_MODE = '1';  // 关键：workspace 模式 → 顶层不 init，_projectName/_logDir 为空

let mod;
before(async () => { mod = await import('../server/interceptor.js'); });
after(() => {
  delete process.env.CCV_WORKSPACE_MODE;
  try { rmSync(logDir, { recursive: true, force: true }); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 30).unref();
});

describe('workspace 模式：未选工作区时的状态与写入短路', () => {
  it('顶层 workspace init 把 _projectName/_logDir/LOG_FILE 置空', () => {
    assert.equal(mod._projectName, '', 'workspace 模式 _projectName 初始为空');
    assert.equal(mod._logDir, '', 'workspace 模式 _logDir 初始为空');
    assert.equal(mod.LOG_FILE, '', 'workspace 模式 LOG_FILE 初始为空');
  });

  it('未选工作区时 setActiveProfileForWorkspace 的 workspace 写入短路为 false（_getActiveProfileFilePath null）', () => {
    // _getActiveProfileFilePath() 返回 null（无 projectName/logDir）→ _writeWorkspaceActiveId 走 `if (!p)` 短路。
    const res = mod.setActiveProfileForWorkspace('p1');
    assert.equal(res.workspace, false, 'workspace 段短路返回 false');
    // profile.json 段仍可写（PROFILE_PATH 在 LOG_DIR 根，与 workspace 目录无关）→ profile=true
    assert.equal(res.profile, true, 'profile.json 段不受 workspace 短路影响');
  });
});
