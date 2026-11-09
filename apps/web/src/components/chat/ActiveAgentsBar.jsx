import React, { useEffect, useMemo, useState } from 'react';
import { Tooltip } from 'antd';
import { t } from '../../i18n';
import { getSvgAvatar } from '../../utils/helpers';
import { getTeammateAvatar } from '../../utils/teammateAvatars';
import { subscribe, getSnapshot } from '../../utils/taskStore';
import {
  buildAgentToolUseMap,
  deriveActiveAgents,
  resolveAgentIdentity,
} from '../../utils/activeAgents';
import styles from './ActiveAgentsBar.module.css';

/**
 * Active subAgent/teammate strip — pinned to the conversation panel's top-right
 * (28px tall, frosted glass, 24px circular avatars) in `--sdk` mode.
 *
 * Data: the SDK relays task_started/progress/updated/notification as WS
 * `sdk-task` frames → sdkTaskTracker → taskStore. This component derives the
 * active agent set from the taskStore snapshot (taskType ∈ {local_agent,
 * in_process_teammate}, non-terminal status) and auto-hides (returns null) when
 * there is nothing active. It does NOT own the focus/restore lifecycle — that
 * lives in ChatView's componentDidUpdate — because this bar can be unmounted on
 * a workspace switch and must not be the only place that resets the filter.
 *
 * Identity: each agent's real name/avatar type comes from joining the spawn
 * Agent/Task tool_use block (by toolUseId, else prompt prefix) — the task frame
 * alone has no reliable name (descriptions are short blurbs, teammate names may
 * contain spaces). The join needs the transcript, so ChatView passes `requests`.
 *
 * Interaction: click an avatar → focus that agent (filter the conversation to
 * its rows); click again → restore all. A trailing (ALL) avatar always restores
 * everything. Unmatchable agents (a teammate whose name could not be resolved)
 * are shown but non-clickable, so they never produce a dead, blank filter.
 */
export default function ActiveAgentsBar({ requests, selectedKey = null, onSelect, onShowAll, onVisibleChange }) {
  const [snapshot, setSnapshot] = useState(getSnapshot);
  useEffect(() => subscribe(setSnapshot), []);

  // Resolve identities against the transcript. Memoized on the snapshot + the
  // request list so a re-render from an unrelated ChatView setState does not
  // rebuild the tool_use map.
  const agents = useMemo(() => {
    const active = deriveActiveAgents(snapshot.tasks);
    if (active.length === 0) return [];
    const toolUseMap = buildAgentToolUseMap(requests);
    // Teammates share one avatar per resolved name (the same teammate may have
    // several concurrent tasks); subagents stay one-per-task.
    const seenTeammates = new Set();
    const out = [];
    for (const agent of active) {
      const identity = resolveAgentIdentity(agent, toolUseMap);
      if (identity.kind === 'teammate') {
        if (seenTeammates.has(identity.key)) continue;
        seenTeammates.add(identity.key);
      }
      out.push(identity);
    }
    return out;
  }, [snapshot, requests]);

  const visible = agents.length > 0;

  // Notify ChatView only on boolean flips so it can reserve top padding without
  // subscribing to taskStore itself.
  useEffect(() => {
    if (typeof onVisibleChange === 'function') onVisibleChange(visible);
  }, [visible, onVisibleChange]);

  // Focus reset lives HERE (the component holding the derived `agents` list),
  // not only in ChatView's cDU backstop: when the focused agent's task ends while
  // OTHERS stay active, the bar re-renders but ChatView does not (it never
  // subscribed to taskStore and `visible` is still true), so the backstop never
  // runs and the conversation would stay filtered to a dead agent. Restore "all"
  // the moment the selected key is no longer among the active agents. The `if
  // (!selectedKey) return` guard keeps this from looping.
  const focused = !!selectedKey && agents.some((a) => a.key === selectedKey);
  useEffect(() => {
    if (selectedKey && !focused && typeof onShowAll === 'function') onShowAll();
  }, [selectedKey, focused, onShowAll]);

  // Hooks above this line always run; the early return must stay below them.
  if (!visible) return null;

  return (
    <div className={`${styles.bar}${focused ? ` ${styles.barFocused}` : ''}`}
      role="group" aria-label={t('ui.activeAgents.title')}>
      {agents.map((agent) => {
        const selected = agent.key === selectedKey;
        // Avatar policy mirrors the transcript rows: teammates use the static
        // (animation-stripped) portrait + hashed bg var; anonymous subagents use
        // the sub-* glyph for their inferred type on the shared sub-avatar bg.
        const tm = agent.kind === 'teammate' && agent.name
          ? getTeammateAvatar(agent.name, { animated: false })
          : null;
        const bg = tm ? tm.color : 'var(--bg-sub-avatar)';
        const svg = tm ? tm.svg : getSvgAvatar(agent.avatarType);
        const title = agent.title || agent.name || t('ui.stats.subAgent');
        const chip = (
          <button
            key={agent.key}
            type="button"
            className={`${styles.avatarBtn}${selected ? ` ${styles.avatarBtnActive}` : ''}`}
            onClick={agent.matchable ? () => onSelect(agent) : undefined}
            aria-label={title}
            aria-pressed={selected}
            aria-disabled={!agent.matchable}
          >
            <span className={styles.avatar} style={{ background: bg }}
              dangerouslySetInnerHTML={{ __html: svg }} />
          </button>
        );
        // Wrap in a Tooltip so even the non-clickable (aria-disabled) entries get a
        // hover explanation; a native HTML title attribute would not fire on a
        // disabled button.
        return (
          <Tooltip key={agent.key} title={title} mouseEnterDelay={0.3}>
            {chip}
          </Tooltip>
        );
      })}
      <Tooltip title={t('ui.activeAgents.showAll')} mouseEnterDelay={0.3}>
        <button
          type="button"
          className={`${styles.avatarBtn}${!selectedKey ? ` ${styles.avatarBtnActive}` : ''}`}
          onClick={onShowAll}
          aria-label={t('ui.activeAgents.showAll')}
          aria-pressed={!selectedKey}
        >
          <span className={styles.allAvatar}>{t('ui.activeAgents.all')}</span>
        </button>
      </Tooltip>
    </div>
  );
}
