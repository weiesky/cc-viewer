// Content classification and filtering rules.
// ChatView (chat mode) and AppHeader (user Prompt popup) share this module so the
// filtering logic stays consistent. MainAgent / Teammate detection also converges here for
// unified global use.

// ============== request body helpers ==============

const SUBAGENT_SYSTEM_RE = /command execution specialist|file search specialist|planning specialist|general-purpose agent|security monitor|performing a web search/i;

// cc_version 2.1.181+: the CLI marks subagents explicitly in the billing header
// (cc_is_subagent=true); a true main agent omits this field (never =false). Such subagents
// inherit the full "You are Claude Code" prompt plus Edit/Bash/Agent tools, so they would
// trip the lightweight MainAgent heuristic — hence the explicit exclusion.
// Trailing \b anchor: only matches `=true` (followed by `;` / whitespace / end of string),
// avoiding false matches like `=truex`.
const SUBAGENT_BILLING_RE = /cc_is_subagent=true\b/;

// Teammate detection: system prompt contains the Agent Teammate Communication marker
// (external-process teammate)
const TEAMMATE_SYSTEM_RE = /running as an agent in a team|Agent Teammate Communication/i;

// Native teammate detection (in-process Agent subagent); separate module for version
// compatibility
// Extensioned for server-side reuse (see requestType.js header note).
import { isNativeTeammate, extractNativeTeammateName } from './teammateDetector.js';

// ============== cross-session / teammate "protocol notification" detection ==============
// The harness injects cross-session / teammate notifications into the main session as
// role=user text. Existing logic only recognized the <teammate-message> wrapper and the
// "Another Claude session sent a message:" prefix; this adds the "bare protocol JSON" form
// plus the newer caveat wording, classifying both as teammate status bubbles (not
// user-typed input). The type whitelist matches ChatMessage's ui.teammate.${type}
// rendering.
export const INTER_SESSION_NOTIFICATION_TYPES = new Set([
  'idle_notification', 'shutdown_request', 'shutdown_response',
  'shutdown_approved', 'teammate_terminated',
  'plan_approval_request', 'plan_approval_response',
]);

// The harness-injected "cross-session wrapped text" marker (fixed English wording).
const INTER_SESSION_LEAD_RE = /^Another Claude session sent a message:/i;
// Trailing caveat (both old and new wordings). Deliberately not using /m: `(^|\n)` anchors
// at the start of a line and `$` marks the whole-string end — a multi-line caveat is
// stripped all the way to a blank line / end of string, not just the first line as lazy +
// /m would; the line-start anchor avoids stripping mid-body user quotes of this sentence.
const INTER_SESSION_CAVEAT_RES = [
  /(^|\n)This came from another Claude session[\s\S]*?(?=\n\n|$)/i,
  /(^|\n)IMPORTANT: This is NOT from your user[\s\S]*?(?=\n\n|$)/i,
];

// Braces-pairing scan to find top-level {...} candidate JSON segments (skipping braces
// inside string literals / escapes), returning { raw, start, end } ranges for the caller to
// strip in one pass (not one replace each, avoiding O(n²)). Pairing is used instead of a
// [^{}]* regex to correctly handle nesting.
function scanTopLevelJsonObjects(s) {
  if (typeof s !== 'string' || s.indexOf('{') === -1) return [];
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
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
    else if (ch === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push({ raw: s.slice(start, i + 1), start, end: i + 1 }); start = -1; } }
  }
  return out;
}

// Identify whitelisted protocol-notification JSON in s, returning { statuses:[{type,from}],
// rest }, where rest = the remaining text after those JSON segments are removed. A single
// scan + range splicing (O(n)) avoids the O(n²) of a whole-string replace per hit (review
// S1) and unifies the two former replace/split-join strip implementations. Non-whitelisted
// or parse-failed {...} segments are kept as-is in rest.
function extractProtocolNotifications(s) {
  const statuses = [];
  let rest = '', cursor = 0;
  for (const { raw, start, end } of scanTopLevelJsonObjects(s)) {
    let j;
    try { j = JSON.parse(raw); } catch { continue; }
    if (j && typeof j.type === 'string' && INTER_SESSION_NOTIFICATION_TYPES.has(j.type)) {
      statuses.push({ type: j.type, from: (typeof j.from === 'string' && j.from) ? j.from : null });
      rest += s.slice(cursor, start);
      cursor = end;
    }
  }
  rest += s.slice(cursor);
  return { statuses, rest };
}

// Parse a "bare protocol notification" text block (no <teammate-message> wrapper — the
// wrapped form is handled by the classifyUserContent main path). Returns
// { statuses:[{type,from}], rest } or null. It is only recognized as a notification if it
// carries a harness marker (lead / caveat) — see below.
export function parseInterSessionNotification(text) {
  if (typeof text !== 'string') return null;
  let body = text.trim();
  if (!body) return null;
  // Strip the <teammate-message> wrapper to avoid double counting with the
  // classifyUserContent main path
  body = body.replace(/<teammate-message[\s\S]*?<\/teammate-message>/gi, '').trim();
  if (!body) return null;

  const hadLead = INTER_SESSION_LEAD_RE.test(body);
  let work = hadLead ? body.replace(INTER_SESSION_LEAD_RE, '') : body;
  let hadCaveat = false;
  for (const cr of INTER_SESSION_CAVEAT_RES) {
    if (cr.test(work)) { hadCaveat = true; work = work.replace(cr, ''); }
  }
  // Only recognized as a notification if it carries a harness marker (the "Another Claude
  // session…" lead or a caveat segment). A real cross-session notification always has one
  // of them (the bare <teammate-message> wrapper is handled separately by the
  // classifyUserContent main path); accordingly, a user pasting a chunk of protocol-like
  // JSON is never misclassified as hidden — fully removing the over-filter vector (review
  // S2/F2, aligning with the user's "don't filter normal requests" request).
  if (!hadLead && !hadCaveat) return null;

  const { statuses, rest } = extractProtocolNotifications(work);
  if (statuses.length === 0) return null;
  return { statuses, rest: rest.trim() };
}

/**
 * Extract the system prompt text from a request body
 */
export function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

// WeakMap cache for isTeammate — avoids redundant getSystemText + regex per request
const _isTeammateCache = new WeakMap();

/**
 * Determine whether a request comes from a Teammate subprocess.
 * Supports two detection modes: interceptor mode (req.teammate field) and proxy mode
 * (system prompt marker). The single global entry point, alongside isMainAgent.
 */
export function isTeammate(req) {
  if (!req) return false;
  const cached = _isTeammateCache.get(req);
  if (cached !== undefined) return cached;
  // [Highest priority] wire agent identity signals (x-claude-code-agent-id /
  // cc_is_subagent, see agent-id.js). Since Claude Code 2.1.199 ordinary subagents are
  // also granted the SendMessage tool, so isNativeTeammate's SendMessage criterion is no
  // longer reliable — these two signals are hard criteria:
  //  - persistent named agent form (name@session-…) → always a Teammate;
  //  - persistent anonymous hex form → always a SubAgent (overrides the SendMessage
  //    criterion below);
  //  - cc_is_subagent=true (CLI self-reported billing marker, 2.1.181+) → always a
  //    SubAgent.
  const agent = req.agent;
  if (agent) {
    if (agent.named) { _isTeammateCache.set(req, true); return true; }
    _isTeammateCache.set(req, false); return false;
  }
  const sysText = getSystemText(req.body || {});
  if (SUBAGENT_BILLING_RE.test(sysText)) { _isTeammateCache.set(req, false); return false; }
  // interceptor mode: teammate field written via process.argv
  if (req.teammate) { _isTeammateCache.set(req, true); return true; }
  // native teammate: in-process Agent subagent (system prompt contains "You are a Claude
  // agent")
  if (isNativeTeammate(req)) {
    // Inject the teammate field for downstream requestType.js formatTeammateLabel use.
    // The persistent wire agent name (x-claude-code-agent-id, see agent-id.js) takes
    // priority — it does not depend on the in-window registry, so the name stays reliable
    // on cold load / timing gaps.
    if (!req.teammate) {
      req.teammate = req.agent?.agentName || extractNativeTeammateName(req) || null;
    }
    _isTeammateCache.set(req, true);
    return true;
  }
  // proxy mode: detect via system prompt (external-process teammate)
  const result = TEAMMATE_SYSTEM_RE.test(sysText);
  _isTeammateCache.set(req, result);
  return result;
}

// WeakMap cache for isMainAgent — avoids redundant regex/array work across call sites
const _isMainAgentCache = new WeakMap();

/**
 * Determine whether a request is a MainAgent request.
 * Combines interceptor-marker validation + old/new architecture detection; the single
 * global entry point.
 */
export function isMainAgent(req) {
  if (!req) return false;
  const cached = _isMainAgentCache.get(req);
  if (cached !== undefined) return cached;
  const result = _isMainAgentImpl(req);
  _isMainAgentCache.set(req, result);
  return result;
}

function _isMainAgentImpl(req) {
  if (!req) return false;

  // A Teammate subprocess request is not a MainAgent, avoiding pollution of the main
  // session view
  if (isTeammate(req)) return false;

  // cc_is_subagent=true ⇒ subagent, never a MainAgent (cc_version 2.1.181+). Must precede
  // the req.mainAgent short-circuit below to cover on-disk old logs whose records were
  // tagged mainAgent=true by the server (backward compat: old logs / true main agents do
  // not carry this token).
  if (SUBAGENT_BILLING_RE.test(getSystemText(req.body || {}))) return false;

  if (req.mainAgent) {
    // Exclude SubAgents that were mis-tagged (old-log compatibility)
    const sysText = getSystemText(req.body || {});
    if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
    return true;
  }

  // Unified detection logic: supports old and new architectures
  const body = req.body || {};
  if (!body.system || !Array.isArray(body.tools)) return false;

  const sysText = getSystemText(body);

  // Must contain a MainAgent identity marker (SDK-mode base prompt includes "built on
  // Anthropic's Claude Agent SDK.")
  if (!sysText.includes('You are Claude Code') && !sysText.includes("built on Anthropic's Claude Agent SDK")) return false;

  // Exclude SubAgents
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;

  // New architecture detection (v2.1.69+): deferred tool loading
  const isSystemArray = Array.isArray(body.system);
  const hasToolSearch = body.tools.some(t => t.name === 'ToolSearch');

  if (isSystemArray && hasToolSearch) {
    // Check whether the first message contains <available-deferred-tools>
    const messages = body.messages || [];
    const firstMsgContent = messages.length > 0 ?
      (typeof messages[0].content === 'string' ? messages[0].content :
       Array.isArray(messages[0].content) ? messages[0].content.map(c => c.text || '').join('') : '') : '';
    if (firstMsgContent.includes('<available-deferred-tools>')) {
      return true;
    }
  }

  // v2.1.81+: a lightweight MainAgent initial request may have < 10 tools; lower the
  // threshold for compatibility
  if (body.tools.length > 5) {
    const hasEdit = body.tools.some(t => t.name === 'Edit');
    const hasShell = body.tools.some(t => t.name === 'Bash' || t.name === 'PowerShell');
    const hasTaskOrAgent = body.tools.some(t => t.name === 'Task' || t.name === 'Agent');
    if (hasEdit && hasShell && hasTaskOrAgent) {
      return true;
    }
  }

  return false;
}

// /clear checkpoint detection: extracted into a standalone dependency-free module so it can
// be imported directly by node --test.
export { isPostClearCheckpoint, isCompactContinuation, isSessionBoundary } from './clearCheckpoint.js';

// ============== text content filtering ==============

/**
 * Determine whether text is Skill-loading content
 */
export function isSkillText(text) {
  if (!text) return false;
  return /^Base directory for this skill:/i.test(text.trim());
}

/**
 * Determine whether text is system-injected text (should not be shown as a user message)
 */
/**
 * Strip known system/command tags from a text block, returning only user-authored content.
 * Used to extract user input embedded in system-reminder-wrapped blocks (e.g., /ultraplan).
 */
function stripSystemTags(text) {
  if (!text) return '';
  let out = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, '')
    .replace(/<teammate-message[\s\S]*?<\/teammate-message>/gi, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, '')
    // harness-injected wrapper text for a teammate-message round: leading line + trailing
    // IMPORTANT disclaimer segment. The trailing segment uses ^...m multiline anchoring —
    // a paragraph must start at a line to be stripped, so mid-body user quotes of the
    // sentence are unaffected; only the opening phrase is anchored, not the dash/wording
    // after it (harness punctuation tweaks must not leak the trailing segment into a user
    // bubble)
    .replace(/^Another Claude session sent a message:\s*/i, '')
    .replace(/^IMPORTANT: This is NOT from your user\b[\s\S]*?(?=\n\n|$)/im, '');
  // Newer cross-session caveat (multi-line safe: line-start anchored, stripped to a blank
  // line / end of string)
  out = out.replace(/(^|\n)This came from another Claude session[\s\S]*?(?=\n\n|$)/i, '');
  // Bare protocol-notification JSON (idle / shutdown_* / teammate_terminated /
  // plan_approval_*, including nesting) — stripped in a single scan (O(n), review S1).
  // Same kind as the protocol JSON in a <teammate-message> wrapper; after stripping, the
  // second pass recovers only the user-appended body (empty if none)
  out = extractProtocolNotifications(out).rest;
  return out.trim();
}

// Claude Code internal synthetic-prompt whitelist (recap/title/compact/topic/summary
// queries the CLI synthesizes in the main session — role=user over HTTP but not
// user-typed). Shares the same whitelist as requestType.js's Synthetic classification and
// is filtered uniformly in isSystemText → hidden across ChatView / Mobile / DetailPanel /
// teamModalBuilder. Matches the start of the last user message (`^` anchor + trim) to avoid
// harming user-quoted originals.
// KEEP IN SYNC: packages/core/test/synthetic-classification.test.js has an inline copy.
export const SYNTHETIC_PROMPTS = [
  { subType: 'Recap',   pattern: /^The user stepped away and is coming back\. Recap in under/i },
  { subType: 'Title',   pattern: /^(Based on the above conversation, generate a|Please write a)\s+(short|concise)\s+title/i },
  { subType: 'Compact', pattern: /^(Your task is to create a detailed summary of the conversation|This session is being continued from a previous conversation)/i },
  { subType: 'Topic',   pattern: /^Analyze if this message indicates a new/i },
  { subType: 'Summary', pattern: /^Summarize this coding session/i },
];

export function isSyntheticPromptText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const { pattern } of SYNTHETIC_PROMPTS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// UltraPlan input detection: UltraPlanModal / the CLI /ultraplan both prepend the
// <system-reminder>[SCOPED INSTRUCTION]…</system-reminder> template assembled by
// ultraplanTemplates.js to the user prompt. Only ultraplanTemplates.js produces this
// marker, so it is a reliable "this round is UltraPlan input" signal. stripSystemTags would
// strip the block, so detection must run on the raw (unstripped) text; a negative
// lookahead ensures the marker sits inside the same <system-reminder>…</system-reminder>
// block (without crossing the closing tag), avoiding a false positive when the user body
// merely "mentions" the phrase after some unrelated reminder.
export function isUltraplanText(text) {
  if (!text || typeof text !== 'string') return false;
  return /<system-reminder>(?:(?!<\/system-reminder>)[\s\S])*?\[SCOPED INSTRUCTION\]/i.test(text);
}

export function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  // A text block containing plan content should not be filtered (even with system tags at
  // the start)
  if (/Implement the following plan:/i.test(trimmed)) return false;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true;
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  // System message injected when Claude Code truncates its output
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  // Skill-loaded document content
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  // CLI-internal synthetic prompts (Recap/Title/Compact/Topic/Summary)
  if (isSyntheticPromptText(trimmed)) return true;
  // harness-injected teammate-message round: the wrapped text (lead + trailing IMPORTANT
  // segment) is not user-typed; the teammate content itself is extracted by
  // classifyUserContent into teammateBlocks and rendered separately
  if (/^Another Claude session sent a message:/i.test(trimmed)) return true;
  // Bare protocol notification (starts directly with protocol JSON, no "Another Claude
  // session" lead): only counted as system text when parseInterSessionNotification matches
  // whitelisted protocol JSON — pasted non-protocol JSON / bodies with appended text are
  // not swallowed. The caveat is trailing chrome (the real form always has JSON first,
  // caveat after), so a block that "starts with a caveat" is treated as user body to
  // prevent the whole block from disappearing (review F1); its caveat chrome is handled by
  // parse / stripSystemTags within blocks confirmed as notifications.
  if (trimmed.startsWith('{') && parseInterSessionNotification(trimmed)) return true;
  // Placeholder user message the CLI injects when the user rejects a tool / interrupts
  // Claude — semantically duplicates the "✗ rejected" badge above. Covers the historical
  // variants: "[Request interrupted by user for tool use]", "[Request interrupted by
  // user]", "[Request interrupted...]"
  if (/^\[Request interrupted/i.test(trimmed)) return true;
  return false;
}

// The "displayable body" of a string-typed user/assistant message. Faithfully mirrors the
// two-pass semantics of classifyUserContent (its "first filter + stripSystemTags second
// recovery" steps), but operating on a string:
//   Pass1: non-system text → returned as-is (preserving paired tags quoted mid-body by the
//           user, word-for-word identical to current behavior, zero regression);
//   Pass2: system blocks (judged true by isSystemText, e.g. starting with chrome tags) →
//           strip known chrome, then re-judge; return the stripped body if it is still real
//           body, otherwise '' (should be hidden).
// Fixes the case where a "system-tag-prefixed + real body" string was fully swallowed by
// isSystemText (the array path had this recovery; the string path previously did not).
// Note: a user-typed unclosed <system-reminder> (no pairing) is still judged system text
// and hidden — that current behavior is preserved; this function does not change it.
export function extractDisplayText(str) {
  if (typeof str !== 'string' || !str.trim()) return '';
  if (!isSystemText(str)) return str;                  // Pass1: already user text, as-is
  const recovered = stripSystemTags(str);               // Pass2: second-pass recovery
  return (recovered && !isSystemText(recovered)) ? recovered : '';
}

/**
 * Classify and extract the various text blocks from a user message's content array.
 * @param {Array} content — the message.content array
 * @returns {{ commands: string[], textBlocks: Array, skillBlocks: Array, teammateBlocks: Array, taskNotificationBlocks: Array }}
 *   commands              — extracted slash command names (e.g. "/clear")
 *   textBlocks            — filtered plain user text blocks (no system text, command
 *                            blocks, or skill blocks)
 *   skillBlocks           — skill-loaded text blocks
 *   teammateBlocks        — parsed teammate-message blocks
 *   taskNotificationBlocks — parsed task-notification blocks
 */
export function classifyUserContent(content) {
  if (!Array.isArray(content)) return { commands: [], textBlocks: [], skillBlocks: [], teammateBlocks: [], taskNotificationBlocks: [] };

  // Extract <teammate-message> blocks from user content
  const teammateBlocks = [];
  for (const b of content) {
    if (b.type !== 'text') continue;
    const text = b.text || '';
    const re = /<teammate-message\s+([^>]*)>([\s\S]*?)<\/teammate-message>/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
      const attrs = match[1];
      const body = match[2].trim();
      const idMatch = attrs.match(/teammate_id="([^"]*)"/);
      const colorMatch = attrs.match(/color="([^"]*)"/);
      const summaryMatch = attrs.match(/summary="([^"]*)"/);
      const tmId = idMatch ? idMatch[1] : 'teammate';
      const tmColor = colorMatch ? colorMatch[1] : null;
      // JSON lifecycle signals → compact status bubble
      if (body.startsWith('{')) {
        try {
          const j = JSON.parse(body);
          if (j && j.type) {
            teammateBlocks.push({
              id: tmId, color: tmColor, summary: null,
              content: null, status: j.type, statusFrom: j.from || tmId,
            });
            continue;
          }
        } catch {}
      }
      teammateBlocks.push({
        id: tmId, color: tmColor,
        summary: summaryMatch ? summaryMatch[1] : null,
        content: body, status: null,
      });
    }
  }

  // Bare protocol notification (not wrapped in <teammate-message>): harness-injected idle /
  // shutdown_* / teammate_terminated / plan_approval_* etc., extracted as teammate status
  // bubbles (rendered the same as the wrapped form). Deduped by status|from to avoid a
  // duplicate bubble alongside the wrapped form in the extreme case where one block has
  // both a wrapper and bare JSON.
  const seenStatus = new Set(teammateBlocks.filter(t => t.status).map(t => `${t.status}|${t.statusFrom}`));
  for (const b of content) {
    if (b.type !== 'text') continue;
    const txt = b.text || '';
    if (!txt.includes('"type"')) continue; // cheap early exit: a protocol notification must
    // contain JSON's "type"
    // Only emit a status bubble for blocks that "start with a notification" (aligned with
    // isSystemText's hide condition: lead prefix or bare-JSON start). A user quoting /
    // reposting a whole notification in their body (caveat-start, prose-start) keeps that
    // block as a user bubble — no extra ghost status bubble, no double rendering (review
    // qa-A / auditor-F1).
    const head = txt.trimStart();
    if (!head.startsWith('{') && !INTER_SESSION_LEAD_RE.test(head)) continue;
    const note = parseInterSessionNotification(txt);
    if (!note) continue;
    for (const s of note.statuses) {
      const from = s.from || 'teammate';
      const k = `${s.type}|${from}`;
      if (seenStatus.has(k)) continue;
      seenStatus.add(k);
      teammateBlocks.push({ id: from, color: null, summary: null, content: null, status: s.type, statusFrom: from });
    }
  }

  // Extract <task-notification> blocks from user content (early exit if none)
  const taskNotificationBlocks = [];
  const hasTaskNotification = content.some(b => b.type === 'text' && /<task-notification>/i.test(b.text || ''));
  if (hasTaskNotification) {
    for (const b of content) {
      if (b.type !== 'text') continue;
      const text = b.text || '';
      const tnRe = /<task-notification>([\s\S]*?)<\/task-notification>/gi;
      let tnMatch;
      while ((tnMatch = tnRe.exec(text)) !== null) {
        const inner = tnMatch[1];
        const field = (tag) => { const m = inner.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? m[1].trim() : null; };
        const usageBlock = inner.match(/<usage>([\s\S]*?)<\/usage>/i);
        let usage = null;
        if (usageBlock) {
          const uf = (tag) => { const m = usageBlock[1].match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? m[1].trim() : null; };
          usage = { totalTokens: Number(uf('total_tokens') || 0), toolUses: Number(uf('tool_uses') || 0), durationMs: Number(uf('duration_ms') || 0) };
        }
        taskNotificationBlocks.push({
          taskId: field('task-id'),
          status: field('status'),
          summary: field('summary'),
          result: field('result'),
          usage,
        });
      }
    }
  }

  const hasCommand = content.some(b => b.type === 'text' && /<command-message>/i.test(b.text || ''));

  // Extract slash command names
  const commands = [];
  if (hasCommand) {
    for (const b of content) {
      if (b.type !== 'text') continue;
      const m = (b.text || '').match(/<command-name>\s*([^<]*)<\/command-name>/i);
      if (m) {
        const cmd = m[1].trim();
        commands.push(cmd.startsWith('/') ? cmd : `/${cmd}`);
      }
    }
  }

  // Filter out non-system text blocks
  let textBlocks = content.filter(b => b.type === 'text' && !isSystemText(b.text));

  // Second-pass extraction: recover user text embedded in filtered system blocks
  // (e.g., /ultraplan merges the skill instruction and the user input into the same
  // <system-reminder> block). Run isSystemText once more after stripSystemTags — to avoid
  // wrongly recovering pure-marker text like [Request interrupted ...] (nothing stripable)
  // back into a user bubble
  for (const b of content) {
    if (b.type !== 'text' || !isSystemText(b.text)) continue;
    const userText = stripSystemTags(b.text);
    if (userText && !isSystemText(userText)) {
      textBlocks.push({ ...b, text: userText });
    }
  }

  // Filter out command-related blocks
  if (hasCommand) {
    textBlocks = textBlocks.filter(b => !/<command-message>/i.test(b.text || ''));
  }

  // Skill text (isSkillText) is necessarily filtered first by the same regex in isSystemText
  // ("Base directory for this skill:"), and both textBlocks entry paths (initial filter /
  // second-pass recovery) require !isSystemText, so a skill block can never appear in
  // textBlocks; the skillBlocks key is kept to preserve the returned shape (consumed by
  // ChatView/ImConversationModal).
  const skillBlocks = [];

  // Whether this round is UltraPlan input (the raw text still contains the
  // <system-reminder>[SCOPED INSTRUCTION] marker, not yet stripped by stripSystemTags).
  // Consumers (ChatView) use this to render an [UltraPlan] tag above the user bubble.
  const ultraplan = Array.isArray(content)
    && content.some(b => b && b.type === 'text' && isUltraplanText(b.text));

  return { commands, textBlocks, skillBlocks, teammateBlocks, taskNotificationBlocks, ultraplan };
}

/**
 * Extract a name from a teammate request's messages.
 * Scans the SendMessage tool_result for the routing.sender field.
 */
export function extractTeammateName(body) {
  const msgs = body?.messages;
  if (!Array.isArray(msgs)) return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const content = msgs[i].content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const items = Array.isArray(block.content) ? block.content : [block];
      for (const item of items) {
        const text = item.text || (typeof item.content === 'string' ? item.content : '');
        if (!text || !text.includes('"sender"')) continue;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.routing?.sender) return parsed.routing.sender;
        } catch { /* not JSON, skip */ }
      }
    }
  }
  return null;
}

// ============== Teammate name resolution (prompt content matching) ==============

// Persistent registry: Agent tool_use prompt prefix → teammate name
const _promptRegistry = new Map();
// Requests whose response has been scanned for Agent tool_use blocks. A request
// is only added once its response is present, so a spawn turn that completes
// LATE (it was in-flight and therefore excluded from the filtered array, then
// INSERTED mid-array on completion) still gets scanned — the old positional
// cursor skipped it forever. WeakSet cannot be cleared, so it is recreated on
// session switch.
let _registryScanned = new WeakSet();
// Identify the session by the first request's timestamp; auto-reset on switch
let _registrySessionKey = null;

const PROMPT_PREFIX_LEN = 60;
const TM_TAG_RE = /<teammate-message[^>]*>/;

/**
 * Extract the prompt content after <teammate-message> from a teammate's first user message.
 */
function _extractSpawnPrompt(req) {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return '';
  const first = msgs[0];
  const content = first.content;
  if (typeof content === 'string') {
    const m = TM_TAG_RE.exec(content);
    if (!m) return '';
    return content.slice(m.index + m[0].length).trimStart();
  }
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type !== 'text' || !b.text) continue;
      const m = TM_TAG_RE.exec(b.text);
      if (!m) continue;
      return b.text.slice(m.index + m[0].length).trimStart();
    }
  }
  return '';
}

/**
 * v2.1.90+ Agent mode: a native teammate's first user message is a raw prompt (no
 * <teammate-message> wrapper). Extract the first user message's text directly for prompt
 * prefix matching.
 */
function _extractRawPrompt(req) {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return '';
  const first = msgs[0];
  const content = first.content;
  if (typeof content === 'string') return content.trimStart();
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text' && b.text) return b.text.trimStart();
    }
  }
  return '';
}

/**
 * Pre-scan requests and inject req.teammate names by matching the MainAgent's Agent
 * tool_use prompt against a native teammate's first message content.
 *
 * Must be called before classifyRequest (its result is WeakMap-cached). Version compatible:
 * requests that already have req.teammate (interceptor mode) are unaffected.
 */
export function resolveTeammateNames(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return;

  // Detect session switch via the first request's timestamp; auto-reset
  const sessionKey = requests[0]?.timestamp || null;
  if (sessionKey !== _registrySessionKey) {
    _promptRegistry.clear();
    _registryScanned = new WeakSet();
    _registrySessionKey = sessionKey;
  }
  // Step 1: scan MainAgent responses for Agent tool_use blocks, building the
  // prompt-prefix → name map. Full walk with O(1) WeakSet skips; a request is
  // marked scanned ONLY when its response exists, so it is re-visited (cheap,
  // two property reads) until the response arrives, then scanned exactly once.
  // Map.set overwrites, so a re-scan is idempotent anyway.
  for (const req of requests) {
    if (_registryScanned.has(req)) continue;
    if (!req.mainAgent) { _registryScanned.add(req); continue; }
    const content = req.response?.body?.content;
    if (!req.response) continue;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type !== 'tool_use' || block.name !== 'Agent') continue;
        const inp = block.input;
        if (!inp || !inp.name || !inp.prompt) continue;
        const prefix = inp.prompt.trimStart().slice(0, PROMPT_PREFIX_LEN);
        if (prefix) _promptRegistry.set(prefix, inp.name);
      }
    }
    _registryScanned.add(req);
  }

  if (_promptRegistry.size === 0) return;

  // Step 2: inject req.teammate for native/proxy teammates that lack a name
  for (const req of requests) {
    if (req.teammate) continue;
    if (!isNativeTeammate(req) && !TEAMMATE_SYSTEM_RE.test(getSystemText(req.body || {}))) continue;

    let prompt = _extractSpawnPrompt(req);
    // v2.1.90+ Agent mode fallback: try the raw prompt when there is no <teammate-message>
    if (!prompt && isNativeTeammate(req)) prompt = _extractRawPrompt(req);
    if (!prompt) continue;
    const prefix = prompt.slice(0, PROMPT_PREFIX_LEN);

    // Exact prefix match
    const name = _promptRegistry.get(prefix);
    if (name) {
      req.teammate = name;
      // Clear any possibly-cached classifyRequest result (the old cache with subType null)
      if (req._cachedTeammateName === null) req._cachedTeammateName = name;
    }
  }
}
