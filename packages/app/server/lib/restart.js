import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isPidAlive } from './pid-alive.js';
import { UPDATE_STATE_FILE } from './update-job.js';

export const RESTART_HELPER_PATH = fileURLToPath(new URL('./restart-helper.js', import.meta.url));

export function launchRestart({ pid = process.pid, args, cwd, version, cliPath, spawnImpl = spawn, platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || !Array.isArray(args) || typeof cwd !== 'string' || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || typeof cliPath !== 'string') {
    throw new Error('Invalid restart configuration');
  }
  const child = spawnImpl(process.execPath, [RESTART_HELPER_PATH, UPDATE_STATE_FILE, JSON.stringify({ pid, args, cwd, version, cliPath })], {
    detached: true, stdio: 'inherit', windowsHide: true, env: process.env,
  });
  child.on('error', (err) => console.error('[CC Viewer] Restart helper failed to start:', err.message));
  child.unref();
  return child;
}

export async function waitForExit(pid, { alive = isPidAlive, sleep = (ms) => new Promise(r => setTimeout(r, ms)), timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the old ccv process to stop');
    await sleep(100);
  }
}

export async function restartFromHelper(config, { spawnImpl = spawn, wait = waitForExit } = {}) {
  await wait(config.pid);
  const child = spawnImpl(process.execPath, [config.cliPath, ...config.args], { cwd: config.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env: { ...process.env, CCV_NO_OPEN: '1' } });
  child.stdout?.on('data', (chunk) => { try { process.stdout.write(chunk); } catch { } });
  child.stderr?.on('data', (chunk) => { try { process.stderr.write(chunk); } catch { } });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
