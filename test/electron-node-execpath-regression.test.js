// Static-analysis regression test for issue #129 — Electron tab workers must be
// forkable on a machine with no external Node.js on the GUI process's PATH.
//
// Background: electron/main.js forks tab-worker.js with an explicit `execPath`.
// That path came from `where node` / `which node`, and on failure fell back to
// the BARE STRING 'node' (win32) or '/usr/local/bin/node' (POSIX). A packaged
// Windows app does not inherit the user's shell PATH, so the lookup found
// nothing and fork() failed with "spawn node ENOENT" (confirmed in the reporter's
// electron-diag.log). Every tab then hung in `loading` until the 30s
// ready-timeout, and the follow-up child.send() threw "write EPIPE" on the
// already-dead IPC channel — both visible in that same log.
//
// The fix: fall back to Electron's own binary with ELECTRON_RUN_AS_NODE=1, which
// is always present, so no external Node install is required at all.
//
// This test reads source text and asserts on it, so it behaves identically on
// every platform (electron/main.js cannot be imported outside Electron).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = join(__dirname, '..', 'apps', 'electron', 'electron', 'main.js');
const src = readFileSync(mainPath, 'utf8');

describe('#129: Electron tab fork must not depend on an external Node on PATH', () => {
  it('never falls back to a bare unresolvable "node" execPath', () => {
    // The exact regression: `_nodePath = 'node'` makes fork() do a PATH lookup
    // that fails in a packaged GUI app → "spawn node ENOENT".
    assert.ok(!/_nodePath\s*=\s*process\.platform\s*===\s*'win32'\s*\?\s*'node'/.test(src),
      'main.js still falls back to the bare string "node" for fork execPath');
    assert.ok(!/_nodePath\s*=\s*['"]node['"]\s*;/.test(src),
      'main.js assigns a bare "node" execPath somewhere');
  });

  it('does not hardcode a POSIX-only /usr/local/bin/node fallback', () => {
    assert.ok(!/_nodePath\s*=\s*['"]\/usr\/local\/bin\/node['"]/.test(src),
      'a hardcoded /usr/local/bin/node fallback is not guaranteed to exist');
  });

  it('falls back to the Electron binary (process.execPath) when no Node is found', () => {
    assert.ok(/_resolvedNode\s*\|\|\s*process\.execPath/.test(src),
      'expected the resolved-node-or-Electron-binary fallback');
  });

  it('sets ELECTRON_RUN_AS_NODE on the child when forking under Electron', () => {
    assert.ok(/_forkUnderElectron/.test(src), 'expected a _forkUnderElectron flag');
    assert.ok(/childEnv\.ELECTRON_RUN_AS_NODE\s*=\s*['"]1['"]/.test(src),
      'the worker must run as plain Node, not a second Electron app instance');
    // And it must be REMOVED when a real Node is used, otherwise a stale
    // inherited value would leak into an unrelated child.
    assert.ok(/delete\s+childEnv\.ELECTRON_RUN_AS_NODE/.test(src),
      'ELECTRON_RUN_AS_NODE must be cleared when a real Node binary is used');
  });

  it('verifies a discovered Node path exists before trusting it', () => {
    const fn = src.match(/function resolveNodeExecPath\(\)[\s\S]*?\n}/);
    assert.ok(fn, 'resolveNodeExecPath() not found');
    assert.ok(/existsSync\(hit\)/.test(fn[0]),
      'a `where`/`which` hit must be existence-checked before use');
  });

  it('picks a spawnable .exe from multi-line `where node` output', () => {
    const fn = src.match(/function resolveNodeExecPath\(\)[\s\S]*?\n}/);
    // Windows `where` lists every PATH match; non-.exe shims are not spawnable.
    assert.ok(/\.exe['"]\)\)/.test(fn[0]) || /endsWith\('\.exe'\)/.test(fn[0]),
      'expected an .exe filter over `where node` output');
  });
});

describe('#129: a failed fork must surface as an error, not a 30s hang', () => {
  it("child 'error' handler flips the tab out of loading immediately", () => {
    const handler = src.match(/child\.on\('error',[\s\S]*?\n {2}\}\);/);
    assert.ok(handler, "child.on('error') handler not found");
    assert.ok(/clearTimeout\(timeout\)/.test(handler[0]),
      'the ready-timeout must be cleared once fork has definitively failed');
    assert.ok(/status\s*=\s*'error'/.test(handler[0]),
      'the tab must move to the error state so the UI stops spinning');
    assert.ok(/broadcastTabs\(\)/.test(handler[0]),
      'the renderer must be told about the state change');
  });

  it('the launch child.send() is guarded against EPIPE on a dead channel', () => {
    // "write EPIPE" in the reporter's log came from send() racing the failed fork.
    const idx = src.indexOf("type: 'launch'");
    assert.ok(idx > 0, "launch send() not found");
    const window = src.slice(Math.max(0, idx - 400), idx + 400);
    assert.ok(/try\s*\{[\s\S]*child\.send\(/.test(window),
      'child.send({type:"launch"}) must be wrapped in try/catch');
    assert.ok(/catch\s*\(err\)\s*\{[\s\S]*appendDiag\(/.test(window),
      'a send failure must be recorded via appendDiag, not swallowed silently');
  });
});
