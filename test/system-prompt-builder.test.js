// Unit tests for the system-prompt builder (server/lib/create_system_prompt.js).
// All assertions use injected/fixed variables so the suite is deterministic and does
// not depend on the real git state or a real ~/.claude memory directory (which exists
// on dev machines but not in CI).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import {
  DYNAMIC_BOUNDARY,
  SYSTEM_PROMPT_SECTIONS,
  createSystemPrompt,
  createSystemPromptVariables,
  assembleSystemPrompt,
  listTemplateVariables,
  loadModelTemplate,
  loadPreset,
  loadVariablesDoc,
  VARIABLES_DOC_LOCALES,
  listPresets,
  renderPreset,
  renderPresetTemplate,
} from '../server/lib/create_system_prompt.js';

// A complete, fixed SystemPromptVariables object. Groups can be overridden per test.
function fixtureVariables(overrides = {}) {
  const base = {
    environment: { cwd: '/x', originalCwd: '/x', home: '/home/u', user: 'u', workspaceRoots: '/x', path: '/bin', lang: 'en_US.UTF-8' },
    git: { isRepository: 'true', root: '/x', branch: 'main', mainBranch: 'main', userName: 'U', status: '', recentCommits: 'abc123 init' },
    os: { platform: 'linux', type: 'Linux', arch: 'x64', shell: '/bin/bash', version: 'v', release: 'r', hostname: 'h', availableParallelism: 8, totalMemory: 100, freeMemory: 50, uptime: 10 },
    runtime: { nodeVersion: 'v20', execPath: '/usr/bin/node', pid: 1, ppid: 0 },
    time: { current: 'now', iso: '2026-01-01T00:00:00.000Z', date: '2026-01-01', timezone: 'UTC' },
    permissions: { mode: 'default', approvalsReviewer: '' },
    sandbox: { mode: 'workspace-write', networkAccess: 'enabled', writableRoots: '/x' },
    terminal: { term: 'xterm', colorTerm: 'truecolor', columns: 80, rows: 24 },
    filesystem: { tmpdir: '/tmp', pathSeparator: '/', pathDelimiter: ':' },
    model: { name: 'test-model', knowledgeCutoff: '2025' },
    memory: { dir: '/home/u/.claude/projects/-x/memory/', index: '# Memory index\n- [a](a.md) — hook', enabled: 'true' },
    scratchpad: { dir: '/tmp/scratch' },
  };
  const merged = {};
  for (const key of Object.keys(base)) merged[key] = { ...base[key], ...(overrides[key] || {}) };
  return merged;
}

// Fence-aware level-1 header scan of the dynamic portion, mirroring the builder's parser.
function parseDynamicHeaders(template) {
  const dynamic = template.split(DYNAMIC_BOUNDARY)[1];
  const headers = [];
  let inFence = false;
  for (const line of dynamic.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (!inFence && line.startsWith('# ')) headers.push(line.trim());
  }
  return headers;
}

describe('createSystemPrompt: variable rendering + missing modes', () => {
  it('renders dotted-path variables', () => {
    const out = createSystemPrompt('model=${model.name} date=${time.date}', {
      variables: fixtureVariables(),
    });
    assert.equal(out, 'model=test-model date=2026-01-01');
  });

  it('missingVariableMode "empty" blanks unknown variables', () => {
    const out = createSystemPrompt('a=${nope.here}b', { variables: fixtureVariables(), missingVariableMode: 'empty' });
    assert.equal(out, 'a=b');
  });

  it('missingVariableMode "keep" preserves the raw placeholder', () => {
    const out = createSystemPrompt('a=${nope.here}', { variables: fixtureVariables(), missingVariableMode: 'keep' });
    assert.equal(out, 'a=${nope.here}');
  });

  it('missingVariableMode "throw" throws on an unknown variable', () => {
    assert.throws(
      () => createSystemPrompt('${nope.here}', { variables: fixtureVariables(), missingVariableMode: 'throw' }),
      /Missing system prompt template variable: nope\.here/,
    );
  });
});

describe('assembleSystemPrompt: section selection + conditionals', () => {
  const template = loadModelTemplate();

  it('renders a full prompt with no unresolved ${...} placeholders', () => {
    const out = assembleSystemPrompt(template, { variables: fixtureVariables(), missingVariableMode: 'empty' });
    assert.doesNotMatch(out, /\$\{/);
  });

  it('includes # Memory and appends the MEMORY.md index when memory is enabled', () => {
    const vars = fixtureVariables();
    const out = assembleSystemPrompt(template, { variables: vars, missingVariableMode: 'empty' });
    assert.match(out, /^# Memory$/m);
    assert.ok(out.includes('- [a](a.md) — hook'));
    // The index is a trailing block; it appears after the # Memory prose section.
    assert.ok(out.lastIndexOf('# Memory index') > out.indexOf('# Memory'));
  });

  it('omits # Memory and the index when memory is disabled', () => {
    const vars = fixtureVariables({ memory: { enabled: 'false', index: '', dir: '' } });
    const out = assembleSystemPrompt(template, { variables: vars, missingVariableMode: 'empty' });
    assert.doesNotMatch(out, /^# Memory$/m);
    assert.ok(!out.includes('- [a](a.md) — hook'));
  });

  it('includes # Scratchpad Directory only when scratchpad.dir is set', () => {
    const withScratch = assembleSystemPrompt(template, { variables: fixtureVariables(), missingVariableMode: 'empty' });
    assert.match(withScratch, /^# Scratchpad Directory$/m);
    const withoutScratch = assembleSystemPrompt(template, {
      variables: fixtureVariables({ scratchpad: { dir: '' } }),
      missingVariableMode: 'empty',
    });
    assert.doesNotMatch(withoutScratch, /^# Scratchpad Directory$/m);
  });

  it('renders only the requested sections when a subset is passed', () => {
    const out = assembleSystemPrompt(template, {
      variables: fixtureVariables(),
      missingVariableMode: 'empty',
      sections: ['environment', 'git'],
    });
    assert.match(out, /^# Environment$/m);
    assert.match(out, /^# Git$/m);
    assert.doesNotMatch(out, /^# Operating system$/m);
    assert.doesNotMatch(out, /^# Memory$/m);
  });

  it('throws on an unknown section key', () => {
    assert.throws(
      () => assembleSystemPrompt(template, { variables: fixtureVariables(), sections: ['bogus'] }),
      /Unknown system prompt section key: bogus/,
    );
  });

  it('throws a clear error when the boundary marker is missing', () => {
    assert.throws(
      () => assembleSystemPrompt('no boundary here', { variables: fixtureVariables() }),
      /must contain exactly one/,
    );
  });
});

describe('SYSTEM_PROMPT_SECTIONS <-> systemPromptModel.md parity', () => {
  it('every non-preamble section key maps to a header present in the template, and vice versa', () => {
    const template = loadModelTemplate();
    const templateHeaders = parseDynamicHeaders(template).sort();
    const sectionHeaders = SYSTEM_PROMPT_SECTIONS.filter(s => s.header !== null).map(s => s.header).sort();
    assert.deepEqual(sectionHeaders, templateHeaders);
  });
});

describe('presets', () => {
  const manifest = listPresets();
  const global = manifest.categories.Global;

  it('the manifest lists the five expected [Global] presets', () => {
    const ids = global.map(p => p.id).sort();
    assert.deepEqual(ids, ['GLM-5.2', 'Qwen-3.7-Max', 'deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k2.7-code']);
  });

  for (const preset of [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }, { id: 'GLM-5.2' }, { id: 'Qwen-3.7-Max' }, { id: 'kimi-k2.7-code' }]) {
    it(`renders preset ${preset.id} with the shared dynamic sections and no stray placeholders`, () => {
      const out = renderPreset(preset.id, { variables: fixtureVariables(), missingVariableMode: 'empty' });
      assert.doesNotMatch(out, /\$\{/);
      assert.ok(out.includes('You are'), 'preamble rendered');
      assert.match(out, /^# Environment$/m, 'shared dynamic sections appended');
      assert.doesNotMatch(out, /<!--/, 'editor comment stripped');
    });
  }

  it('renderPresetTemplate returns raw literal text: preamble + OS env + memory, no boundary, no git', () => {
    const text = renderPresetTemplate('deepseek-v4-pro');
    assert.ok(!text.includes(DYNAMIC_BOUNDARY), 'boundary marker stripped');
    assert.ok(text.includes('${os.platform}'), 'placeholders left literal (OS details)');
    assert.ok(text.includes('You are'), 'preamble present');
    assert.match(text, /^# Environment$/m, 'environment (OS) section present');
    assert.match(text, /^# Memory$/m, 'memory section present');
    assert.ok(text.includes('${memory.dir}'), 'memory section copied verbatim');
    assert.doesNotMatch(text, /^# Git$/m, 'git section omitted');
    assert.doesNotMatch(text, /\n\n\n/, 'no stray blank lines at the seam');
    assert.doesNotMatch(text, /<!--/, 'editor comment stripped');
  });

  it('rejects preset ids that attempt path traversal', () => {
    assert.throws(() => loadPreset('../systemPromptModel'), /Invalid preset id/);
    assert.throws(() => loadPreset('a/b'), /Invalid preset id/);
    assert.throws(() => loadPreset('..'), /Invalid preset id/);
  });
});

describe('loadVariablesDoc: locale selection + fallback', () => {
  it('whitelists lang and falls back to the English base', () => {
    const base = loadVariablesDoc();
    assert.ok(base.includes('${memory.dir}'));
    assert.equal(loadVariablesDoc('en'), base, 'en is the base file itself');
    assert.equal(loadVariablesDoc('xx'), base, 'unknown locale falls back');
    assert.equal(loadVariablesDoc('../presets/index'), base, 'traversal-shaped lang ignored');
  });

  it('every whitelisted locale resolves to a translated doc with literal placeholders', () => {
    const base = loadVariablesDoc();
    for (const lang of VARIABLES_DOC_LOCALES) {
      const doc = loadVariablesDoc(lang);
      assert.ok(doc.length > 0, `${lang}: non-empty`);
      assert.ok(doc.includes('${memory.dir}'), `${lang}: placeholders literal`);
      assert.notEqual(doc, base, `${lang}: translated, not the base`);
    }
  });
});

describe('createSystemPromptVariables: memory-dir slug + overrides', () => {
  it('computes the memory dir from HOME + slugified cwd when no override is set', () => {
    const prev = {
      HOME: process.env.HOME,
      CC_MEMORY_DIR: process.env.CC_MEMORY_DIR,
      CLAUDE_MEMORY_DIR: process.env.CLAUDE_MEMORY_DIR,
    };
    try {
      delete process.env.CC_MEMORY_DIR;
      delete process.env.CLAUDE_MEMORY_DIR;
      process.env.HOME = '/tmp/ccv-fakehome-does-not-exist';
      const vars = createSystemPromptVariables();
      const slug = process.cwd().replace(/[^A-Za-z0-9]/g, '-');
      const expected = join('/tmp/ccv-fakehome-does-not-exist', '.claude', 'projects', slug, 'memory') + sep;
      assert.equal(vars.memory.dir, expected);
      assert.equal(vars.memory.enabled, 'false'); // directory does not exist
      assert.equal(vars.memory.index, '');
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('applies group overrides via merge', () => {
    const vars = createSystemPromptVariables({ model: { name: 'override-model' }, scratchpad: { dir: '/sp' } });
    assert.equal(vars.model.name, 'override-model');
    assert.equal(vars.scratchpad.dir, '/sp');
  });
});

describe('listTemplateVariables', () => {
  it('returns the sorted unique variable names used in the model template', () => {
    const names = listTemplateVariables(loadModelTemplate());
    assert.ok(names.includes('memory.dir'));
    assert.ok(names.includes('scratchpad.dir'));
    assert.ok(names.includes('environment.cwd'));
    // sorted + unique
    assert.deepEqual(names, [...new Set(names)].sort());
  });
});
