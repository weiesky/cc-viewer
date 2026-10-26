import { classifyUserContent, extractDisplayText } from '@ccv/core/contentFilter';
import { extractQueuedPromptWireMessage } from '@ccv/core/queued-prompt';

function sameScope(pending, scope) {
  return pending.project === scope.project
    && pending.instanceKey === scope.instanceKey
    && pending.attachedSid === scope.attachedSid;
}

function userTexts(session) {
  const counts = new Map();
  const add = (text) => { if (text) counts.set(text, (counts.get(text) || 0) + 1); };
  const collect = (content) => {
    if (typeof content === 'string') add(extractDisplayText(content));
    else if (Array.isArray(content)) {
      for (const block of classifyUserContent(content).textBlocks) add(block.text);
    }
  };
  for (const message of session?.messages || []) {
    if (message.role === 'user') collect(message.content);
    else if (message.role === 'system') add(extractQueuedPromptWireMessage(message)?.content);
  }
  for (const prompt of session?._ccvQueuedPrompts || []) collect(prompt.content);
  return counts;
}

/** Reconcile local send-now placeholders with the authoritative queue and transcript. */
export function reconcileOptimisticQueueMessages(pending, session, queuedItems, scope, { allowTextAck = true } = {}) {
  const items = Array.isArray(pending) ? pending : [];
  if (items.length === 0) return items;
  const queued = new Map((Array.isArray(queuedItems) ? queuedItems : []).map((item) => [item.id, item]));
  const remaining = allowTextAck ? userTexts(session) : new Map();
  const result = [];
  for (const item of items) {
    if (!sameScope(item, scope)) continue;
    const queueItem = queued.get(item.id);
    // Only a queue update AFTER dispatching can restore the real bubble. The
    // pre-click queued mirror is stale and must not erase a fresh placeholder.
    if (item.dispatchingSeen && queueItem && queueItem.status !== 'dispatching') continue;
    const count = remaining.get(item.text) || 0;
    if (allowTextAck && count > (item.baselineTextCount || 0)) {
      remaining.set(item.text, count - 1);
      continue;
    }
    result.push(item);
  }
  return result;
}

/** Snapshot matching text counts so old identical prompts cannot ack a new send. */
export function captureOptimisticQueueTextCounts(session) {
  return Object.fromEntries(userTexts(session));
}
