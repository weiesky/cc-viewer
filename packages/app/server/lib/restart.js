import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isPidAlive } from './pid-alive.js';
import { UPDATE_STATE_FILE, RESTART_CONFIG_FILE, RESTART_READY_FILE } from './update-job.js';

export const RESTART_HELPER_PATH = fileURLToPath(new URL('./restart-helper.js', import.meta.url));

export async function launchRestart({ pid = process.pid, args, cwd, version, cliPath, spawnImpl = spawn, timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || !Array.isArray(args) || typeof cwd !== 'string' || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || typeof cliPath !== 'string') {
    throw new Error('Invalid restart configuration');
  }
  const token = randomUUID();
  await mkdir(dirname(RESTART_CONFIG_FILE), { recursive: true, mode: 0o700 });
  await writeFile(RESTART_CONFIG_FILE, JSON.stringify({ pid, args, cwd, version, cliPath, token }), { mode: 0o600 });
  await rm(RESTART_READY_FILE, { force: true });
  let child;
  try {
    child = spawnImpl(process.execPath, [RESTART_HELPER_PATH, UPDATE_STATE_FILE, RESTART_CONFIG_FILE], {
      detached: true, stdio: 'inherit', windowsHide: true, env: process.env,
    });
  } catch (err) {
    await rm(RESTART_CONFIG_FILE, { force: true });
    throw err;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      child.off('error', onError);
      child.off('exit', onExit);
      if (err) {
        try { child.kill('SIGKILL'); } catch { }
        Promise.all([rm(RESTART_CONFIG_FILE, { force: true }), rm(RESTART_READY_FILE, { force: true })])
          .catch(() => {})
          .finally(() => reject(err));
      } else {
        child.unref();
        resolve(child);
      }
    };
    const onError = (err) => finish(err);
    const onExit = (code) => { checkReady().then(ok => { if (!ok) finish(new Error(`Restart helper exited before it was ready (${code})`)); }); };
    child.once('error', onError);
    child.once('exit', onExit);
    const checkReady = async () => {
      try {
        const ready = JSON.parse(await readFile(RESTART_READY_FILE, 'utf8'));
        if (ready.token === token) { finish(); return true; }
      } catch { /* Wait for the helper's bounded readiness signal. */ }
      return false;
    };
    const poll = setInterval(checkReady, 50);
    checkReady();
    const timer = setTimeout(() => finish(new Error('Restart helper readiness timed out')), timeoutMs);
    timer.unref?.();
  });
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
  console.error(`[CC Viewer] Restarted in the background with PID ${child.pid}. Stop it with: kill ${child.pid}`);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
