/**
 * Unit tests for src/utils/resumeSessions.js — the /resume hover-list view-model
 * mapping and the parallel-project chip derivation (pure, no React).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapResumeRow, formatRelativeTime, deriveActiveProcessChips, deriveProjectTabs, resolveBoundInstance, attachMainPty, closeProjectPty, resumeSession } from '../src/utils/resumeSessions.js';

describe('mapResumeRow', () => {
  const base = {
    source: 'ccv',
    project: 'cc-viewer',
    file: 'v2:cc-viewer/20261002_abcdef-1234',
    sessionUuid: 'a9883ab8-0ab7-459a-bcfd-4c8950a14384',
    startTs: '2026-10-02T05:00:00.000Z',
    turns: 3,
    preview: ['first user prompt'],
    running: false,
    pinnedId: null,
  };

  it('prefers aiTitle over preview for the summary', () => {
    const row = mapResumeRow({ ...base, aiTitle: 'Clean up sync docs' }, null);
    assert.equal(row.summary, 'Clean up sync docs');
  });

  it('falls back to the first user prompt when no aiTitle', () => {
    const row = mapResumeRow(base, null);
    assert.equal(row.summary, 'first user prompt');
  });

  it('empty summary when neither aiTitle nor preview', () => {
    const row = mapResumeRow({ ...base, preview: [] }, null);
    assert.equal(row.summary, '');
  });

  it('selected only when sessionUuid matches the current live session uuid (one row max)', () => {
    const cur = base.sessionUuid;
    // The matching row is "current" — and ONLY it, regardless of any shared
    // project-level pinnedId.
    assert.equal(mapResumeRow({ ...base, pinnedId: 'shared-proj-pin' }, cur).selected, true);
    assert.equal(mapResumeRow({ ...base, sessionUuid: '00000000-0000-4000-8000-000000000000', pinnedId: 'shared-proj-pin' }, cur).selected, false);
    assert.equal(mapResumeRow({ ...base, sessionUuid: null }, cur).selected, false);
    // No current uuid → nothing selected.
    assert.equal(mapResumeRow(base, null).selected, false);
    // Case-insensitive uuid match.
    assert.equal(mapResumeRow({ ...base, sessionUuid: cur.toUpperCase() }, cur).selected, true);
  });

  it('attachedUuid marks the attached session "current" alongside the server currentSessionUuid', () => {
    const live = base.sessionUuid; // the primary live session (server currentSessionUuid)
    const attached = 'aaaaaaaa-0000-4000-8000-000000000000'; // the session the view is attached to
    // While attached, the attached session is selected even though the server still
    // reports `live` as currentSessionUuid — the attached session is what the user
    // is looking at.
    assert.equal(mapResumeRow({ ...base, sessionUuid: attached }, live, { attachedUuid: attached }).selected, true);
    // The primary live session stays marked too (union semantics: it is still the
    // process's live session; the attached row is the one being VIEWED).
    assert.equal(mapResumeRow({ ...base, sessionUuid: live }, live, { attachedUuid: attached }).selected, true);
    // Case-insensitive attached match.
    assert.equal(mapResumeRow({ ...base, sessionUuid: attached.toUpperCase() }, null, { attachedUuid: attached }).selected, true);
    // No attach → falls back to the server currentSessionUuid only.
    assert.equal(mapResumeRow({ ...base, sessionUuid: attached }, live).selected, false);
  });

  it('isCurrentLive marks the live row (click must be a no-op) and is false otherwise', () => {
    const cur = base.sessionUuid;
    assert.equal(mapResumeRow(base, cur).isCurrentLive, true);
    assert.equal(mapResumeRow({ ...base, sessionUuid: '00000000-0000-4000-8000-000000000000' }, cur).isCurrentLive, false);
    assert.equal(mapResumeRow(base, null).isCurrentLive, false);
  });

  it('statusKind two states: current vs inactive', () => {
    const cur = base.sessionUuid;
    assert.equal(mapResumeRow(base, cur).statusKind, 'current');
    assert.equal(mapResumeRow(base, null).statusKind, 'inactive');
    assert.equal(mapResumeRow({ ...base, running: true }, null).statusKind, 'inactive');
  });

  it('tooltipKey: current wins; inactive running → statusRunning', () => {
    const cur = base.sessionUuid;
    assert.equal(mapResumeRow({ ...base, running: true }, cur).tooltipKey, 'ui.resume.statusCurrent');
    assert.equal(mapResumeRow({ ...base, running: true }, null).tooltipKey, 'ui.resume.statusRunning');
    assert.equal(mapResumeRow(base, null).tooltipKey, 'ui.resume.statusInactive');
  });

  it('missing project renders an em-dash placeholder', () => {
    assert.equal(mapResumeRow({ ...base, project: null }, null).project, '—');
  });

  it('key prefers uuid; falls back to file; source prefix separates ccv/cc', () => {
    assert.equal(mapResumeRow(base, null).key, `ccv:${base.sessionUuid}`);
    assert.equal(mapResumeRow({ ...base, source: 'cc' }, null).key, `cc:${base.sessionUuid}`);
  });

  it('tolerates a null/undefined row without throwing', () => {
    const row = mapResumeRow(null, null);
    assert.equal(row.project, '—');
    assert.equal(row.selected, false);
  });

  it('isStreaming forces running=true ONLY for the current row', () => {
    const cur = base.sessionUuid;
    const other = '00000000-0000-4000-8000-000000000000';
    // Current row mid-stream (mtime aged out → raw running=false) still reads running.
    assert.equal(mapResumeRow({ ...base, running: false }, cur, { isStreaming: true }).running, true);
    // Not streaming → falls back to the raw mtime flag.
    assert.equal(mapResumeRow({ ...base, running: false }, cur, { isStreaming: false }).running, false);
    // A background (non-current) row is NOT affected by the current stream flag.
    assert.equal(mapResumeRow({ ...base, sessionUuid: other, running: false }, cur, { isStreaming: true }).running, false);
    // The raw mtime flag still wins on its own (no isStreaming needed).
    assert.equal(mapResumeRow({ ...base, sessionUuid: other, running: true }, cur, { isStreaming: false }).running, true);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-02T12:00:00.000Z');

  it('minutes / hours / days buckets', () => {
    assert.equal(formatRelativeTime('2026-10-02T11:59:30.000Z', now), '<1m');
    assert.equal(formatRelativeTime('2026-10-02T11:45:00.000Z', now), '15m');
    assert.equal(formatRelativeTime('2026-10-02T07:00:00.000Z', now), '5h');
    assert.equal(formatRelativeTime('2026-09-29T12:00:00.000Z', now), '3d');
  });

  it('unparseable / future timestamps → empty string', () => {
    assert.equal(formatRelativeTime('not-a-date', now), '');
    assert.equal(formatRelativeTime('2026-10-03T00:00:00.000Z', now), '');
    assert.equal(formatRelativeTime('', now), '');
  });
});

describe('deriveActiveProcessChips', () => {
  const main = (project, cwd, active = false, pid = 1, instanceKey = null) => ({ kind: 'main', project, cwd, pid, active, instanceKey });

  it('one chip per live main PTY, bare project name', () => {
    const chips = deriveActiveProcessChips([
      main('alpha', '/p/alpha', true),
      main('beta', '/p/beta'),
    ], 'other-project');
    assert.deepEqual(chips.map(c => c.label), ['alpha', 'beta']);
    assert.deepEqual(chips.map(c => c.project), ['alpha', 'beta']);
    assert.deepEqual(chips.map(c => c.cwd), ['/p/alpha', '/p/beta']);
  });

  it('excludes the CURRENT project chip (shown in the header label)', () => {
    const chips = deriveActiveProcessChips([
      main('cc-viewer', '/p/cc-viewer', true),
      main('finqa-remote-cc', '/p/finqa', false),
    ], 'cc-viewer');
    assert.deepEqual(chips.map(c => c.project), ['finqa-remote-cc']);
  });

  it('projects ordered alphabetically (current excluded)', () => {
    const chips = deriveActiveProcessChips([
      main('zeta', '/p/zeta'),
      main('beta', '/p/beta'),
      main('alpha', '/p/alpha'),
    ], 'beta');
    // 'beta' (the current project) is dropped; remaining alphabetical.
    assert.deepEqual(chips.map(c => c.project), ['alpha', 'zeta']);
  });

  it('dedupes repeated rows for the same project', () => {
    const chips = deriveActiveProcessChips([
      main('p', '/p/p'),
      main('p', '/p/p'),
    ], null);
    assert.equal(chips.length, 1);
    assert.equal(chips[0].project, 'p');
  });

  it('rows with no project name are dropped (no clickable em-dash chip); empty input → []', () => {
    const chips = deriveActiveProcessChips([{ kind: 'main', project: null, cwd: '/x', pid: 1 }], null);
    assert.deepEqual(chips, [], 'a nameless row would resolve to a meaningless scope — dropped');
    assert.deepEqual(deriveActiveProcessChips([], null), []);
    assert.deepEqual(deriveActiveProcessChips(null, null), []);
  });

  it('two same-basename projects (different dirs) become two suffixed chips, cwd-ascending', () => {
    const chips = deriveActiveProcessChips([
      main('finqa-remote-cc', '/x/finqa-remote-cc', true, 40, 'inst-a'),
      main('finqa-remote-cc', '/y/finqa-remote-cc', false, 5, 'inst-b'),
    ], null);
    assert.equal(chips.length, 2);
    // cwd-lexicographic: /x < /y, independent of pid (a respawn changes pid, never cwd).
    assert.equal(chips.find(c => c.cwd === '/x/finqa-remote-cc').label, 'finqa-remote-cc [1]', 'cwd /x gets [1]');
    assert.equal(chips.find(c => c.cwd === '/y/finqa-remote-cc').label, 'finqa-remote-cc [2]', 'cwd /y gets [2]');
    assert.deepEqual(chips.map(c => c.project).sort(), ['finqa-remote-cc', 'finqa-remote-cc'], 'identity project untouched');
  });
});

describe('attachMainPty', () => {
  it('POSTs the attach endpoint with the project and resolves true on success', async () => {
    const calls = [];
    const ok = await attachMainPty('projA', {
      fetchImpl: (path, init) => { calls.push({ path, init }); return Promise.resolve({ ok: true }); },
    });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/live-processes/attach');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(JSON.parse(calls[0].init.body).project, 'projA');
  });

  it('rejects empty project without fetching', async () => {
    let fetched = 0;
    const ok = await attachMainPty('', { fetchImpl: () => { fetched++; return Promise.resolve({ ok: true }); } });
    assert.equal(ok, false);
    assert.equal(fetched, 0);
  });

  it('swallows fetch failures into reportSwallowed and resolves false', async () => {
    const reports = [];
    const ok = await attachMainPty('projA', {
      fetchImpl: () => Promise.reject(new Error('net down')),
      reportImpl: (tag, err) => reports.push({ tag, msg: String(err && err.message) }),
    });
    assert.equal(ok, false);
    assert.deepEqual(reports, [{ tag: 'pty.attach', msg: 'net down' }]);
  });

  it('treats a non-ok HTTP response as a degraded false (no throw)', async () => {
    const ok = await attachMainPty('projA', {
      fetchImpl: () => Promise.resolve({ ok: false, status: 404 }),
      reportImpl: () => { throw new Error('must not report HTTP-level degrade'); },
    });
    assert.equal(ok, false);
  });
});

describe('deriveProjectTabs', () => {
  const main = (project, cwd, active = false, pid = 1, instanceKey = null) => ({ kind: 'main', project, cwd, pid, active, instanceKey });

  it('one tab per live project INCLUDING the current one', () => {
    const tabs = deriveProjectTabs([
      main('cc-viewer', '/p/cc-viewer', true),
      main('finqa', '/p/finqa'),
    ]);
    assert.deepEqual(tabs.map(t => t.project), ['cc-viewer', 'finqa']);
    assert.deepEqual(tabs.map(t => t.label), ['cc-viewer', 'finqa']);
    assert.deepEqual(tabs.map(t => t.key), ['main:/p/cc-viewer', 'main:/p/finqa']);
  });

  it('projects ordered alphabetically; rows without an instanceKey dedupe by basename', () => {
    // Backward-compatible rows (no instanceKey): two same-basename rows with no instance key
    // and the same cwd are the same logical project → collapse (first row wins). This is the
    // pre-multi-instance shape; instance-bearing rows are keyed per-instance below.
    const tabs = deriveProjectTabs([
      main('zeta', '/p/zeta'),
      main('beta', '/p/beta'),
      main('zeta', '/p/zeta', true, 9),
      main('alpha', '/p/alpha'),
    ]);
    assert.deepEqual(tabs.map(t => t.project), ['alpha', 'beta', 'zeta']);
    assert.equal(tabs.length, 3, 'duplicate same-cwd project rows collapse');
    assert.equal(tabs[2].key, 'main:/p/zeta', 'first row wins on dedupe');
  });

  it('two concurrent SAME-cwd instances (distinct instanceKeys) become two tabs with unique keys', async () => {
    // Multi-instance (2026-10-06): the whole point — a shared basename must not collapse two
    // live processes into one tab.
    const tabs = deriveProjectTabs([
      main('solo', '/p/solo', true, 1, 'ccv-aaa'),
      main('solo', '/p/solo', false, 2, 'ccv-bbb'),
    ]);
    assert.equal(tabs.length, 2, 'two same-cwd instances each get a tab');
    assert.deepEqual(tabs.map(t => t.key).sort(), ['main:ccv-aaa', 'main:ccv-bbb'].sort(), 'keyed by instanceKey');
    assert.deepEqual(tabs.map(t => t.instanceKey).sort(), ['ccv-aaa', 'ccv-bbb']);
  });

  it('rows with no project name are dropped; empty input → []', () => {
    assert.deepEqual(deriveProjectTabs([{ kind: 'main', project: null, cwd: '/x', pid: 1 }]), []);
    assert.deepEqual(deriveProjectTabs([]), []);
    assert.deepEqual(deriveProjectTabs(null), []);
  });

  it('the key falls back to the project name when cwd and instanceKey are absent', () => {
    const tabs = deriveProjectTabs([{ kind: 'main', project: 'q' }]);
    assert.deepEqual(tabs, [{ key: 'main:q', project: 'q', label: 'q', suffix: null, cwd: null, pid: undefined, instanceKey: null, active: false }]);
  });

  it('two cross-dir same-basename projects get [1]/[2] ordered by cwd asc (respawn-stable)', () => {
    const tabs = deriveProjectTabs([
      main('finqa-remote-cc', '/b/finqa-remote-cc', true, 20, 'inst-a'),
      main('finqa-remote-cc', '/a/finqa-remote-cc', false, 10, 'inst-b'),
    ]);
    assert.equal(tabs.length, 2);
    // cwd-lexicographic: /a < /b regardless of pid — a self-heal respawn (new pid) never flips the tag.
    assert.equal(tabs.find(t => t.cwd === '/a/finqa-remote-cc').label, 'finqa-remote-cc [1]', 'cwd /a gets [1]');
    assert.equal(tabs.find(t => t.cwd === '/b/finqa-remote-cc').label, 'finqa-remote-cc [2]', 'cwd /b gets [2]');
  });

  it('the ordinal is cwd-driven, not pid-driven — a higher-pid row at an earlier cwd still gets [1]', () => {
    // Pins the respawn-flip fix: even though /a has the LARGER pid (restarted later), its cwd
    // sorts first, so it keeps [1]. A pid-ordered scheme would have swapped them.
    const tabs = deriveProjectTabs([
      main('web', '/b/web', false, 100, 'inst-b'),
      main('web', '/a/web', true, 300, 'inst-a'),  // respawned → newer/larger pid
    ]);
    assert.equal(tabs.find(t => t.instanceKey === 'inst-a').label, 'web [1]', '/a keeps [1] despite larger pid');
    assert.equal(tabs.find(t => t.instanceKey === 'inst-b').label, 'web [2]', '/b keeps [2]');
  });

  it('three same-name rows fed out of cwd order still resolve to cwd-ascending labels', () => {
    const tabs = deriveProjectTabs([
      main('dup', '/c3', true, 30, 'inst-x'),
      main('dup', '/c1', false, 20, 'inst-y'),
      main('dup', '/c2', false, 10, 'inst-z'),
    ]);
    assert.equal(tabs.find(t => t.instanceKey === 'inst-y').label, 'dup [1]', '/c1');
    assert.equal(tabs.find(t => t.instanceKey === 'inst-z').label, 'dup [2]', '/c2');
    assert.equal(tabs.find(t => t.instanceKey === 'inst-x').label, 'dup [3]', '/c3');
  });

  it('same-name rows with identical cwd tie-break by instanceKey (deterministic)', () => {
    // Two instances of the SAME dir: cwd ties, so instanceKey (localeCompare) decides.
    const tabs = deriveProjectTabs([
      main('solo', '/p/solo', true, 1, 'ccv-zzz'),
      main('solo', '/p/solo', false, 2, 'ccv-aaa'),
    ]);
    assert.equal(tabs.find(t => t.instanceKey === 'ccv-aaa').label, 'solo [1]', 'ccv-aaa < ccv-zzz');
    assert.equal(tabs.find(t => t.instanceKey === 'ccv-zzz').label, 'solo [2]');
  });

  it('carries the server `active` flag + instanceKey so the header singles out ONE same-name bound tab', () => {
    // Two same-basename projects; the bound (attached) one is active. The header reads the
    // active row's instanceKey to break the tie when no parallel view is attached.
    const tabs = deriveProjectTabs([
      main('finqa-remote-cc', '/a/finqa-remote-cc', true, 20, 'inst-a'),   // bound+active
      main('finqa-remote-cc', '/b/finqa-remote-cc', false, 10, 'inst-b'),  // parallel, not active
    ]);
    assert.equal(tabs.find(t => t.cwd === '/a/finqa-remote-cc').active, true, 'bound row stays active');
    assert.equal(tabs.find(t => t.cwd === '/b/finqa-remote-cc').active, false, 'parallel row not active');
  });

  it('unique-name projects get NO suffix (label === project, suffix null)', () => {
    const tabs = deriveProjectTabs([
      main('alpha', '/p/alpha'),
      main('beta', '/p/beta'),
    ]);
    assert.deepEqual(tabs.map(t => t.label), ['alpha', 'beta']);
    assert.deepEqual(tabs.map(t => t.suffix), [null, null], 'no suffix when unsuffixed');
  });

  it('two same-cwd instances (same project, distinct instanceKey) each get a suffix', () => {
    const tabs = deriveProjectTabs([
      main('solo', '/p/solo', true, 1, 'ccv-aaa'),
      main('solo', '/p/solo', false, 2, 'ccv-bbb'),
    ]);
    assert.equal(tabs.find(t => t.instanceKey === 'ccv-aaa').label, 'solo [1]');
    assert.equal(tabs.find(t => t.instanceKey === 'ccv-bbb').label, 'solo [2]');
  });

  it('suffix is split out as a separate field for non-shrinking render', () => {
    const tabs = deriveProjectTabs([
      main('finqa-remote-cc', '/a/finqa-remote-cc', true, 20, 'inst-a'),
      main('finqa-remote-cc', '/b/finqa-remote-cc', false, 10, 'inst-b'),
    ]);
    assert.equal(tabs.find(t => t.cwd === '/a/finqa-remote-cc').suffix, ' [1]');
    assert.equal(tabs.find(t => t.cwd === '/b/finqa-remote-cc').suffix, ' [2]');
  });

  it('the [n] suffix is decorational — .key and .project identity are unchanged', () => {
    const tabs = deriveProjectTabs([
      main('finqa-remote-cc', '/a/finqa-remote-cc', true, 20, 'inst-a'),
      main('finqa-remote-cc', '/b/finqa-remote-cc', false, 10, 'inst-b'),
    ]);
    assert.deepEqual(tabs.map(t => t.key).sort(), ['main:inst-a', 'main:inst-b'], 'react key unaffected');
    assert.deepEqual(tabs.map(t => t.project).sort(), ['finqa-remote-cc', 'finqa-remote-cc'], 'identity project unaffected');
  });
});

describe('resolveBoundInstance (pure-client bound viewing, 2026-10-07)', () => {
  const tabs = [
    { project: 'ccbot', instanceKey: 'inst-ccbot' },
    { project: 'finqa-remote-cc', instanceKey: 'inst-a' },
    { project: 'finqa-remote-cc', instanceKey: 'inst-b' },
  ];

  it('unique bound name → null (name-match suffices, no tiebreak needed)', () => {
    // bound=ccbot matches exactly ONE tab; the finqa same-name pair is irrelevant.
    assert.equal(resolveBoundInstance(tabs, 'ccbot', 'inst-ccbot'), null);
  });

  it('bound name duplicated by a parallel tab + key resolves → returns the key', () => {
    // bound=/a/finqa (inst-a) shares its basename with parallel /b/finqa (inst-b).
    const dup = [
      { project: 'finqa-remote-cc', instanceKey: 'inst-a' },
      { project: 'finqa-remote-cc', instanceKey: 'inst-b' },
    ];
    assert.equal(resolveBoundInstance(dup, 'finqa-remote-cc', 'inst-a'), 'inst-a');
  });

  it('stale key that matches no bound tab → null (degrade to name-match, never blank bound)', () => {
    const dup = [
      { project: 'finqa-remote-cc', instanceKey: 'inst-a' },
      { project: 'finqa-remote-cc', instanceKey: 'inst-b' },
    ];
    assert.equal(resolveBoundInstance(dup, 'finqa-remote-cc', 'inst-stale'), null);
  });

  it('missing currentInstanceKey / currentProject → null (startup fallback)', () => {
    const dup = [
      { project: 'finqa-remote-cc', instanceKey: 'inst-a' },
      { project: 'finqa-remote-cc', instanceKey: 'inst-b' },
    ];
    assert.equal(resolveBoundInstance(dup, 'finqa-remote-cc', null), null);
    assert.equal(resolveBoundInstance(dup, 'finqa-remote-cc', ''), null);
    assert.equal(resolveBoundInstance(dup, '', 'inst-a'), null);
    assert.equal(resolveBoundInstance(null, 'finqa-remote-cc', 'inst-a'), null);
  });
});

describe('closeProjectPty', () => {
  it('POSTs the close endpoint with the project and resolves ok on success', async () => {
    const calls = [];
    const out = await closeProjectPty('projA', {
      fetchImpl: (path, init) => {
        calls.push({ path, init });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, killedActive: true }) });
      },
    });
    assert.deepEqual(out, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/live-processes/close');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(JSON.parse(calls[0].init.body).project, 'projA');
  });

  it('maps a 403 to reason:forbidden (permission message, not generic failure)', async () => {
    const out = await closeProjectPty('projA', {
      fetchImpl: () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ ok: false, reason: 'forbidden' }) }),
    });
    assert.deepEqual(out, { ok: false, reason: 'forbidden' });
  });

  it('degrades a non-ok HTTP response with a JSON error body to the server reason', async () => {
    const out = await closeProjectPty('ghost', {
      fetchImpl: () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ ok: false, reason: 'not-found' }) }),
    });
    assert.deepEqual(out, { ok: false, reason: 'not-found' });
  });

  it('rejects empty project without fetching', async () => {
    let fetched = 0;
    const out = await closeProjectPty('', { fetchImpl: () => { fetched++; return Promise.resolve({ ok: true }); } });
    assert.equal(out.ok, false);
    assert.equal(fetched, 0);
  });

  it('swallows fetch failures into reportSwallowed and resolves ok:false', async () => {
    const reports = [];
    const out = await closeProjectPty('projA', {
      fetchImpl: () => Promise.reject(new Error('net down')),
      reportImpl: (tag, err) => reports.push({ tag, msg: String(err && err.message) }),
    });
    assert.deepEqual(out, { ok: false, reason: 'network' });
    assert.deepEqual(reports, [{ tag: 'pty.close', msg: 'net down' }]);
  });

  it('degrades a non-JSON error page (older server without the route) to http-<status>', async () => {
    const out = await closeProjectPty('projA', {
      fetchImpl: () => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not json')) }),
    });
    assert.deepEqual(out, { ok: false, reason: 'http-404' });
  });
});

describe('resumeSession (true /resume, 2026-10-06)', () => {
  const UUID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';

  it('POSTs /api/resume-session with sessionUuid + project + instanceKey, resolves ok on success', async () => {
    const calls = [];
    const out = await resumeSession(UUID, {
      project: 'projA', instanceKey: 'ccv-abc123',
      fetchImpl: (path, init) => { calls.push({ path, init }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); },
    });
    assert.deepEqual(out, { ok: true });
    assert.equal(calls[0].path, '/api/resume-session');
    assert.equal(calls[0].init.method, 'POST');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.sessionUuid, UUID);
    assert.equal(body.project, 'projA');
    assert.equal(body.instanceKey, 'ccv-abc123');
  });

  it('omits project/instanceKey from the body when absent', async () => {
    const calls = [];
    await resumeSession(UUID, { fetchImpl: (path, init) => { calls.push({ init }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); } });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.sessionUuid, UUID);
    assert.ok(!('project' in body) && !('instanceKey' in body));
  });

  it('rejects an empty sessionUuid without fetching', async () => {
    let fetched = 0;
    const out = await resumeSession('', { fetchImpl: () => { fetched++; return Promise.resolve({ ok: true }); } });
    assert.deepEqual(out, { ok: false, reason: 'missing-session' });
    assert.equal(fetched, 0);
  });

  it('maps 403 to forbidden', async () => {
    const out = await resumeSession(UUID, { fetchImpl: () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ ok: false, reason: 'forbidden' }) }) });
    assert.deepEqual(out, { ok: false, reason: 'forbidden' });
  });

  it('maps 409 busy to reason:busy', async () => {
    const out = await resumeSession(UUID, { fetchImpl: () => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ ok: false, reason: 'busy' }) }) });
    assert.deepEqual(out, { ok: false, reason: 'busy' });
  });

  it('swallows network failures into reportSwallowed and resolves ok:false network', async () => {
    const reports = [];
    const out = await resumeSession(UUID, {
      fetchImpl: () => Promise.reject(new Error('net down')),
      reportImpl: (tag, err) => reports.push({ tag, msg: String(err && err.message) }),
    });
    assert.deepEqual(out, { ok: false, reason: 'network' });
    assert.deepEqual(reports, [{ tag: 'pty.resume', msg: 'net down' }]);
  });
});
