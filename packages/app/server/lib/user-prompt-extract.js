// Shared user-prompt extraction — the server-side canonical for pulling clean,
// display-grade user prompts out of wire `messages` arrays and out of v2
// conversation event lines. Consumers: stats-worker previews, the V2Writer's
// per-session `prompts.jsonl` cache, the log-list read side, and the one-off
// backfill tooling. Keep them on THIS module — forked copies drift.
//
// NOTE: this is a deliberate server-side SUBSET of the frontend classifier.
// The full classification (synthetic prompts, secondary recycling, …) lives in
// src/utils/contentFilter.js:isSystemText — frontend (dist) and server are two
// separate bundles that cannot share a module, so only the rules that would
// LEAK into previews are mirrored here: system tags + cross-session teammate
// notifications.
import { openSync, readSync, closeSync } from 'node:fs';

// Cross-session / teammate protocol notification `type` whitelist (must match
// src/utils/contentFilter.js INTER_SESSION_NOTIFICATION_TYPES; add new types in
// BOTH places). One array derives the Set (brace scan) + the RegExp
// (isSystemText) so this file cannot drift internally.
// test/stats-worker-notification-filter.test.js guards frontend↔server sync.
export const INTER_SESSION_TYPES = [
  'idle_notification', 'shutdown_request', 'shutdown_response', 'shutdown_approved',
  'teammate_terminated', 'plan_approval_request', 'plan_approval_response',
];
const INTER_SESSION_TYPES_SET = new Set(INTER_SESSION_TYPES);
const INTER_SESSION_TYPES_RE = new RegExp(`"type"\\s*:\\s*"(?:${INTER_SESSION_TYPES.join('|')})"`);

// CLI-synthesized prompts (HTTP role=user but not typed by a human): Recap /
// Title / Compact / Topic / Summary. Must match src/utils/contentFilter.js
// SYNTHETIC_PROMPTS (KEEP IN SYNC — same rule set, `^`-anchored on trimmed
// text so quoted user text is never swallowed). Without this filter they leak
// into the "all user prompts" preview (observed on real data: "The user
// stepped away and is coming back. Recap in under 40 words…").
const SYNTHETIC_PROMPT_RES = [
  /^The user stepped away and is coming back\. Recap in under/i,
  /^(Based on the above conversation, generate a|Please write a)\s+(short|concise)\s+title/i,
  /^(Your task is to create a detailed summary of the conversation|This session is being continued from a previous conversation)/i,
  /^Analyze if this message indicates a new/i,
  /^Summarize this coding session/i,
];

/** True when a text block is system-injected chrome, not a user prompt. */
export function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Blocks that carry plan content must never be filtered (even when they
  // open with a system tag).
  if (/Implement the following plan:/i.test(trimmed)) return false;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true; // incl. <teammate-message> wrappers
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  for (const re of SYNTHETIC_PROMPT_RES) { if (re.test(trimmed)) return true; }
  // Unwrapped cross-session teammate notifications: prefix line / newer caveat
  // / bare protocol JSON — keep them out of previews.
  if (/^Another Claude session sent a message:/i.test(trimmed)) return true;
  if (/^This came from another Claude session\b/i.test(trimmed)) return true;
  if (trimmed.startsWith('{') && INTER_SESSION_TYPES_RE.test(trimmed)) return true;
  return false;
}

// Single-pass strip of top-level protocol-notification JSON objects (brace
// pairing handles nesting; braces inside string literals / escapes are
// skipped). Same semantics as contentFilter's scanTopLevelJsonObjects +
// extractProtocolNotifications — a flat `\{[^{}]*\}` regex cannot cross nested
// braces, so protocol bodies with nested fields (plan_approval_*) would leak.
function stripProtocolJson(s) {
  if (typeof s !== 'string' || s.indexOf('{') === -1) return s;
  let out = '', cursor = 0, depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        let j; try { j = JSON.parse(s.slice(start, i + 1)); } catch { j = null; }
        if (j && typeof j.type === 'string' && INTER_SESSION_TYPES_SET.has(j.type)) {
          out += s.slice(cursor, start);
          cursor = i + 1;
        }
        start = -1;
      }
    }
  }
  out += s.slice(cursor);
  return out;
}

/**
 * Strip system-injected tags, keeping the user text outside them (only for
 * string-typed content where system chrome and user text can be mixed).
 */
export function stripSystemTags(text) {
  let out = text
    .replace(/<(system-reminder|local-command-caveat|project-reminder|important-instruction-reminders|file-modified-reminder|todo-reminder|user-prompt-submit-hook|local-command-stdout|command-name|task-notification|environment_details|context|teammate-message)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Unwrapped cross-session notification chrome: prefix line + both caveat
    // generations + bare protocol JSON (incl. nested) — strip, keep any user
    // text mixed into the body.
    .replace(/^Another Claude session sent a message:\s*/i, '')
    .replace(/(^|\n)This came from another Claude session[\s\S]*?(?=\n\n|$)/i, '')
    .replace(/(^|\n)IMPORTANT: This is NOT from your user[\s\S]*?(?=\n\n|$)/i, '');
  out = stripProtocolJson(out);
  return out.trim();
}

/**
 * Extract the list of user prompt texts from a wire `messages` array.
 * (Kept in sync with src/utils/contentFilter.js:classifyUserContent.)
 */
export function extractUserTexts(messages) {
  const texts = [];
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      // string content can mix system tags with user text — strip tags first
      const text = stripSystemTags(msg.content).trim();
      if (text && !isSystemText(text)) {
        if (/^Implement the following plan:/i.test(text)) continue;
        texts.push(text);
      }
    } else if (Array.isArray(msg.content)) {
      const hasCommand = msg.content.some(b => b.type === 'text' && /<command-message>/i.test(b.text || ''));
      const userParts = [];
      for (const b of msg.content) {
        if (b.type !== 'text') continue;
        const text = (b.text || '').trim();
        if (!text || isSystemText(text)) continue;
        if (hasCommand && /<command-message>/i.test(text)) continue;
        if (/^Implement the following plan:/i.test(text)) continue;
        userParts.push(text);
      }
      if (userParts.length > 0) {
        texts.push(userParts.join(' '));
      }
    }
  }
  return texts;
}

/** True when a request is a SUGGESTION MODE probe (next-input prediction). */
export function isSuggestionMode(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last?.role !== 'user') return false;
  const content = last.content;
  if (Array.isArray(content)) {
    return content.some(b => b.type === 'text' && /^\[SUGGESTION MODE:/i.test((b.text || '').trim()));
  }
  if (typeof content === 'string') return /^\[SUGGESTION MODE:/im.test(content.trim());
  return false;
}

/** Preview normalization: one line, trimmed, capped at 100 chars (the stats
 *  precedent — a display truncation, not a prompt drop). */
export function flattenPromptText(text) {
  return text.replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
}

/** Numeric epoch-file sort: e2 before e10 (a lexical sort mis-orders them). */
export function sortEpochFiles(names) {
  return names
    .filter(f => /^e\d+\.jsonl$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
}

/**
 * Fold conversation EVENT LINES into a deduped, display-ready prompt list.
 * The single implementation shared by the stats preview, the read-side
 * derivation and the backfill tooling:
 * - snapshot/append lines carry `msgs:[…]`;
 * - ctl replace-tail lines carry the swapped tail as `.msg` — a suggestion
 *   probe replaced by the REAL next prompt arrives exactly this way, so
 *   dropping ctl lines would lose those prompts;
 * - skips whole SUGGESTION MODE events;
 * - normalizes via flattenPromptText and dedupes via `seen`.
 * @param {Iterable<object>} events parsed conversation event lines
 * @param {{seen?: Set<string>, out?: string[]}} [acc] accumulator (reusable across epochs)
 * @returns {string[]} the accumulated prompt list (=== acc.out when given)
 */
export function collectPromptsFromEvents(events, acc = {}) {
  const seen = acc.seen || (acc.seen = new Set());
  const out = acc.out || (acc.out = []);
  for (const ev of events) {
    if (!ev) continue;
    let msgs = null;
    if (Array.isArray(ev.msgs) && ev.msgs.length > 0) msgs = ev.msgs;
    else if (ev.t === 'ctl' && ev.op === 'replace-tail' && ev.msg) msgs = [ev.msg];
    if (!msgs) continue;
    if (isSuggestionMode(msgs)) continue;
    for (const text of extractUserTexts(msgs)) {
      const flat = flattenPromptText(text);
      if (flat && !seen.has(flat)) {
        seen.add(flat);
        out.push(flat);
      }
    }
  }
  return out;
}

/**
 * Bounded head-read of a session's `prompts.jsonl`: parse at most `maxBytes`
 * from the file head, one `{seq, texts:[…]}` object per line, dropping the
 * (possibly truncated) tail beyond the budget. `readJsonlTolerant` reads whole
 * files and must NOT be used here — prompts.jsonl of a resume-heavy long
 * session is the one v2 file a list render touches per session, so the read
 * must stay O(budget).
 * @returns {string[]} deduped, display-ready prompts (empty when absent/unreadable)
 */
export function readPromptsHead(path, maxBytes = 256 * 1024) {
  let fd;
  let head = '';
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    head = buf.toString('utf-8', 0, n);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
  }
  const seen = new Set();
  const out = [];
  const lines = head.split('\n');
  // A read that filled the whole budget may end mid-line — drop that tail.
  if (head.length >= maxBytes) lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; } // torn/corrupt line — skip
    if (!obj || !Array.isArray(obj.texts)) continue;
    for (const t of obj.texts) {
      if (typeof t !== 'string') continue;
      const flat = flattenPromptText(t);
      if (flat && !seen.has(flat)) {
        seen.add(flat);
        out.push(flat);
      }
    }
  }
  return out;
}
