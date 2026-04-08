#!/usr/bin/env node

/**
 * ccv-editor.js — Custom $EDITOR wrapper for cc-viewer.
 *
 * When Claude Code spawns $EDITOR (e.g. /memory), this script is invoked instead.
 * It notifies the cc-viewer server to open the file in the built-in FileContentView,
 * then polls until the user closes the editor in the web UI.
 */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const filePath = resolve(process.argv[2] || '');
if (!filePath) {
  console.error('Usage: ccv-editor <file>');
  process.exit(1);
}

const port = process.env.CCV_EDITOR_PORT;
if (!port) {
  console.error('CCV_EDITOR_PORT not set');
  process.exit(1);
}

const sessionId = randomUUID();
const baseUrl = `http://127.0.0.1:${port}`;
const POLL_INTERVAL = 500;
const TIMEOUT = 30 * 60 * 1000; // 30 minutes

async function main() {
  // Notify server to open editor
  try {
    const res = await fetch(`${baseUrl}/api/editor-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, filePath }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Failed to open editor:', err);
      process.exit(1);
    }
  } catch (err) {
    console.error('Failed to connect to cc-viewer server:', err.message);
    process.exit(1);
  }

  // Poll until done
  const start = Date.now();
  while (true) {
    if (Date.now() - start > TIMEOUT) {
      console.error('Editor session timed out');
      process.exit(1);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    try {
      const res = await fetch(`${baseUrl}/api/editor-status?id=${sessionId}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.done) {
        process.exit(0);
      }
    } catch {
      // Connection error — server may have restarted, exit
      process.exit(1);
    }
  }
}

main();
