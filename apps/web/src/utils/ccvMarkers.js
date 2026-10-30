/**
 * Synthetic cc-viewer control prompts that are pushed into the SDK session history as
 * real user messages but must NOT render as a chat bubble (the model still reads the
 * instruction; transcript / request-panel views keep them — hiding is chat-bubble-only).
 *
 * `[cc-viewer:retry] ...` is the continue instruction pushed by the manual [retry]
 * affordance after a retryable API failure (502/network/turn-stuck). See
 * packages/app/server/lib/sdk-manager.js RETRY_CONTINUE_PROMPT.
 */
const CCV_RETRY_PREFIX = '[cc-viewer:retry]';

export function isCcvRetryPrompt(text) {
  return typeof text === 'string' && text.trimStart().startsWith(CCV_RETRY_PREFIX);
}
