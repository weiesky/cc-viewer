#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { restartFromHelper } from './restart.js';
import { installStagedUpdate } from './update-job.js';

for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(signal, () => { /* The replacement must survive the old terminal job. */ });

let config;
try {
  config = JSON.parse(process.argv[3] || '');
  if (!Number.isInteger(config.pid) || config.pid <= 0 || !Array.isArray(config.args) || typeof config.cwd !== 'string' || typeof config.cliPath !== 'string' || !/^\d+\.\d+\.\d+$/.test(config.version)) throw new Error('Invalid arguments');
  const stateFile = process.argv[2];
  const staged = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (staged.version !== config.version) throw new Error('Staged update does not match the requested version');
  process.exitCode = await (async () => {
    const { waitForExit } = await import('./restart.js');
    await waitForExit(config.pid);
    writeFileSync(stateFile, JSON.stringify({ ...staged, status: 'installing' }), { mode: 0o600 });
    console.error('[CC Viewer] Installing the downloaded update...');
    await installStagedUpdate(staged, { stateFile, ownerPid: config.pid });
    writeFileSync(stateFile, JSON.stringify({ ...staged, status: 'completed' }), { mode: 0o600 });
    const { rm } = await import('node:fs/promises');
    await rm(staged.tarballPath, { force: true });
    await rm(stateFile, { force: true });
    return restartFromHelper(config, { wait: async () => {} });
  })();
} catch (err) {
  try { writeFileSync(process.argv[2], JSON.stringify({ ...staged, status: 'failed', error: err.message, updatedAt: Date.now() }), { mode: 0o600 }); } catch { }
  console.error(`[CC Viewer] Restart failed: ${err.message}`);
  if (config?.cliPath && Number.isInteger(config.pid)) {
    try {
      const { waitForExit } = await import('./restart.js');
      await waitForExit(config.pid);
      process.exitCode = await restartFromHelper(config, { wait: async () => {} });
    } catch (restoreErr) {
      console.error(`[CC Viewer] Restore failed: ${restoreErr.message}`);
      process.exitCode = 1;
    }
  }
}
