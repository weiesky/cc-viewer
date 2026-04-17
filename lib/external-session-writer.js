// CCV External Sessions Protocol v1 - writer side.
// Spec: docs/ccv-external-sessions-protocol.md
//
// Two usage modes:
//   1. Programmatic (preferred for producers that don't wrap claude):
//        import { createSession } from 'cc-viewer/external';
//        const s = createSession({ sessionDir, sessionId, role, title });
//        s.appendEntry(entry);
//        s.markEnded();
//   2. Env-driven (for producers that launch claude through ccv's proxy):
//        CCV_EXTERNAL_SESSION='{...}' ccv run -- claude ...
//        ccv's interceptor handles skeleton write + endedAt on exit.

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const ENV_VAR = 'CCV_EXTERNAL_SESSION';
const LOG_ENTRY_SEPARATOR = '\n---\n';

let _parsed = null;
let _parseAttempted = false;

// ─── Programmatic API ────────────────────────────────────────────────

/**
 * Start a session on disk (writes skeleton session.json, ensures the directory,
 * and returns helpers to append entries and mark the session ended).
 *
 * Producer-side usage (no ccv proxy needed):
 *
 *   const s = createSession({
 *     sessionDir: '/abs/path/to/.../sessions/<session-id>',
 *     sessionId: '<session-id>',
 *     role: 'worker',          // optional — free-form producer label
 *     title: 'first attempt',  // optional
 *   });
 *   s.appendEntry({ timestamp, url, method, body, response });
 *   s.markEnded();
 *
 * Idempotent with respect to session.json: existing files are preserved, so
 * reopening a session (e.g. after a crash) keeps the original startedAt.
 *
 * @param {object} opts
 * @param {string} opts.sessionDir  absolute path to the session directory
 * @param {string} opts.sessionId   stable id (should match the directory name)
 * @param {string} [opts.role]      free-form role label; defaults to "unknown"
 * @param {string} [opts.title]     human-readable title; defaults to sessionId
 * @returns {{ sessionDir: string, logFile: string, sessionJsonPath: string,
 *             appendEntry: (entry: object) => void, markEnded: () => boolean }}
 */
export function createSession({ sessionDir, sessionId, role, title } = {}) {
  if (typeof sessionDir !== 'string' || !isAbsolute(sessionDir)) {
    throw new Error('createSession: sessionDir must be an absolute path');
  }
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new Error('createSession: sessionId is required');
  }

  mkdirSync(sessionDir, { recursive: true });
  const sessionJsonPath = join(sessionDir, 'session.json');
  const logFile = join(sessionDir, 'log.jsonl');

  if (!existsSync(sessionJsonPath)) {
    const skeleton = {
      sessionId,
      title: typeof title === 'string' && title ? title : sessionId,
      role: typeof role === 'string' && role ? role : 'unknown',
      logFile: 'log.jsonl',
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    writeFileSync(sessionJsonPath, JSON.stringify(skeleton, null, 2));
  }

  return {
    sessionDir,
    logFile,
    sessionJsonPath,
    appendEntry(entry) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('appendEntry: entry must be an object');
      }
      // 协议要求单行紧凑 JSON，后接 \n---\n 分隔
      appendFileSync(logFile, JSON.stringify(entry) + LOG_ENTRY_SEPARATOR);
    },
    markEnded() {
      if (!existsSync(sessionJsonPath)) return false;
      try {
        const data = JSON.parse(readFileSync(sessionJsonPath, 'utf-8'));
        if (data.endedAt) return true;
        data.endedAt = new Date().toISOString();
        writeFileSync(sessionJsonPath, JSON.stringify(data, null, 2));
        return true;
      } catch (err) {
        console.error(`[CC Viewer] markEnded failed: ${err.message}`);
        return false;
      }
    },
  };
}

// ─── Env-driven API (used by ccv's interceptor) ──────────────────────

/**
 * Parse CCV_EXTERNAL_SESSION env var (JSON string). Cached after first call.
 * Returns null if env absent or invalid (caller should fall back to default behaviour).
 * v1 accepts: sessionDir (required, absolute), sessionId (required), role, title.
 * Other keys are ignored — producers with extended metadata should use createSession().
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
