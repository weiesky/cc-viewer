/**
 * Register AskUserQuestion and permission approval hooks into ~/.claude/settings.json.
 * Shared between cli.js and electron/tab-worker.js.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

export function ensureHooks() {
  try {
    const claudeDir = resolve(homedir(), '.claude');
    const settingsPath = resolve(claudeDir, 'settings.json');
    let settings = {};
    try { if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch {
      console.warn('[CC Viewer] ~/.claude/settings.json is malformed, skipping hook injection');
      return;
    }

    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];

    let changed = false;

    // AskUserQuestion hook → ask-bridge.js
    // Guard: only execute when CCVIEWER_PORT is set (i.e. launched by cc-viewer)
    const askBridgePath = resolve(rootDir, 'lib', 'ask-bridge.js');
    const askCmd = `[ -n "$CCVIEWER_PORT" ] && node "${askBridgePath}" || true`;
    const askExisting = settings.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
    if (askExisting) {
      if ((askExisting.hooks?.[0]?.command || '') !== askCmd) {
        askExisting.hooks = [{ type: 'command', command: askCmd }];
        changed = true;
      }
    } else {
      settings.hooks.PreToolUse.push({
        matcher: 'AskUserQuestion',
        hooks: [{ type: 'command', command: askCmd }]
      });
      changed = true;
    }

    // Permission approval hook → perm-bridge.js (matcher: "" = match all tools)
    // Guard: only execute when CCVIEWER_PORT is set (i.e. launched by cc-viewer)
    const permBridgePath = resolve(rootDir, 'lib', 'perm-bridge.js');
    const permCmd = `[ -n "$CCVIEWER_PORT" ] && node "${permBridgePath}" || true`;
    const permMatcher = '';
    // Clean up legacy entries
    for (let i = settings.hooks.PreToolUse.length - 1; i >= 0; i--) {
      const h = settings.hooks.PreToolUse[i];
      const cmd = h.hooks?.[0]?.command || '';
      if (cmd.includes('perm-bridge.js') && h.matcher !== permMatcher) {
        settings.hooks.PreToolUse.splice(i, 1);
        changed = true;
      } else if ((h.matcher === null || h.matcher === undefined) && cmd.includes('perm-bridge.js')) {
        settings.hooks.PreToolUse.splice(i, 1);
        changed = true;
      } else if (h.matcher === 'Bash' && cmd.includes('grep') && /git|npm/.test(cmd)) {
        settings.hooks.PreToolUse.splice(i, 1);
        changed = true;
      }
    }
    const permExisting = settings.hooks.PreToolUse.find(h => h.matcher === permMatcher);
    if (permExisting) {
      if ((permExisting.hooks?.[0]?.command || '') !== permCmd) {
        permExisting.hooks = [{ type: 'command', command: permCmd }];
        changed = true;
      }
    } else {
      settings.hooks.PreToolUse.push({
        matcher: permMatcher,
        hooks: [{ type: 'command', command: permCmd }]
      });
      changed = true;
    }

    if (changed) {
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch (err) {
    console.warn('[CC Viewer] Failed to ensure hooks:', err.message);
  }
}
