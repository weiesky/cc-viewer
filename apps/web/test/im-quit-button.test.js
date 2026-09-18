/**
 * im-quit-button.test.js — source contract for the IM conversation-modal header
 * 「停止」button (ImConversationModal.jsx). The repo has no JSX transform/jsdom,
 * so — like task-progress-hud.test.js — these are readFileSync source contracts.
 * Every assertion was paired with a deliberately-breaking mutation and confirmed
 * to FAIL under the mutation (pristine green + mutant red):
 *   1. drop the Popconfirm wrapper (button fires stopWorker with no confirm)
 *   2. point the fetch at /process {action:'stop'} (pure kill, respawns on reboot)
 *      instead of /config {enabled:false} (disable semantics)
 *   3. drop `applyProcess: true` (config saved but worker left running)
 *   4. drop the ccv:im-config-changed dispatch (header chips never re-probe)
 *   5. drop the `state !== 'dead'` guard (stop button shows on a dead worker)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'src', 'components', 'settings', 'ImConversationModal.jsx'), 'utf-8');

describe('IM conversation-modal header stop button contract', () => {
  it('imports Popconfirm and imTr', () => {
    assert.ok(/from 'antd'/.test(SRC) && /Popconfirm/.test(SRC.split('\n')[1]), 'Popconfirm imported from antd');
    assert.ok(SRC.includes("import { imTr } from '../../utils/imTr';"), 'imTr imported for fallback translations');
  });

  it('renders a danger 停止 button wrapped in a Popconfirm that confirms into stopWorker', () => {
    assert.ok(SRC.includes('<Popconfirm'), 'Popconfirm wrapper present');
    assert.ok(SRC.includes('onConfirm={stopWorker}'), 'confirm triggers stopWorker');
    assert.ok(SRC.includes("imTr('ui.im.stopConfirm'"), 'Popconfirm title uses ui.im.stopConfirm');
    assert.ok(SRC.includes('okButtonProps={{ danger: true }}'), 'confirm button is danger-styled');
    // The destructive, persists-enabled:false button must sit INSIDE the Popconfirm —
    // a bare "contains <Popconfirm" + "contains the button" passes even when the button
    // is moved outside the wrapper (verified survivor). Assert ordering instead.
    const iPop = SRC.indexOf('<Popconfirm');
    const iBtn = SRC.indexOf("{t('ui.im.stop')}");
    const iClose = SRC.indexOf('</Popconfirm>', iPop);
    assert.ok(iPop > -1 && iBtn > -1 && iClose > iPop, 'Popconfirm wraps a region');
    assert.ok(iPop < iBtn && iBtn < iClose, 'the 停止 button is INSIDE the Popconfirm (confirm gate actually applies)');
  });

  it('stopWorker POSTs /config with disable semantics (enabled:false + applyProcess:true), not a bare process kill', () => {
    assert.ok(SRC.includes('const stopWorker = async'), 'stopWorker defined');
    // Scope the body check to the stopWorker function (the file's comments mention
    // action:'stop' to explain why we avoid it, so a file-wide regex false-positives).
    const fnStart = SRC.indexOf('const stopWorker = async');
    const fnEnd = SRC.indexOf('\n  };', fnStart);
    const fn = SRC.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
    assert.ok(fn.includes('/config'), 'targets the /config endpoint (disable), not /process (kill-only)');
    assert.ok(!fn.includes('/process'), 'must not target the /process endpoint');
    assert.ok(fn.includes('enabled: false'), 'writes enabled:false so reconcile will not respawn on reboot');
    assert.ok(fn.includes('applyProcess: true'), 'applyProcess:true stops the live worker now');
    assert.ok(!/action:\s*'stop'/.test(fn), 'must NOT use /process action:stop (that leaves enabled:true → respawn)');
  });

  it('stopWorker sends a minimal {enabled:false} body — field preservation is the SERVER\'s job', () => {
    // The P0 wipe is fixed server-side: imConfigPost read-merge-writes bodies that
    // touch only `enabled` (see routes/im.js + api-im.test.js "partial update").
    // So the client must NOT try to prefill cred fields — it sends just the two keys
    // and lets the server merge. This guards against the client-side hack returning.
    const fnStart = SRC.indexOf('const stopWorker = async');
    const fnEnd = SRC.indexOf('\n  };', fnStart);
    const fn = SRC.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
    assert.ok(fn.includes('{ enabled: false, applyProcess: true }'),
      'client sends only {enabled:false, applyProcess:true} — the server merges the rest');
    assert.ok(!fn.includes('credFields'), 'no client-side cred backfill (server handles preservation)');
  });

  it('notifies header chips and optimistically flips the badge to dead', () => {
    assert.ok(SRC.includes("window.dispatchEvent(new CustomEvent('ccv:im-config-changed'"),
      'dispatches ccv:im-config-changed so ImStatusChip re-probes');
    assert.ok(SRC.includes("setImProc((p) => (p ? { ...p, state: 'dead' } : p))"),
      'badge flips to dead immediately so 启动 can appear');
  });

  it('stop button only shows for a live local worker (hidden when remote or dead)', () => {
    assert.ok(SRC.includes("const showStop = !!imProc && imProc.state !== 'dead';"),
      'showStop requires process info (local) and a non-dead state');
  });

  it('stop button is disabled while a start is in flight (prevents the stop-mid-start race)', () => {
    // During the start poll loop imProc.state is booting/ready, so showStop stays true;
    // without the disabled guard a stop click mid-start lets the start poll observe
    // ready/connected afterwards and toast 已连接 over a stopped worker.
    assert.ok(SRC.includes('disabled={startingPlatform === platform}'),
      'stop button disabled while startingPlatform === platform');
  });

  it('stop failure surfaces a toast via ui.im.stopFailed', () => {
    assert.ok(SRC.includes("imTr('ui.im.stopFailed'"), 'stop failure toast uses ui.im.stopFailed');
  });
});
