// CLIENT-SAFE: no node deps. Home: @ccv/core (queued-prompt.js) — consumed by apps/web + packages/app.
// Display-only recovery of user prompts inserted while Claude Code is working.
// The original JSONL and model wire roles/content are never changed by these helpers.

import { extractDisplayText } from './contentFilter.js';

const WIRE_PREFIX = 'The user sent a new message while you were working:\n';
const WIRE_SUFFIX = '\n\nIMPORTANT: After completing your current task, you MUST address the user\'s message above. Do not ignore it.';

/** Extract a prompt from Claude Code's exact mid-conversation-system envelope. */
export function extractQueuedPromptWireMessage(message) {
  if (!message || message.role !== 'system') return null;
  const textBlocks = typeof message.content === 'string'
    ? [message.content]
    : Array.isArray(message.content)
      ? message.content.filter((block) => block?.type === 'text').map((block) => block.text)
      : [];
  if (textBlocks.length !== 1 || typeof textBlocks[0] !== 'string') return null;
  const text = textBlocks[0];
  if (!text.startsWith(WIRE_PREFIX) || !text.endsWith(WIRE_SUFFIX)) return null;
  const content = text.slice(WIRE_PREFIX.length, -WIRE_SUFFIX.length);
  return content ? { content, source: 'wire' } : null;
}

function hasDisplayText(content) {
  if (typeof content === 'string') return !!extractDisplayText(content);
  if (!Array.isArray(content)) return false;
  return content.some((block) => block?.type === 'text' && !!extractDisplayText(block.text));
}

/** Render a recovered prompt without changing its transcript/model representation. */
export function queuedPromptDisplayText(content) {
  if (typeof content === 'string') return extractDisplayText(content);
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => extractDisplayText(block.text))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Convert a confirmed Claude Code transcript queue record to a display input.
 * An enqueue alone is deliberately insufficient: it may still be pending or cancelled.
 */
export function extractQueuedPromptTranscriptLine(line, position = 0) {
  if (!line || line.isSidechain === true || line.isMeta === true) return null;
  const attachment = line.type === 'attachment' ? line.attachment : null;
  if (attachment) {
    if (attachment.type !== 'queued_command' || attachment.commandMode !== 'prompt') return null;
    const origin = attachment.origin?.kind;
    const sdkBlocks = line.entrypoint === 'sdk-ts' && !origin && Array.isArray(attachment.prompt);
    if (origin !== 'human' && !sdkBlocks) return null;
    const content = attachment.prompt;
    if (!hasDisplayText(content)) return null;
    return {
      content,
      source: 'queued_command',
      sourceId: line.uuid || `queued_command:${position}`,
      parentUuid: line.parentUuid || null,
      sessionId: line.sessionId || null,
      submittedTimestamp: attachment.timestamp || line.timestamp || null,
    };
  }
  return null;
}
