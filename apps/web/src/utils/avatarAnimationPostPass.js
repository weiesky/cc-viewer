import React from 'react';
import { shouldAnimateTeammateAvatar, pickAvatarAnimationTargets } from './teammateAvatars';

/**
 * Avatar animation loading strategy — post-pass applied at the end of
 * ChatView.buildAllItems, once every item (and the out-of-band Last Response
 * timestamp) is known. Teammate rows animate their one-shot draw-in only when
 * within the 60s window of the newest item's timestamp; the single newest
 * teammate row always animates ("welcome flourish" on historic logs). Losers
 * get cloneElement({ animateAvatar: false }) — winners keep their original
 * element reference so cached elements skip reconciliation entirely.
 *
 * The flags are frozen per build: the window is measured against the newest
 * item's timestamp, NOT wall clock (do not "fix" with Date.now()); they
 * refresh whenever new data rebuilds the list.
 *
 * @param {Array} items - freshly built ChatMessage element array; mutated in place
 * @param {string|null} lastResponseTs - session.entryTimestamp of the Last
 *   Response block, which lives OUTSIDE items but must count toward "newest"
 * @returns {Array} the same array, with stale teammate rows cloned to static
 */
export function applyAvatarAnimationTargets(items, lastResponseTs = null) {
  const scanEntries = items.map((item) => ({
    ts: item?.props?.timestamp,
    isTeammateAvatar: isTeammateAvatarItem(item?.props),
  }));
  if (lastResponseTs) scanEntries.push({ ts: lastResponseTs, isTeammateAvatar: false });
  const { latestMs, newestTeammateIdx } = pickAvatarAnimationTargets(scanEntries);
  if (newestTeammateIdx === -1) return items;
  for (let i = 0; i < items.length; i++) {
    if (!scanEntries[i].isTeammateAvatar) continue;
    const animate = i === newestTeammateIdx ||
      shouldAnimateTeammateAvatar(items[i].props.timestamp, latestMs);
    if (!animate) items[i] = React.cloneElement(items[i], { animateAvatar: false });
  }
  return items;
}

// Mirrors ChatMessage.render()'s THREE teammate-avatar branches:
// renderSubAgentChatMessage (role 'sub-agent-chat'), renderSubAgentMessage
// (role 'sub-agent' — currently never constructed, covered defensively), and
// renderTeammateMessage (role 'teammate-message'). If ChatMessage gains a new
// teammate-avatar branch, add it here — rows missed by this predicate default
// to animated forever.
export function isTeammateAvatarItem(props) {
  if (!props) return false;
  return ((props.role === 'sub-agent-chat' || props.role === 'sub-agent') && props.isTeammate)
    || props.role === 'teammate-message';
}
