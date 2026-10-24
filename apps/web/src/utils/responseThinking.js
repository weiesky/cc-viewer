// Display-only recovery for response thinking omitted from later request history.
// Never writes restored blocks back into requests, sessions, or response bodies.

const defaultIsMainAgent = (entry) => entry?.mainAgent === true;

function isThinkingBlock(block) {
  return block?.type === 'thinking' || block?.type === 'redacted_thinking';
}

// Tool inputs may be enriched in later request history, so identity deliberately
// uses tool_use.id rather than object equality. Unsupported block kinds make the
// association ambiguous and are never guessed around.
function contentAnchors(content) {
  if (!Array.isArray(content)) return null;
  const anchors = [];
  for (const block of content) {
    if (isThinkingBlock(block)) continue;
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      anchors.push(['text', block.text]);
    } else if (block?.type === 'tool_use' && typeof block.id === 'string' && block.id.length > 0) {
      anchors.push(['tool_use', block.id]);
    } else {
      return null;
    }
  }
  return anchors;
}

function sameAnchors(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i][0] !== right[i][0] || left[i][1] !== right[i][1]) return false;
  }
  return true;
}

function registerUnique(map, key, candidate) {
  if (map.has(key)) map.set(key, null);
  else map.set(key, candidate);
}

function registerNested(index, epoch, timestamp, candidate) {
  let byTimestamp = index.byTimestamp.get(epoch);
  if (!byTimestamp) {
    byTimestamp = new Map();
    index.byTimestamp.set(epoch, byTimestamp);
  }
  registerUnique(byTimestamp, timestamp, candidate);
}

function registerCarrierProvenance(entries, index, isMainAgent) {
  const previousByScope = new Map();
  for (const carrier of entries || []) {
    if (!carrier || !isMainAgent(carrier) || typeof carrier.timestamp !== 'string') continue;
    const scope = `${carrier._sessionId || ''}\n${carrier._seqEpoch || ''}`;
    const previous = previousByScope.get(scope);
    const messages = Array.isArray(carrier.body?.messages) ? carrier.body.messages : null;
    if (previous && messages && carrier.timestamp > previous.timestamp) {
      const start = Number.isInteger(carrier._prevMsgCount) ? carrier._prevMsgCount : 0;
      for (let i = start; i < messages.length; i++) {
        const message = messages[i];
        if (message?.role !== 'assistant' || index.byMessage.has(message)) continue;
        const candidate = index.byTimestamp.get(previous._seqEpoch || null)?.get(previous.timestamp);
        if (candidate && (!message._timestamp || previous.timestamp < message._timestamp)) {
          index.byMessage.set(message, { candidate, carrier });
        }
      }
    }
    if (messages) previousByScope.set(scope, carrier);
  }
}

/** Build a fresh index from the current request snapshot. */
export function buildResponseThinkingIndex(entries, isMainAgent = defaultIsMainAgent) {
  const index = { byTimestamp: new Map(), byAnchor: new Map(), byMessage: new WeakMap() };
  const timestamps = new Set();
  const duplicateTimestamps = new Set();
  for (const entry of entries || []) {
    if (!entry || entry._syntheticV2 || !isMainAgent(entry) || typeof entry.timestamp !== 'string' || !entry.timestamp) continue;
    const key = `${entry._seqEpoch || ''}\n${entry.timestamp}`;
    if (timestamps.has(key)) duplicateTimestamps.add(key);
    else timestamps.add(key);
  }
  for (const entry of entries || []) {
    if (!entry || entry.inProgress || entry._syntheticV2 || !isMainAgent(entry)) continue;
    const content = entry.response?.body?.content;
    if (!Array.isArray(content) || typeof entry.timestamp !== 'string' || !entry.timestamp) continue;
    if (duplicateTimestamps.has(`${entry._seqEpoch || ''}\n${entry.timestamp}`)) continue;
    const thinking = content.filter((block) => block?.type === 'thinking');
    if (thinking.length === 0) continue;
    const anchors = contentAnchors(content);
    if (!anchors) continue;
    const epoch = entry._seqEpoch || null;
    const candidate = {
      content, thinking, anchors, epoch, timestamp: entry.timestamp,
      sessionId: entry._sessionId || null,
    };
    registerNested(index, epoch, candidate.timestamp, candidate);
    if (anchors.length > 0) {
      let byAnchor = index.byAnchor.get(epoch);
      if (!byAnchor) {
        byAnchor = new Map();
        index.byAnchor.set(epoch, byAnchor);
      }
      registerUnique(byAnchor, JSON.stringify(anchors), candidate);
    }
  }
  registerCarrierProvenance(entries, index, isMainAgent);
  return index;
}

function thinkingKey(block) {
  return typeof block.signature === 'string' && block.signature.length > 0
    ? `signature:${block.signature}`
    : `text:${typeof block.thinking === 'string' ? block.thinking : ''}`;
}

function thinkingSnapshot(content) {
  return (content || []).filter((block) => block?.type === 'thinking').map((block) => ({
    block,
    thinking: block.thinking,
    signature: block.signature,
  }));
}

function sameThinkingSnapshot(left, right) {
  return left.length === right.length && left.every((item, i) => (
    item.block === right[i].block
    && item.thinking === right[i].thinking
    && item.signature === right[i].signature
  ));
}

function sameBlockRefs(left, right) {
  return left.length === right.length && left.every((block, i) => block === right[i]);
}

function restoreMessageThinking(message, candidate, cache) {
  const source = message.content;
  const responseContent = candidate.content;
  const sourceThinking = thinkingSnapshot(source);
  const responseThinking = thinkingSnapshot(responseContent);
  const cached = cache?.get(message);
  if (cached && cached.source === source && cached.responseContent === responseContent
      && sameBlockRefs(cached.sourceBlocks, source)
      && sameThinkingSnapshot(cached.sourceThinking, sourceThinking)
      && sameThinkingSnapshot(cached.responseThinking, responseThinking)) {
    return cached.content;
  }

  const existing = new Map();
  for (const item of sourceThinking) {
    const key = thinkingKey(item.block);
    existing.set(key, (existing.get(key) || 0) + 1);
  }
  const missing = new Map();
  const positions = new Array(responseContent.length).fill(null);
  let sourceIndex = 0;
  for (let i = 0; i < responseContent.length; i++) {
    const block = responseContent[i];
    if (block.type === 'thinking') {
      const key = thinkingKey(block);
      const count = existing.get(key) || 0;
      if (count > 0) existing.set(key, count - 1);
      else missing.set(i, block);
      continue;
    }
    if (block.type === 'redacted_thinking') {
      // Redacted blocks have no visible renderer, but an existing block can
      // still provide a position for a later visible thinking insertion.
      for (let j = sourceIndex; j < source.length; j++) {
        if (source[j]?.type === 'redacted_thinking' && source[j].data === block.data) {
          positions[i] = j;
          sourceIndex = j + 1;
          break;
        }
      }
      continue;
    }
    while (sourceIndex < source.length && isThinkingBlock(source[sourceIndex])) sourceIndex++;
    if (sourceIndex < source.length) positions[i] = sourceIndex++;
  }
  const insertions = new Map();
  let nextPosition = source.length;
  for (let i = responseContent.length - 1; i >= 0; i--) {
    if (positions[i] !== null) nextPosition = positions[i];
    if (!missing.has(i)) continue;
    const blocks = insertions.get(nextPosition) || [];
    // Reverse traversal finds insertion positions; unshift restores wire order
    // for consecutive thinking blocks at the same position.
    blocks.unshift(missing.get(i));
    insertions.set(nextPosition, blocks);
  }
  let content = source;
  if (insertions.size > 0) {
    content = [];
    for (let i = 0; i <= source.length; i++) {
      const before = insertions.get(i);
      if (before) content.push(...before);
      if (i < source.length) content.push(source[i]);
    }
  }
  cache?.set(message, {
    source,
    responseContent,
    sourceBlocks: source.slice(),
    sourceThinking,
    responseThinking,
    content,
  });
  return content;
}

function withinLegacySession(candidate, session, message, resolvedEpoch, carrier) {
  if (message?._timestamp && candidate.timestamp >= message._timestamp) return false;
  const epoch = resolvedEpoch ?? session._seqEpoch ?? null;
  if (candidate.epoch || epoch) return candidate.epoch === epoch;
  if (carrier && message?._timestamp && carrier.timestamp !== message._timestamp) return false;
  const sessionId = session._sessionId || session.sessionId;
  const carrierSessionId = carrier?._sessionId || sessionId;
  if (candidate.sessionId && carrierSessionId && candidate.sessionId !== carrierSessionId) return false;
  if (candidate.sessionId && sessionId && candidate.sessionId !== sessionId) return false;
  const firstTs = session.messages?.[0]?._timestamp;
  const lastTs = session.entryTimestamp;
  if (firstTs && candidate.timestamp < firstTs) return false;
  if (lastTs && candidate.timestamp > lastTs) return false;
  return true;
}

function producerEpoch(session) {
  return session?._seqEpoch ?? null;
}

/**
 * Return display contents aligned with session.messages and the exact response
 * content arrays whose thinking is visible in those messages. A response must
 * map to exactly one assistant message; ambiguous matches restore nothing.
 */
export function buildSessionThinkingDisplay(session, index, cache = new WeakMap()) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const contents = messages.map((message) => message?.content);
  const displayedResponses = new Set();
  const matches = new Map();
  const defaultEpoch = session?._seqEpoch || null;
  const defaultByTimestamp = index?.byTimestamp.get(defaultEpoch);
  const defaultByAnchor = index?.byAnchor.get(defaultEpoch);
  if (!defaultByTimestamp && !defaultByAnchor && messages.every((message) => (
    message?.role !== 'assistant' || !index?.byMessage.has(message)
  ))) {
    return { contents, displayedResponses, restoredCount: 0 };
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const epoch = producerEpoch(session);
    const byTimestamp = epoch === defaultEpoch ? defaultByTimestamp : index?.byTimestamp.get(epoch);
    const byAnchor = epoch === defaultEpoch ? defaultByAnchor : index?.byAnchor.get(epoch);
    if (!byTimestamp && !byAnchor) continue;
    const anchors = contentAnchors(message.content);
    if (!anchors) continue;
    const evidence = index?.byMessage.get(message);
    let candidate = evidence?.candidate;
    let resolvedEpoch = candidate?.epoch ?? epoch;
    if (!candidate && message._generatedTs) {
      candidate = byTimestamp?.get(message._generatedTs);
    }
    if (!candidate && !message._generatedTs && anchors.length > 0 && message._timestamp) {
      candidate = byAnchor?.get(JSON.stringify(anchors));
    }
    if (!candidate || !withinLegacySession(candidate, session, message, resolvedEpoch, evidence?.carrier) || !sameAnchors(candidate.anchors, anchors)) continue;
    let targets = matches.get(candidate);
    if (!targets) {
      targets = [];
      matches.set(candidate, targets);
    }
    targets.push(i);
  }

  let restoredCount = 0;
  for (const [candidate, targets] of matches) {
    if (targets.length !== 1) continue;
    const messageIndex = targets[0];
    contents[messageIndex] = restoreMessageThinking(messages[messageIndex], candidate, cache);
    displayedResponses.add(candidate.content);
    restoredCount++;
  }
  return { contents, displayedResponses, restoredCount };
}

/** Remove thinking only when this exact response is already visible in a message. */
export function filterDisplayedResponseThinking(lrContent, responseContent, displayedResponses) {
  if (!displayedResponses?.has(responseContent)) return lrContent;
  return (lrContent || []).filter((block) => block?.type !== 'thinking');
}
