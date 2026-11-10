/**
 * activeAgents.test.js — covers src/utils/activeAgents.js
 *
 * Plain node:test (no jsdom/React), same style as sdkTaskTracker.test.js.
 * Pins down the pure derivation / identity-join / label-match logic that backs
 * the SDK active-agents strip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_TASK_TYPES,
  PROMPT_PREFIX_LEN,
  buildAgentToolUseMap,
  avatarTypeFromSubType,
  avatarTypeFromSubLabel,
  isTeammateLabel,
  isSubAgentLabel,
  deriveActiveAgents,
  resolveAgentIdentity,
  labelMatchesAgent,
  promptMatchesAgent,
  firstUserText,
  transcriptRowMatchesAgent,
  isFocusActive,
} from '../src/utils/activeAgents.js';

describe('activeAgents.js', () => {
  it('AGENT_TASK_TYPES contains only local_agent + in_process_teammate', () => {
    assert.ok(AGENT_TASK_TYPES.has('local_agent'));
    assert.ok(AGENT_TASK_TYPES.has('in_process_teammate'));
    assert.ok(!AGENT_TASK_TYPES.has('local_bash'));
    assert.ok(!AGENT_TASK_TYPES.has('local_workflow'));
  });

  it('PROMPT_PREFIX_LEN matches @ccv/core (60)', () => {
    assert.equal(PROMPT_PREFIX_LEN, 60);
  });

  describe('avatarTypeFromSubType / avatarTypeFromSubLabel', () => {
    it('maps subagent subtypes to sub-* icon types', () => {
      assert.equal(avatarTypeFromSubType('Explore'), 'sub-search');
      assert.equal(avatarTypeFromSubType('Search'), 'sub-search');
      assert.equal(avatarTypeFromSubType('explore'), 'sub-search');
      assert.equal(avatarTypeFromSubType('Plan'), 'sub-plan');
      assert.equal(avatarTypeFromSubType('General'), 'sub');
      assert.equal(avatarTypeFromSubType('Bash'), 'sub');
      assert.equal(avatarTypeFromSubType(null), 'sub');
    });
    it('derives icon type from a SubAgent:<type> label (with or without space)', () => {
      assert.equal(avatarTypeFromSubLabel('SubAgent:Search'), 'sub-search');
      assert.equal(avatarTypeFromSubLabel('SubAgent: Explore'), 'sub-search');
      assert.equal(avatarTypeFromSubLabel('SubAgent:Plan'), 'sub-plan');
      assert.equal(avatarTypeFromSubLabel('SubAgent:General'), 'sub');
      assert.equal(avatarTypeFromSubLabel('SubAgent'), 'sub');
    });
  });

  describe('label predicates', () => {
    it('isTeammateLabel', () => {
      assert.ok(isTeammateLabel('Teammate: reviewer(claude-opus-4-8)'));
      assert.ok(isTeammateLabel('Teammate: reviewer'));
      assert.ok(!isTeammateLabel('SubAgent:Search'));
      assert.ok(!isTeammateLabel(''));
    });
    it('isSubAgentLabel covers bare SubAgent and SubAgent:*', () => {
      assert.ok(isSubAgentLabel('SubAgent'));
      assert.ok(isSubAgentLabel('SubAgent:Search'));
      assert.ok(!isSubAgentLabel('Teammate: x'));
      assert.ok(!isSubAgentLabel('assistant'));
    });
  });

  describe('buildAgentToolUseMap', () => {
    const requests = [
      { mainAgent: true, response: { body: { content: [
        { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { name: 'readme-sync', description: 'Sync READMEs', subagent_type: 'general-purpose', prompt: 'Task: sync all the README files in the repo please' } },
      ] } } },
      { mainAgent: true, response: { body: { content: [
        { type: 'tool_use', id: 'toolu_2', name: 'Task', input: { description: 'Explore codebase', subagent_type: 'Explore', prompt: 'Find all the boundary checks' } },
      ] } } },
      { mainAgent: false, response: { body: { content: [
        { type: 'tool_use', id: 'toolu_x', name: 'Agent', input: { name: 'ignored', prompt: 'sub rows must be skipped' } },
      ] } } },
    ];

    it('indexes Agent/Task tool_use by toolUseId and prompt prefix', () => {
      const { byToolUseId, byPromptPrefix } = buildAgentToolUseMap(requests);
      assert.equal(byToolUseId.get('toolu_1').name, 'readme-sync');
      assert.equal(byToolUseId.get('toolu_2').subagentType, 'Explore');
      const prefix = 'Task: sync all the README files in the repo please'.trimStart().slice(0, PROMPT_PREFIX_LEN);
      assert.equal(byPromptPrefix.get(prefix).name, 'readme-sync');
    });

    it('skips non-main-agent rows and non-Agent/Task blocks', () => {
      const { byToolUseId } = buildAgentToolUseMap(requests);
      assert.ok(!byToolUseId.has('toolu_x'));
    });

    it('tolerates malformed input', () => {
      const { byToolUseId, byPromptPrefix } = buildAgentToolUseMap(null);
      assert.equal(byToolUseId.size, 0);
      assert.equal(byPromptPrefix.size, 0);
      assert.doesNotThrow(() => buildAgentToolUseMap([{ response: null }, {}, { mainAgent: true, response: { body: { content: 'x' } } }]));
    });
  });

  describe('deriveActiveAgents', () => {
    const base = { taskId: 't1', status: 'in_progress' };
    it('keeps only agent taskTypes with non-terminal status', () => {
      const agents = deriveActiveAgents([
        { ...base, taskType: 'local_agent', toolUseId: 'a' },
        { ...base, taskId: 't2', taskType: 'in_process_teammate' },
        { ...base, taskId: 't3', taskType: 'local_bash' },          // excluded: not an agent
        { ...base, taskId: 't4', taskType: 'local_workflow' },      // excluded: workflow agent
        { ...base, taskId: 't5', taskType: 'local_agent', status: 'completed' }, // terminal
        { ...base, taskId: 't6', taskType: 'local_agent', status: 'failed' },    // terminal
        { ...base, taskId: 't7', taskType: undefined },             // excluded: no taskType
      ]);
      assert.deepEqual(agents.map(a => a.taskId), ['t1', 't2']);
      assert.equal(agents[0].kind, 'subagent');
      assert.equal(agents[1].kind, 'teammate');
    });

    it('treats pending as active', () => {
      const agents = deriveActiveAgents([{ taskId: 't1', taskType: 'local_agent', status: 'pending' }]);
      assert.equal(agents.length, 1);
    });

    it('carries toolUseId and promptSnippet for the join', () => {
      const agents = deriveActiveAgents([
        { taskId: 't1', taskType: 'local_agent', status: 'in_progress', toolUseId: 'toolu_9', promptSnippet: 'Find stuff', subject: 'desc' },
      ]);
      assert.equal(agents[0].toolUseId, 'toolu_9');
      assert.equal(agents[0].prompt, 'Find stuff');
      assert.equal(agents[0].description, 'desc');
    });

    it('returns empty for empty / malformed input', () => {
      assert.deepEqual(deriveActiveAgents([]), []);
      assert.deepEqual(deriveActiveAgents(null), []);
      assert.deepEqual(deriveActiveAgents([null, {}, { taskType: 'local_agent' }]), []); // missing taskId
    });
  });

  describe('resolveAgentIdentity', () => {
    const toolUseMap = buildAgentToolUseMap([
      { mainAgent: true, response: { body: { content: [
        { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { name: 'code reviewer', description: 'Review the diff', subagent_type: 'general-purpose', prompt: 'Please review the current diff carefully' } },
        { type: 'tool_use', id: 'toolu_2', name: 'Agent', input: { description: 'Explore', subagent_type: 'Explore', prompt: 'Find all boundary checks' } },
      ] } } },
    ]);

    it('resolves a teammate name by exact toolUseId join (spaces preserved)', () => {
      const agent = { taskId: 't1', toolUseId: 'toolu_1', kind: 'teammate', taskType: 'in_process_teammate', prompt: '', description: '', status: 'in_progress' };
      const id = resolveAgentIdentity(agent, toolUseMap);
      assert.equal(id.name, 'code reviewer');
      assert.equal(id.key, 'tm:code reviewer');
      assert.equal(id.avatarType, 'teammate');
      assert.ok(id.matchable);
    });

    it('resolves a subagent avatarType from subagent_type', () => {
      const agent = { taskId: 't2', toolUseId: 'toolu_2', kind: 'subagent', taskType: 'local_agent', prompt: 'Find all boundary checks', description: 'Explore', status: 'in_progress' };
      const id = resolveAgentIdentity(agent, toolUseMap);
      assert.equal(id.avatarType, 'sub-search');
      assert.equal(id.key, 'sa:t2');
      assert.ok(id.matchable);
    });

    it('falls back to prompt-prefix join when toolUseId misses', () => {
      const agent = { taskId: 't3', toolUseId: 'nope', kind: 'teammate', taskType: 'in_process_teammate', prompt: 'Please review the current diff carefully', description: '', status: 'in_progress' };
      const id = resolveAgentIdentity(agent, toolUseMap);
      assert.equal(id.name, 'code reviewer');
    });

    it('falls back to description prefix when both joins miss', () => {
      const agent = { taskId: 't4', toolUseId: null, kind: 'teammate', taskType: 'in_process_teammate', prompt: '', description: 'alice: do the thing', status: 'in_progress' };
      const id = resolveAgentIdentity(agent, toolUseMap);
      assert.equal(id.name, 'alice');
    });

    it('does NOT treat a bare imperative description as a teammate name', () => {
      // Real Agent descriptions are short blurbs with no "name:" prefix.
      const agent = { taskId: 't5', toolUseId: null, kind: 'teammate', taskType: 'in_process_teammate', prompt: '', description: 'Sync 17 translated READMEs', status: 'in_progress' };
      const id = resolveAgentIdentity(agent, toolUseMap);
      assert.equal(id.name, null);
      assert.equal(id.matchable, false);
      assert.equal(id.key, 'tm-task:t5');
    });

    it('unresolvable teammate is not matchable (never a dead click)', () => {
      const agent = { taskId: 't6', toolUseId: null, kind: 'teammate', taskType: 'in_process_teammate', prompt: '', description: '', status: 'in_progress' };
      const id = resolveAgentIdentity(agent, { byToolUseId: new Map(), byPromptPrefix: new Map() });
      assert.equal(id.matchable, false);
    });
  });

  describe('labelMatchesAgent', () => {
    it('matches teammate labels by clean name (strips prefix + (model) suffix, case-insensitive)', () => {
      const id = { kind: 'teammate', name: 'reviewer' };
      assert.ok(labelMatchesAgent('Teammate: reviewer(claude-opus-4-8)', id));
      assert.ok(labelMatchesAgent('Teammate: reviewer', id));
      assert.ok(labelMatchesAgent('Teammate: Reviewer(claude-opus-4-8)', id));
      assert.ok(!labelMatchesAgent('Teammate: other(model)', id));
      assert.ok(!labelMatchesAgent('SubAgent:Search', id));
    });

    it('matches subagent labels at type level (fallback)', () => {
      const id = { kind: 'subagent', avatarType: 'sub-search' };
      assert.ok(labelMatchesAgent('SubAgent:Search', id));
      assert.ok(labelMatchesAgent('SubAgent:Explore', id));
      assert.ok(!labelMatchesAgent('SubAgent:Plan', id));
      assert.ok(!labelMatchesAgent('Teammate: x', id));
    });

    it('returns false on malformed input', () => {
      assert.ok(!labelMatchesAgent(null, { kind: 'teammate', name: 'x' }));
      assert.ok(!labelMatchesAgent('Teammate: x', null));
    });
  });

  describe('promptMatchesAgent', () => {
    const id = { kind: 'subagent', promptPrefix: 'Find all boundary checks'.slice(0, PROMPT_PREFIX_LEN) };
    it('matches a row whose first user message starts with the prompt prefix', () => {
      assert.equal(promptMatchesAgent('Find all boundary checks in the codebase', id), true);
      assert.equal(promptMatchesAgent('Something else entirely', id), false);
    });
    it('returns null when not decidable (no prefix / not subagent / no row text)', () => {
      assert.equal(promptMatchesAgent('text', { kind: 'subagent', promptPrefix: '' }), null);
      assert.equal(promptMatchesAgent('text', { kind: 'teammate', promptPrefix: 'x' }), null);
      assert.equal(promptMatchesAgent('', id), null);
      assert.equal(promptMatchesAgent(null, id), null);
    });
  });

  describe('firstUserText', () => {
    it('extracts text from a string-content user message', () => {
      assert.equal(firstUserText({ body: { messages: [{ role: 'user', content: 'hello world' }] } }), 'hello world');
    });
    it('extracts the first text block from an array-content user message', () => {
      const req = { body: { messages: [{ role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'x', content: 'irrelevant' },
        { type: 'text', text: 'the actual prompt' },
      ] }] } };
      assert.equal(firstUserText(req), 'the actual prompt');
    });
    it('returns empty for an array with no text block (tool_result only)', () => {
      const req = { body: { messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'r' }] }] } };
      assert.equal(firstUserText(req), '');
    });
    it('returns empty when there is no user message', () => {
      assert.equal(firstUserText({ body: { messages: [{ role: 'assistant', content: 'a' }] } }), '');
    });
    it('returns empty for malformed input (null / no body / non-array messages)', () => {
      assert.equal(firstUserText(null), '');
      assert.equal(firstUserText({}), '');
      assert.equal(firstUserText({ body: { messages: 'nope' } }), '');
      assert.equal(firstUserText({ body: { messages: [null, { role: 'user' }] } }), '');
    });
    it('skips non-user leading messages to find the first user one', () => {
      const req = { body: { messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'real first user' },
      ] } };
      assert.equal(firstUserText(req), 'real first user');
    });
  });

  describe('parseNamePrefix (via resolveAgentIdentity teammate fallback)', () => {
    const emptyMap = { byToolUseId: new Map(), byPromptPrefix: new Map() };
    const tmTask = (description) => ({ taskId: 't', toolUseId: null, kind: 'teammate', taskType: 'in_process_teammate', prompt: '', description, status: 'in_progress' });
    it('accepts a CJK full-width colon separator', () => {
      const id = resolveAgentIdentity(tmTask('翻译官：把 README 翻成中文'), emptyMap);
      assert.equal(id.name, '翻译官');
    });
    it('rejects an over-long name prefix (>32 chars) as not-a-name', () => {
      const longName = 'a'.repeat(40);
      const id = resolveAgentIdentity(tmTask(`${longName}: do something`), emptyMap);
      assert.equal(id.name, null);
      assert.equal(id.matchable, false);
    });
    it('does not mistake a "Docs: ..." style description for a teammate name', () => {
      // The guard rejects nothing by charset, but the >32 length and the fact
      // that real teammate names resolve via the toolUseId join mean a bare
      // imperative blurb stays unmatchable rather than a dead clickable chip.
      const id = resolveAgentIdentity(tmTask('Update all seventeen translated README files now'), emptyMap);
      assert.equal(id.name, null);
    });
  });

  describe('transcriptRowMatchesAgent', () => {
    // The MainAgent spawned one Explore subagent (toolu_E) whose Agent input
    // prompt is the raw task; the transcript row's first user message is the
    // WRAPPED variant (deferred-tools prefix), so the two 60-char prefixes
    // diverge — the exact scenario that made the HEAD filter a silent no-op.
    const SPAWN_PROMPT = 'Find all the boundary checks in the repo and report them';
    const requests = [
      { mainAgent: true, response: { body: { content: [
        { type: 'tool_use', id: 'toolu_E', name: 'Agent', input: { description: 'Explore codebase', subagent_type: 'Explore', prompt: SPAWN_PROMPT } },
        { type: 'tool_use', id: 'toolu_G', name: 'Agent', input: { description: 'Other', subagent_type: 'general-purpose', prompt: 'A completely different task about something else entirely' } },
      ] } } },
    ];
    const toolUseMap = buildAgentToolUseMap(requests);
    const focusExplore = resolveAgentIdentity(
      { taskId: 'taskE', toolUseId: 'toolu_E', kind: 'subagent', prompt: SPAWN_PROMPT, description: 'Explore codebase' },
      toolUseMap
    );

    it('binds a row to its spawn by toolUseId even when the prompt prefixes diverge', () => {
      // The row's first user text does NOT start with the spawn prompt (wrapped),
      // but its prefix still maps to the same spawn block via the join.
      const wrappedRowText = SPAWN_PROMPT; // prefix matches → maps to toolu_E
      const hit = transcriptRowMatchesAgent(
        { label: 'SubAgent:Explore', isTeammate: false, rowPromptText: wrappedRowText },
        focusExplore, toolUseMap
      );
      assert.equal(hit, true);
    });

    it('rejects a row bound to a DIFFERENT spawn toolUseId (exact mismatch)', () => {
      const otherRowText = 'A completely different task about something else entirely'; // → toolu_G
      const hit = transcriptRowMatchesAgent(
        { label: 'SubAgent:Explore', isTeammate: false, rowPromptText: otherRowText },
        focusExplore, toolUseMap
      );
      assert.equal(hit, false);
    });

    it('falls back to a same-type label match when there is no exact anchor and prefixes are undecidable', () => {
      const noRowText = transcriptRowMatchesAgent(
        { label: 'SubAgent:Explore', isTeammate: false, rowPromptText: null },
        focusExplore, toolUseMap
      );
      assert.equal(noRowText, true);
      const wrongType = transcriptRowMatchesAgent(
        { label: 'SubAgent:Plan', isTeammate: false, rowPromptText: null },
        focusExplore, toolUseMap
      );
      assert.equal(wrongType, false);
    });

    it('teammate rows match by clean name, ignoring the prompt heuristic', () => {
      const tmFocus = { kind: 'teammate', name: 'reviewer', avatarType: 'teammate', promptPrefix: '' };
      assert.equal(transcriptRowMatchesAgent(
        { label: 'Teammate: reviewer(claude-opus-4-8)', isTeammate: true, rowPromptText: 'whatever' },
        tmFocus, toolUseMap
      ), true);
      assert.equal(transcriptRowMatchesAgent(
        { label: 'Teammate: writer', isTeammate: true, rowPromptText: 'whatever' },
        tmFocus, toolUseMap
      ), false);
    });

    it('returns false for malformed input', () => {
      assert.equal(transcriptRowMatchesAgent(null, focusExplore, toolUseMap), false);
      assert.equal(transcriptRowMatchesAgent({ label: 'SubAgent:Explore', isTeammate: false }, null, toolUseMap), false);
    });
  });

  describe('isFocusActive', () => {
    const emptyMap = { byToolUseId: new Map(), byPromptPrefix: new Map() };
    const tmTask = (taskId, desc) => ({ taskId, toolUseId: null, kind: 'teammate', taskType: 'in_process_teammate', prompt: '', description: desc, status: 'in_progress' });

    it('subagent: active only while its own taskId is active', () => {
      const focus = { kind: 'subagent', taskId: 't1', name: null };
      const active = [
        { taskId: 't1', kind: 'subagent', taskType: 'local_agent', status: 'in_progress' },
      ];
      assert.equal(isFocusActive(focus, active, emptyMap), true);
      assert.equal(isFocusActive(focus, [], emptyMap), false);
    });

    it('teammate: stays active while ANY task resolves to the same name (multi-task dedupe)', () => {
      // Teammate "alice" has tasks T1+T2; the avatar carries T1. T1 ends, T2 runs.
      // The focus must NOT be cleared while the same-named teammate is still active.
      const requests = [
        { mainAgent: true, response: { body: { content: [
          { type: 'tool_use', id: 'toolu_alice', name: 'Agent', input: { name: 'alice', prompt: 'do work' } },
        ] } } },
      ];
      const toolUseMap = buildAgentToolUseMap(requests);
      const active = [
        { taskId: 'T2', toolUseId: 'toolu_alice', kind: 'teammate', taskType: 'in_process_teammate', prompt: 'do work', description: '', status: 'in_progress' },
      ];
      const focus = { kind: 'teammate', name: 'alice', taskId: 'T1' }; // stale first taskId
      assert.equal(isFocusActive(focus, active, toolUseMap), true);
      // Once no alice task remains, the focus clears.
      assert.equal(isFocusActive(focus, [], toolUseMap), false);
    });

    it('teammate: a different-named active teammate does not keep the focus alive', () => {
      const requests = [
        { mainAgent: true, response: { body: { content: [
          { type: 'tool_use', id: 'toolu_bob', name: 'Agent', input: { name: 'bob', prompt: 'do work' } },
        ] } } },
      ];
      const toolUseMap = buildAgentToolUseMap(requests);
      const active = [
        { taskId: 'T9', toolUseId: 'toolu_bob', kind: 'teammate', taskType: 'in_process_teammate', prompt: 'do work', description: '', status: 'in_progress' },
      ];
      assert.equal(isFocusActive({ kind: 'teammate', name: 'alice', taskId: 'T1' }, active, toolUseMap), false);
    });

    it('returns false for null focus', () => {
      assert.equal(isFocusActive(null, [], emptyMap), false);
    });
  });
});

