/**
 * ensure-hooks-tasks.test.js — covers the task-checklist hook sections that
 * ensure-hooks.js injects (TaskCreated / TaskCompleted / PostToolUse matcher
 * 'TaskUpdate'), all pointing at server/lib/task-bridge.js.
 *
 * Focus:
 *   - fresh install creates all three sections with guard/marker/timeout
 *   - TaskCreated/TaskCompleted entries carry NO matcher (matcher would be
 *     silently ignored by Claude Code for these lifecycle events)
 *   - idempotent second run (no duplicates, no rewrite)
 *   - a user's own PostToolUse/'TaskUpdate' entry survives untouched — our
 *     entry must be appended as a SEPARATE entry (find-by-command), never
 *     merged in place by matcher (that would clobber the user's entry)
 *   - removeAllManagedHooks clears the new sections (uninstall parity)
 *   - stale managed entries in the new sections get purged
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Must set CLAUDE_CONFIG_DIR before importing ensure-hooks (mirrors
// ensure-hooks.test.js; timeout fixed to the 86400 default).
const tmpHome = mkdtempSync(join(tmpdir(), 'ccv-ensure-hooks-tasks-test-'));
process.env.CLAUDE_CONFIG_DIR = tmpHome;
delete process.env.CCV_HOOK_TIMEOUT_S;

const settingsPath = () => resolve(tmpHome, 'settings.json');

function loadSettings() {
  if (!existsSync(settingsPath())) return null;
  return JSON.parse(readFileSync(settingsPath(), 'utf-8'));
}
function writeSettings(data) {
  mkdirSync(tmpHome, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(data, null, 2));
}
function cleanup() { try { rmSync(settingsPath(), { force: true }); } catch {} }

const isTaskCmd = (h) => (h.hooks?.[0]?.command || '').includes('task-bridge.js');

let mod;
describe('lib/ensure-hooks.js — task checklist sections', () => {
  before(async () => { mod = await import('../server/lib/ensure-hooks.js'); });
  beforeEach(() => cleanup());
  after(() => { try { rmSync(tmpHome, { recursive: true, force: true }); } catch {} });

  it('fresh install: TaskCreated / TaskCompleted / PostToolUse(TaskUpdate) all injected', () => {
    mod.ensureHooks();
    const s = loadSettings();
    for (const key of ['TaskCreated', 'TaskCompleted']) {
      assert.ok(Array.isArray(s.hooks[key]), `${key} section created`);
      const entry = s.hooks[key].find(isTaskCmd);
      assert.ok(entry, `${key} has the task-bridge entry`);
      assert.equal(entry.matcher, undefined, `${key} entry must have no matcher`);
      assert.match(entry.hooks[0].command, /CCVIEWER_PORT/);
      assert.match(entry.hooks[0].command, /cc-viewer-managed/);
      assert.equal(entry.hooks[0].timeout, 86400);
    }
    assert.ok(Array.isArray(s.hooks.PostToolUse), 'PostToolUse section created');
    const ptu = s.hooks.PostToolUse.find(isTaskCmd);
    assert.ok(ptu, 'PostToolUse has the task-bridge entry');
    assert.equal(ptu.matcher, 'TaskUpdate', 'PostToolUse entry is scoped to TaskUpdate');
    assert.match(ptu.hooks[0].command, /CCVIEWER_PORT/);
    assert.match(ptu.hooks[0].command, /cc-viewer-managed/);
  });

  it('idempotent: second run does not duplicate or rewrite', () => {
    mod.ensureHooks();
    const before = readFileSync(settingsPath(), 'utf-8');
    mod.ensureHooks();
    const after = readFileSync(settingsPath(), 'utf-8');
    assert.equal(before, after, 'second ensureHooks must be a no-op');
    const s = loadSettings();
    for (const key of ['TaskCreated', 'TaskCompleted', 'PostToolUse']) {
      assert.equal(s.hooks[key].filter(isTaskCmd).length, 1, `${key}: exactly one managed entry`);
    }
  });

  it('user PostToolUse/TaskUpdate entry survives: ours is appended separately, never merged', () => {
    writeSettings({
      hooks: {
        PostToolUse: [
          { matcher: 'TaskUpdate', hooks: [{ type: 'command', command: 'echo user-hook' }] },
        ],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    const userEntry = s.hooks.PostToolUse.find(h => h.hooks?.[0]?.command === 'echo user-hook');
    assert.ok(userEntry, 'user TaskUpdate entry must survive');
    assert.equal(userEntry.hooks[0].timeout, undefined, 'user hook must not gain our timeout field');
    const ours = s.hooks.PostToolUse.filter(isTaskCmd);
    assert.equal(ours.length, 1, 'our entry appended as a separate entry');
    assert.notEqual(ours[0], userEntry);
  });

  it('user TaskCreated/TaskCompleted entries survive alongside ours', () => {
    writeSettings({
      hooks: {
        TaskCreated: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    assert.ok(s.hooks.TaskCreated.find(h => h.hooks?.[0]?.command === 'echo mine'));
    assert.ok(s.hooks.TaskCreated.find(isTaskCmd));
  });

  it('removeAllManagedHooks clears the new sections too (uninstall parity)', () => {
    mod.ensureHooks();
    const s = loadSettings();
    const removed = mod.removeAllManagedHooks(s);
    assert.ok(removed >= 3, 'at least the three task entries are removed');
    assert.equal(s.hooks.TaskCreated.filter(isTaskCmd).length, 0);
    assert.equal(s.hooks.TaskCompleted.filter(isTaskCmd).length, 0);
    assert.equal(s.hooks.PostToolUse.filter(isTaskCmd).length, 0);
  });

  it('stale managed task entry (path gone) is purged and rebuilt fresh', () => {
    writeSettings({
      hooks: {
        TaskCreated: [{
          hooks: [{
            type: 'command',
            command: '[ -n "$CCVIEWER_PORT" ] && node "/nonexistent/cc-viewer/task-bridge.js" || true # cc-viewer-managed',
            timeout: 86400,
          }],
        }],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    const entries = s.hooks.TaskCreated.filter(isTaskCmd);
    assert.equal(entries.length, 1, 'exactly one rebuilt entry');
    assert.doesNotMatch(entries[0].hooks[0].command, /nonexistent/);
    assert.match(entries[0].hooks[0].command, /server\/lib\/task-bridge\.js/);
  });
});
