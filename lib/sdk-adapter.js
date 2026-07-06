/**
 * sdk-adapter.js — Convert Agent SDK messages to JSONL entry format.
 *
 * The frontend expects entries shaped like intercepted Claude API request/response pairs.
 * This adapter converts SDKAssistantMessage objects into that format so the
 * existing SSE pipeline and ChatView rendering work unchanged.
 */

// Minimal tool stubs — only used as fallback if SDK doesn't provide real tools
const STUB_TOOLS = [
  { name: 'Bash' }, { name: 'Edit' }, { name: 'Read' },
  { name: 'Write' }, { name: 'Glob' }, { name: 'Agent' },
];

/**
 * Convert an SDK assistant message + accumulated conversation into a JSONL entry.
 *
 * @param {object} assistantMsg — SDKAssistantMessage (has .message: BetaMessage)
 * @param {Array} messages — Accumulated conversation messages [{role, content}]
 * @param {string} model — Model name
 * @param {string} projectName — Project name
 * @param {object} [opts] — Additional options
 * @param {string} [opts.timestamp] — Stable timestamp for dedup (same per turn)
 * @param {boolean} [opts.inProgress] — Whether response is still streaming
 * @param {string} [opts.requestId] — Request ID for in-progress entries
 * @param {Array} [opts.tools] — Real tools list from SDK init message
 * @returns {object} JSONL entry compatible with frontend expectations
 */
export function sdkToJSONLEntry(assistantMsg, messages, model, projectName, opts = {}) {
  const respBody = assistantMsg?.message || null;
  const entry = {
    timestamp: opts.timestamp || new Date().toISOString(),
    project: projectName || 'sdk',
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    headers: {},
    body: {
      model: model || respBody?.model || 'claude-opus-4-6',
      system: [{ type: 'text', text: 'You are Claude Code' }],
      tools: opts.tools || STUB_TOOLS,
      messages: messages || [],
      metadata: {},
    },
    response: opts.inProgress ? null : {
      status: 200,
      statusText: 'OK',
      headers: {},
      body: respBody,
    },
    duration: 0,
    isStream: false,
    mainAgent: true,
  };

  if (opts.inProgress) {
    entry.inProgress = true;
    entry.requestId = opts.requestId || `sdk_${Date.now()}`;
  }

  return entry;
}

/**
 * Build a streaming status event payload.
 */
export function buildStreamingStatus(active, meta = {}) {
  if (active) {
    return {
      active: true,
      model: meta.model || null,
      startTime: meta.startTime || Date.now(),
      bytesReceived: 0,
      chunksReceived: 0,
    };
  }
  return { active: false };
}
