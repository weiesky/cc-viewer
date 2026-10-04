// Terminal send anchor (2026-10-05): chat sends carry the viewed project's
// { project, sessionId } so the server routes the input to that conversation's
// PTY — not whichever record the global activePtyKey last pointed to. This is
// what keeps [终端] and [对话] consistent across a mid-stream view switch.
// Multi-instance (2026-10-06): the anchor also carries the viewed `instanceKey` so a send to
// a same-cwd project (two concurrent instances share a basename) lands on THIS process.
//
// Pure + dependency-injected so it is directly node-testable without a DOM.

import { getSeqEpochUuid } from './sessionManager.js';

/**
 * Compute the anchor to attach to a terminal-bound send frame.
 *
 * @param {object} opts
 * @param {string} [opts.viewProject] - viewed parallel project (or bound project name).
 * @param {string} [opts.projectName] - bound project fallback.
 * @param {string} [opts.viewInstance] - viewed process instanceKey (same-cwd disambiguation).
 * @param {string} [opts.attachedSid] - attached historical session uuid (pure view).
 * @param {Array} [opts.mainAgentSessions] - rendered sessions (the [对话] source of truth).
 * @returns {{ project: string|null, sessionId: string|null, instanceKey: string|null }}
 */
export function terminalAnchor({ viewProject, projectName, viewInstance, attachedSid, mainAgentSessions } = {}) {
  const project = (typeof viewProject === 'string' && viewProject)
    || (typeof projectName === 'string' && projectName)
    || null;
  const instanceKey = (typeof viewInstance === 'string' && /^ccv-[0-9a-f]+$/.test(viewInstance)) ? viewInstance : null;
  // Attaching a historical session is a pure VIEW — it has no live PTY turn, so
  // we must not claim a sessionId (the send degrades to project routing).
  let sessionId = null;
  if (!attachedSid) {
    const sessions = Array.isArray(mainAgentSessions) ? mainAgentSessions : [];
    const last = sessions.length ? sessions[sessions.length - 1] : null;
    sessionId = getSeqEpochUuid(last && last._seqEpoch);
  }
  return { project, sessionId, instanceKey };
}
