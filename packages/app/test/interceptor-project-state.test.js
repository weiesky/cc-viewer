/**
 * interceptor → project-state push wiring: the three assignment sites of
 * `_projectName` (module init, initForWorkspace, resetWorkspace) must mirror
 * into lib/project-state.js so lib readers (project-prefs) see the live value
 * without importing the interceptor.
 *
 * Own file = own process (interceptor.js is on the protect list: measure, don't modify).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const logDir = mkdtempSync(join(tmpdir(), 'ccv-projstate-'));
process.env.CCV_LOG_DIR = logDir;
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
process.env.CCV_WORKSPACE_MODE = '1';

let interceptor, state, prefs;
before(async () => {
  interceptor = await import('../server/interceptor.js');
  state = await import('../server/lib/project-state.js');
  prefs = await import('../server/lib/project-prefs.js');
});
after(() => {
  delete process.env.CCV_WORKSPACE_MODE;
  try { rmSync(logDir, { recursive: true, force: true }); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 30).unref();
});

describe('interceptor mirrors _projectName into project-state', () => {
  it('workspace-mode module init pushes the empty name', () => {
    assert.equal(interceptor._projectName, '');
    assert.equal(state.getProjectName(), '');
  });

  it('initForWorkspace pushes the sanitized basename; project-prefs reads it', () => {
    interceptor.initForWorkspace(join(logDir, 'my project'));
    assert.equal(state.getProjectName(), 'my_project');
    assert.equal(prefs.getCurrentProjectName(), 'my_project');
  });

  it('resetWorkspace pushes the empty name back', () => {
    interceptor.resetWorkspace();
    assert.equal(interceptor._projectName, '');
    assert.equal(state.getProjectName(), '');
  });
});
