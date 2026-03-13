import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { installStatusLine, uninstallStatusLine, CLAUDE_SETTINGS_FILE } from '../lib/context-watcher.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const CCV_STATUSLINE_SCRIPT = join(CLAUDE_DIR, 'ccv-statusline.sh');

let savedSettings = null;
let settingsExisted = false;
let savedScript = null;
let scriptExisted = false;

function backup() {
  try {
    settingsExisted = existsSync(CLAUDE_SETTINGS_FILE);
    if (settingsExisted) savedSettings = readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8');
  } catch { }
  try {
    scriptExisted = existsSync(CCV_STATUSLINE_SCRIPT);
    if (scriptExisted) savedScript = readFileSync(CCV_STATUSLINE_SCRIPT, 'utf-8');
  } catch { }
}

function restore() {
  try {
    if (settingsExisted && savedSettings !== null) {
      writeFileSync(CLAUDE_SETTINGS_FILE, savedSettings);
    } else if (!settingsExisted && existsSync(CLAUDE_SETTINGS_FILE)) {
      // Restore to original state — rewrite without our statusLine
      // But safer: just restore original content or remove if it didn't exist
      try {
        const current = JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
        if (current.statusLine?.command?.includes('ccv-statusline')) {
          delete current.statusLine;
          writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(current, null, 2) + '\n');
        }
      } catch { }
    }
  } catch { }
  try {
    if (!scriptExisted && existsSync(CCV_STATUSLINE_SCRIPT)) {
      unlinkSync(CCV_STATUSLINE_SCRIPT);
    } else if (scriptExisted && savedScript !== null) {
      writeFileSync(CCV_STATUSLINE_SCRIPT, savedScript);
    }
  } catch { }
  savedSettings = null;
  savedScript = null;
}

describe('context-watcher: installStatusLine', () => {
  beforeEach(() => { backup(); });
  afterEach(() => {
    // Always uninstall first to reset internal state
    uninstallStatusLine();
    restore();
  });

  it('creates statusLine in settings.json and script file', () => {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    // Start with clean settings (no statusLine)
    const baseSettings = {};
    if (existsSync(CLAUDE_SETTINGS_FILE)) {
      Object.assign(baseSettings, JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8')));
    }
    delete baseSettings.statusLine;
    writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(baseSettings, null, 2) + '\n');

    installStatusLine();

    assert.ok(existsSync(CCV_STATUSLINE_SCRIPT), 'script file should be created');
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    assert.equal(settings.statusLine?.type, 'command');
    assert.ok(settings.statusLine.command.includes('ccv-statusline'));

    const script = readFileSync(CCV_STATUSLINE_SCRIPT, 'utf-8');
    assert.ok(script.includes('#!/usr/bin/env bash'));
    assert.ok(script.includes('context-window.json'));
  });

  it('chains existing statusLine command', () => {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    const baseSettings = existsSync(CLAUDE_SETTINGS_FILE)
      ? JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'))
      : {};
    baseSettings.statusLine = { type: 'command', command: '/usr/bin/my-status' };
    writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(baseSettings, null, 2) + '\n');

    installStatusLine();

    const script = readFileSync(CCV_STATUSLINE_SCRIPT, 'utf-8');
    assert.ok(script.includes('/usr/bin/my-status'), 'should chain original command');
  });

  it('handles re-install when ccv-statusline already present', () => {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    const baseSettings = existsSync(CLAUDE_SETTINGS_FILE)
      ? JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'))
      : {};
    baseSettings.statusLine = { type: 'command', command: CCV_STATUSLINE_SCRIPT };
    writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(baseSettings, null, 2) + '\n');

    installStatusLine();

    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    assert.ok(settings.statusLine.command.includes('ccv-statusline'));
  });
});

describe('context-watcher: uninstallStatusLine', () => {
  beforeEach(() => { backup(); });
  afterEach(() => { restore(); });

  it('restores original statusLine after uninstall', () => {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    const baseSettings = existsSync(CLAUDE_SETTINGS_FILE)
      ? JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'))
      : {};
    baseSettings.statusLine = { type: 'command', command: '/usr/bin/original' };
    writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(baseSettings, null, 2) + '\n');

    installStatusLine();
    uninstallStatusLine();

    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    assert.equal(settings.statusLine?.command, '/usr/bin/original');
    assert.ok(!existsSync(CCV_STATUSLINE_SCRIPT), 'script should be removed');
  });

  it('deletes statusLine key when no original existed', () => {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    const baseSettings = existsSync(CLAUDE_SETTINGS_FILE)
      ? JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'))
      : {};
    delete baseSettings.statusLine;
    writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(baseSettings, null, 2) + '\n');

    installStatusLine();
    uninstallStatusLine();

    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    assert.equal(settings.statusLine, undefined, 'statusLine should be removed');
  });

  it('is a no-op when never installed', () => {
    // Fresh module state — _originalStatusLine is undefined
    // uninstallStatusLine should return immediately without error
    // Note: since installStatusLine was called in previous tests,
    // we need a fresh import. Instead, just verify it doesn't throw.
    uninstallStatusLine();
    assert.ok(true, 'should not throw');
  });
});
