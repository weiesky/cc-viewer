// Unit tests for scripts/verify-boundaries.mjs — the import-boundary gate.
// Fixture trees replicate the packages/app path layout under a tmp rootDir so
// classify() applies unchanged; analyze() runs against the fixture, not the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, extractEdges, resolveSpecifier, scc, analyze } from '../scripts/verify-boundaries.mjs';

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'ccv-boundary-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const MINIMAL = {
  'packages/app/package.json': JSON.stringify({ name: 'cc-viewer', dependencies: {} }),
  'packages/app/findcc.js': '',
  'packages/app/cli.js': '',
  'packages/app/server/_paths.js': '',
  'packages/app/server/i18n.js': '',
  'packages/app/server/server.js': '',
};

test('classify assigns the documented classes', () => {
  assert.equal(classify('packages/app/findcc.js').cls, 'L0');
  assert.equal(classify('packages/core/src/contentFilter.js').cls, 'CORE');
  assert.equal(classify('packages/app/server/lib/log-file-utils.js').cls, 'L0-leaf');
  assert.equal(classify('packages/app/server/lib/v2/adapter.js').cls, 'L1-sub');
  assert.equal(classify('packages/app/server/lib/v2/adapter.js').sub, 'v2');
  // adapters/ shares the im group (one future extraction unit)
  assert.equal(classify('packages/app/server/lib/adapters/feishu-adapter.js').sub, 'im');
  assert.equal(classify('packages/app/server/lib/log-stream.js').cls, 'L1-lib');
  assert.equal(classify('packages/app/server/interceptor.js').cls, 'L2');
  assert.equal(classify('packages/app/server/routes/logs.js').cls, 'L3');
  assert.equal(classify('packages/app/server/server.js').cls, 'L4');
  assert.equal(classify('apps/web/src/App.jsx').cls, 'WEB');
});

test('extractEdges captures static, re-export, side-effect and dynamic imports', () => {
  const edges = extractEdges(`
    import a from './a.js';
    import './side.js';
    export { b } from './b.js';
    export * from './c.js';
    const p = import('./dyn.js');
    chained.then(() => import('./deep.js')).catch(() => {});
    // import './commented.js';
    const s = "import './in-string.js'";
  `, 'f.js');
  const specs = edges.map(e => `${e.dynamic ? 'dyn:' : ''}${e.spec}`).sort();
  assert.deepEqual(specs, ['./a.js', './b.js', './c.js', './side.js', 'dyn:./deep.js', 'dyn:./dyn.js']);
});

test('extractEdges flags computed relative dynamic imports', () => {
  const edges = extractEdges('const p = import(`./plugins/${name}.js`);', 'f.js');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].computed, true);
});

test('scc finds cycles and ignores DAGs', () => {
  const nodes = ['a', 'b', 'c', 'd'];
  const cyclic = scc(nodes, [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd']]);
  const big = cyclic.filter(g => g.length > 1).map(g => [...g].sort());
  assert.deepEqual(big, [['a', 'b', 'c']]);
  const acyclic = scc(nodes, [['a', 'b'], ['b', 'c'], ['c', 'd']]);
  assert.deepEqual(acyclic.filter(g => g.length > 1), []);
});

test('analyze: clean tree passes', () => {
  const root = makeTree({
    ...MINIMAL,
    'packages/app/server/lib/leaf.js': "import { x } from './other-leaf.js';",
    'packages/app/server/lib/other-leaf.js': '',
  });
  try {
    const { violations, stale } = analyze({ roots: ['packages/app'], rootDir: root, leaves: new Set() });
    assert.deepEqual(violations, []);
    assert.deepEqual(stale, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: static cycle → R1; lib → server.js → R2; web → L2 → R6; unresolved → R7', () => {
  const root = makeTree({
    ...MINIMAL,
    'packages/app/server/lib/a.js': "import { b } from './b.js';",
    'packages/app/server/lib/b.js': "import { a } from './a.js';",
    'packages/app/server/lib/c.js': "import { s } from '../server.js';",
    'packages/app/server/lib/d.js': "import { gone } from './does-not-exist.js';",
    'packages/app/server/interceptor.js': '',
    'apps/web/package.json': JSON.stringify({ name: '@ccv/web', dependencies: {} }),
    'apps/web/src/x.js': "import { i } from '../../../packages/app/server/interceptor.js';",
  });
  try {
    const { violations } = analyze({ roots: ['packages/app', 'apps/web/src'], rootDir: root, leaves: new Set() });
    const rules = violations.map(v => v.rule).sort();
    assert.deepEqual(rules, ['R1', 'R2', 'R6', 'R7']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: allowlist suppresses its exact edge and goes stale when the violation vanishes', () => {
  const files = {
    ...MINIMAL,
    'packages/app/server/lib/im/keep.js': "import { x } from '../v2/x.js';",
    'packages/app/server/lib/v2/x.js': '',
  };
  const entry = {
    from: 'packages/app/server/lib/im/keep.js',
    to: 'packages/app/server/lib/v2/x.js',
    rule: 'R3', reason: 'fixture', since: '2026-01-01',
  };
  const root = makeTree(files);
  try {
    const suppressed = analyze({ roots: ['packages/app'], rootDir: root, allowlist: [entry], leaves: new Set() });
    assert.deepEqual(suppressed.violations, []);
    assert.deepEqual(suppressed.stale, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // same allowlist against a tree without the violating edge → STALE
  const root2 = makeTree({ ...MINIMAL });
  try {
    const { stale } = analyze({ roots: ['packages/app'], rootDir: root2, allowlist: [entry], leaves: new Set() });
    assert.equal(stale.length, 1);
    assert.equal(stale[0].rule, 'R3');
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
});

test('analyze: dynamic-closed cycle needs R1-dyn; allowlisted edge breaks the union cycle', () => {
  const files = {
    ...MINIMAL,
    // lib →(static) L2 and L2 →(dynamic) lib: a dynamic-closed cycle
    'packages/app/server/lib/policy.js': "import { w } from '../workspace-registry.js';",
    'packages/app/server/workspace-registry.js': "export function bust() { return import('./lib/policy.js'); }",
  };
  const root = makeTree(files);
  try {
    const plain = analyze({ roots: ['packages/app'], rootDir: root, leaves: new Set() });
    const rules = plain.violations.map(v => `${v.rule}${v.dynamic ? ':dyn' : ''}`).sort();
    assert.deepEqual(rules, ['R1:dyn', 'R5']); // R5 for the static lib→L2 edge, R1 dynamic for the cycle
    const entry = {
      from: 'packages/app/server/workspace-registry.js',
      to: 'packages/app/server/lib/policy.js',
      rule: 'R1-dyn', reason: 'fixture', since: '2026-01-01',
    };
    const exempted = analyze({ roots: ['packages/app'], rootDir: root, allowlist: [entry], leaves: new Set() });
    assert.deepEqual(exempted.violations.map(v => v.rule), ['R5']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: L0-leaf closure escape is reported (R0)', () => {
  const root = makeTree({
    ...MINIMAL,
    // log-file-utils.js is on the curated leaf list; make it reach a lib-free file
    'packages/app/server/lib/log-file-utils.js': "import { x } from './random-lib.js';",
    'packages/app/server/lib/random-lib.js': '',
  });
  try {
    const leaves = new Set(['packages/app/server/lib/log-file-utils.js']);
    const { violations } = analyze({ roots: ['packages/app'], rootDir: root, leaves });
    assert.ok(violations.some(v => v.rule === 'R0' && v.detail.includes('closure escape')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: R4 fires for L0 → L1, but not for L0 → CORE (@ccv/core)', () => {
  const root = makeTree({
    ...MINIMAL,
    'packages/app/package.json': JSON.stringify({ name: 'cc-viewer', dependencies: { '@ccv/core': '0.0.0' } }),
    // findcc.js is L0: → L1-lib must be flagged, → @ccv/core must not
    'packages/app/findcc.js': "import { x } from './server/lib/free.js'; import { reportSwallowed } from '@ccv/core/error-report';",
    'packages/app/server/lib/free.js': '',
    'packages/core/package.json': JSON.stringify({ name: '@ccv/core' }),
    'packages/core/src/error-report.js': '',
  });
  try {
    const { violations } = analyze({ roots: ['packages/app', 'packages/core/src'], rootDir: root, leaves: new Set() });
    assert.deepEqual(violations.map(v => v.rule), ['R4']);
    assert.ok(violations[0].from.endsWith('findcc.js'));
    assert.ok(violations[0].to.endsWith('free.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: R8 fires for CORE → outside CORE; CORE → CORE is clean', () => {
  const root = makeTree({
    ...MINIMAL,
    'packages/core/package.json': JSON.stringify({ name: '@ccv/core' }),
    'packages/core/src/a.js': "import { b } from './b.js';",
    'packages/core/src/b.js': '',
    'packages/core/src/escape.js': "import { x } from '../../app/server/lib/free.js';",
    'packages/app/server/lib/free.js': '',
  });
  try {
    const { violations } = analyze({ roots: ['packages/app', 'packages/core/src'], rootDir: root, leaves: new Set() });
    assert.deepEqual(violations.map(v => v.rule), ['R8']);
    assert.ok(violations[0].from.endsWith('escape.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: @ccv/core subpaths must map to a real core file (R7 fail-closed)', () => {
  const root = makeTree({
    ...MINIMAL,
    'packages/app/package.json': JSON.stringify({ name: 'cc-viewer', dependencies: { '@ccv/core': '0.0.0' } }),
    'packages/app/server/lib/x.js': "import { a } from '@ccv/core/nope';",
    'packages/app/server/lib/y.js': "import { b } from '@ccv/core';",
    'packages/core/package.json': JSON.stringify({ name: '@ccv/core' }),
    'packages/core/src/real.js': '',
  });
  try {
    const { violations } = analyze({ roots: ['packages/app', 'packages/core/src'], rootDir: root, leaves: new Set() });
    assert.deepEqual(violations.map(v => v.rule), ['R7', 'R7']);
    assert.ok(violations.some(v => v.detail.includes('does not map')));
    assert.ok(violations.some(v => v.detail.includes('no root export')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: R0 fires for a curated leaf missing on disk', () => {
  const root = makeTree({ ...MINIMAL });
  try {
    const leaves = new Set(['packages/app/server/lib/log-file-utils.js']);
    const { violations } = analyze({ roots: ['packages/app'], rootDir: root, leaves });
    assert.deepEqual(violations.map(v => v.rule), ['R0']);
    assert.ok(violations[0].detail.includes('does not exist'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: R7 fires for a bare specifier that is neither builtin nor declared', () => {
  const root = makeTree({
    ...MINIMAL,
    'packages/app/server/lib/x.js': "import foo from 'left-pad'; import { builtinModules } from 'node:module';",
  });
  try {
    const { violations } = analyze({ roots: ['packages/app'], rootDir: root, leaves: new Set() });
    assert.deepEqual(violations.map(v => v.rule), ['R7']);
    assert.ok(violations[0].to === 'left-pad');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: stale entry when the edge exists but no longer violates', () => {
  const root = makeTree({
    ...MINIMAL,
    // edge lib → lib (not L2): an R5 entry against it is stale ("no longer violates")
    'packages/app/server/lib/a.js': "import { b } from './b.js';",
    'packages/app/server/lib/b.js': '',
  });
  const entry = {
    from: 'packages/app/server/lib/a.js',
    to: 'packages/app/server/lib/b.js',
    rule: 'R5', reason: 'fixture', since: '2026-01-01',
  };
  try {
    const { stale, violations } = analyze({ roots: ['packages/app'], rootDir: root, allowlist: [entry], leaves: new Set() });
    assert.deepEqual(violations, []);
    assert.equal(stale.length, 1);
    assert.ok(stale[0].detail.includes('no longer violates'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: R1-dyn entry goes stale once the cycle is broken even though the edge survives', () => {
  const files = {
    ...MINIMAL,
    // dynamic edge exists but the reverse static edge is gone → no cycle → stale
    'packages/app/server/lib/policy.js': '',
    'packages/app/server/workspace-registry.js': "export function bust() { return import('./lib/policy.js'); }",
  };
  const entry = {
    from: 'packages/app/server/workspace-registry.js',
    to: 'packages/app/server/lib/policy.js',
    rule: 'R1-dyn', reason: 'fixture', since: '2026-01-01',
  };
  const root = makeTree(files);
  try {
    const { stale, violations } = analyze({ roots: ['packages/app'], rootDir: root, allowlist: [entry], leaves: new Set() });
    assert.deepEqual(violations, []);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].rule, 'R1-dyn');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: hard rules ignore the allowlist (R2 not exemptable)', () => {  const root = makeTree({
    ...MINIMAL,
    'packages/app/server/lib/c.js': "import { s } from '../server.js';",
  });
  const entry = {
    from: 'packages/app/server/lib/c.js',
    to: 'packages/app/server/server.js',
    rule: 'R2', reason: 'attempt to exempt a hard rule', since: '2026-01-01',
  };
  try {
    const { violations } = analyze({ roots: ['packages/app'], rootDir: root, allowlist: [entry], leaves: new Set() });
    assert.deepEqual(violations.map(v => v.rule), ['R2']); // still reported
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: relative imports resolving into excluded app dirs are forbidden (no silent drop)', () => {
  const root = makeTree({
    ...MINIMAL,
    'packages/app/dist/evil.js': '',
    'packages/app/server/lib/loose.js': "import { x } from '../../dist/evil.js';",
    'apps/web/package.json': JSON.stringify({ name: '@ccv/web', dependencies: {} }),
    'apps/web/src/w.js': "import { y } from '../../../packages/app/dist/evil.js';",
  });
  try {
    const { violations } = analyze({ roots: ['packages/app', 'apps/web/src'], rootDir: root, leaves: new Set() });
    // dist/ exists on disk but is EXCLUDE_DIRS-filtered from the walk — both edges
    // must be flagged instead of silently dropped (web importer → R6, lib → R7)
    assert.deepEqual(violations.map(v => v.rule).sort(), ['R6', 'R7']);
    assert.ok(violations.every(v => v.detail.includes('excluded')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('analyze: R6 rejects ALL web → packages/app imports; web → @ccv/core is the allowed path', () => {
  const root = makeTree({
    ...MINIMAL,
    'apps/web/package.json': JSON.stringify({ name: '@ccv/web', dependencies: { '@ccv/core': 'workspace:*' } }),
    'apps/web/src/a.js': "import { LOG_DIR } from '../../../packages/app/findcc.js';",
    'apps/web/src/b.js': "import { isMainAgent } from '@ccv/core/contentFilter';",
    'apps/web/src/c.js': "import { x } from '../../../packages/app/server/lib/ansi-safe-slice.js';",
    'packages/app/server/lib/ansi-safe-slice.js': '',
    'packages/core/package.json': JSON.stringify({ name: '@ccv/core' }),
    'packages/core/src/contentFilter.js': '',
  });
  try {
    const { violations } = analyze({ roots: ['packages/app', 'apps/web/src', 'packages/core/src'], rootDir: root, leaves: new Set() });
    // findcc (L0) and even a curated leaf (L0-leaf) are both forbidden post-inversion
    assert.deepEqual(violations.map(v => v.rule), ['R6', 'R6']);
    assert.ok(violations.every(v => v.from !== 'apps/web/src/b.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSpecifier probes extensions and strips bundler query suffixes', () => {
  const root = makeTree({
    'pkg/a.js': '',
    'pkg/img/logo.svg': 'x',
  });
  try {
    assert.equal(resolveSpecifier('pkg/b.js', './a', root), 'pkg/a.js');
    assert.equal(resolveSpecifier('pkg/b.js', './a.js?raw', root), 'pkg/a.js');
    assert.equal(resolveSpecifier('pkg/b.js', './img/logo.svg?raw', root), 'pkg/img/logo.svg');
    assert.equal(resolveSpecifier('pkg/b.js', './missing', root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
