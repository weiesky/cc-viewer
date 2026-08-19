// Wire Format v2 — S8 conversion worker (worker_threads entry).
//
// One conversion per worker lifetime: the manager spawns a worker per start
// (or boot-resume), sends {type:'start'}, and the worker exits after posting
// its final message. 'stop' flips a flag polled by convertProject, which
// checkpoints at a safe boundary and returns with status:'stopped'.

import { parentPort } from 'node:worker_threads';
import { convertProject } from './convert.js';

let stopRequested = false;

parentPort?.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'stop') {
    stopRequested = true;
    return;
  }
  if (msg.type !== 'start') return;

  const { logDir, project } = msg;
  let lastProgressAt = 0;
  try {
    const state = await convertProject(logDir, project, {
      shouldStop: () => stopRequested,
      onProgress: (p) => {
        // ≥1s throttle: progress is UI polish, not a firehose. Terminal phases
        // always go through so the manager's snapshot ends accurate.
        const now = Date.now();
        if (p.phase !== 'done' && now - lastProgressAt < 1000) return;
        lastProgressAt = now;
        parentPort?.postMessage({ type: 'progress', project, progress: p });
      },
    });
    parentPort?.postMessage({ type: 'final', project, state });
  } catch (err) {
    // convertProject already persisted status:'error' to the state file.
    parentPort?.postMessage({ type: 'final', project, error: String(err && err.message || err) });
  }
  // Let the queued postMessage drain, then end the thread.
  setImmediate(() => process.exit(0));
});
