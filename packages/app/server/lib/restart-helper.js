#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { restartFromHelper, waitForExit } from './restart.js';
import { installStagedUpdate, readRestartConfig, RESTART_READY_FILE } from './update-job.js';

for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(signal, () => { /* The replacement must survive the old terminal job. */ });
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});


export async function runRestartHelper({ stateFile = process.argv[2], configFile = process.argv[3], config, install = installStagedUpdate, restart = restartFromHelper, log = console.error } = {}) {
  let staged;
  try {
    config ||= readRestartConfig(configFile);
    if (!Number.isInteger(config.pid) || config.pid <= 0 || !Array.isArray(config.args) || typeof config.cwd !== 'string' || typeof config.cliPath !== 'string' || !/^\d+\.\d+\.\d+$/.test(config.version)) throw new Error('Invalid arguments');
    staged = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (staged.version !== config.version) throw new Error('Staged update does not match the requested version');
    mkdirSync(dirname(RESTART_READY_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(RESTART_READY_FILE, JSON.stringify({ token: config.token }), { mode: 0o600 });
    await waitForExit(config.pid);
    writeFileSync(stateFile, JSON.stringify({ ...staged, status: 'installing' }), { mode: 0o600 });
    log('[CC Viewer] Installing the downloaded update...');
    await install(staged, { stateFile, ownerPid: config.pid, cliPath: config.cliPath });
    writeFileSync(stateFile, JSON.stringify({ ...staged, status: 'completed' }), { mode: 0o600 });
    const { rm } = await import('node:fs/promises');
    await rm(staged.tarballPath, { force: true });
    await rm(stateFile, { force: true });
    return await restart(config, { wait: async () => {} });
  } catch (err) {
    try {
      if (!staged) staged = JSON.parse(readFileSync(stateFile, 'utf8'));
      writeFileSync(stateFile, JSON.stringify({ ...staged, status: 'failed', error: err.message, updatedAt: Date.now() }), { mode: 0o600 });
      if (staged?.tarballPath) {
        const { rm } = await import('node:fs/promises');
        await rm(staged.tarballPath, { force: true }).catch(rmErr => log(`[CC Viewer] Failed to remove staged package: ${rmErr.message}`));
      }
    } catch (writeErr) { log(`[CC Viewer] Failed to record update failure: ${writeErr.message}`); }
    log(`[CC Viewer] Restart failed: ${err.message}`);
    if (config?.cliPath && Number.isInteger(config.pid)) {
      try {
        const { waitForExit } = await import('./restart.js');
        await waitForExit(config.pid);
        return await restart(config, { wait: async () => {} });
      } catch (restoreErr) {
        log(`[CC Viewer] Restore failed: ${restoreErr.message}`);
        return 1;
      }
    }
    return 1;
  } finally {
    if (configFile) {
      const { rm } = await import('node:fs/promises');
      await rm(configFile, { force: true }).catch(() => {});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(signal, () => { /* The replacement must survive the old terminal job. */ });
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
  process.exitCode = await runRestartHelper();
}
