// CCV External Sessions Protocol v1 - writer side.
// Spec: docs/ccv-external-sessions-protocol.md
//
// v1 has a single write path: producer sets CCV_EXTERNAL_SESSION and launches
// its workload through ccv's proxy (e.g. `ccv run -- <cmd>`). ccv's interceptor
// writes session.json skeleton on start, captures HTTP traffic to
// <sessionDir>/log.jsonl, and patches endedAt on exit.
//
// Producers that cannot route traffic through the proxy (e.g. non-Node tools)
// may write session.json / log.jsonl themselves by following the schema;
// the file format is small enough to produce without an SDK.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const ENV_VAR = 'CCV_EXTERNAL_SESSION';

let _parsed = null;
let _parseAttempted = false;

/**
 * Parse CCV_EXTERNAL_SESSION env var (JSON string). Cached after first call.
 * Returns null if env absent or invalid (caller should fall back to default behaviour).
 * v1 accepts: sessionDir (required, absolute), sessionId (required), role, title.
 * Other keys are ignored.
 */
export function getExternalSession() {
  if (_parseAttempted) return _parsed;
  _parseAttempted = true;

  const raw = process.env[ENV_VAR];
  if (!raw) return (_parsed = null);

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    console.error(`[CC Viewer] ${ENV_VAR} invalid JSON: ${err.message}`);
    return (_parsed = null);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    console.error(`[CC Viewer] ${ENV_VAR} must be a JSON object`);
    return (_parsed = null);
  }

  const { sessionDir, sessionId } = obj;
  if (typeof sessionDir !== 'string' || !isAbsolute(sessionDir)) {
    console.error(`[CC Viewer] ${ENV_VAR}.sessionDir must be an absolute path`);
    return (_parsed = null);
  }
  if (typeof sessionId !== 'string' || !sessionId) {
    console.error(`[CC Viewer] ${ENV_VAR}.sessionId is required`);
    return (_parsed = null);
  }

  _parsed = {
    sessionDir,
    sessionId,
    logFile: join(sessionDir, 'log.jsonl'),
    sessionJsonPath: join(sessionDir, 'session.json'),
    role: typeof obj.role === 'string' ? obj.role : null,
    title: typeof obj.title === 'string' ? obj.title : null,
  };
  return _parsed;
}

/**
 * Env-driven skeleton write (called by interceptor on proxy start).
 * Returns false if env absent; returns true without touching the file if it already exists.
 */
export function writeSessionSkeleton() {
  const ext = getExternalSession();
  if (!ext) return false;

  try {
    mkdirSync(ext.sessionDir, { recursive: true });
  } catch (err) {
    console.error(`[CC Viewer] Failed to create sessionDir ${ext.sessionDir}: ${err.message}`);
    return false;
  }

  if (existsSync(ext.sessionJsonPath)) return true;

  const skeleton = {
    sessionId: ext.sessionId,
    title: ext.title || ext.sessionId,
    role: ext.role || 'unknown',
    logFile: 'log.jsonl',
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  try {
    writeFileSync(ext.sessionJsonPath, JSON.stringify(skeleton, null, 2));
    return true;
  } catch (err) {
    console.error(`[CC Viewer] Failed to write session.json: ${err.message}`);
    return false;
  }
}

/**
 * Env-driven endedAt fill (called by interceptor on proxy exit). Idempotent.
 */
export function markSessionEnded() {
  const ext = getExternalSession();
  if (!ext) return false;
  if (!existsSync(ext.sessionJsonPath)) return false;

  try {
    const data = JSON.parse(readFileSync(ext.sessionJsonPath, 'utf-8'));
    if (data.endedAt) return true;
    data.endedAt = new Date().toISOString();
    writeFileSync(ext.sessionJsonPath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`[CC Viewer] Failed to mark session ended: ${err.message}`);
    return false;
  }
}

// Test-only: reset the parse cache.
export function _resetForTest() {
  _parsed = null;
  _parseAttempted = false;
}
