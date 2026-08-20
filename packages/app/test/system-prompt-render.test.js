// Spawn-time `${...}` rendering of injected system-prompt files (server/lib/system-prompt-render.js).
// The editor stores placeholders literal; renderSystemPromptFileArgs must substitute known
// variables at launch, keep unknown ones literal (shell-syntax quotes survive), skip files
// without placeholders entirely (no variable collection), and never break the spawn on failure.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmp = mkdtempSync(join(tmpdir(), 'ccv-sp-render-'));
process.env.CCV_LOG_DIR = tmp;

let renderSystemPromptFileArgs;
let renderedPromptDir;
let createSystemPromptVariables;

before(async () => {
  ({ renderSystemPromptFileArgs, renderedPromptDir } = await import('../server/lib/system-prompt-render.js'));
  ({ createSystemPromptVariables } = await import('../server/lib/create_system_prompt.js'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
  try { rmSync(renderedPromptDir(), { recursive: true, force: true }); } catch { /* not created in some runs */ }
});

// Deterministic variables seam: no git subprocesses, no env reads.
const fakeFactory = (overrides = {}) => ({
  os: { platform: 'testos' },
  model: { name: overrides.model?.name || 'fallback-model' },
});

describe('renderSystemPromptFileArgs', () => {
  it('renders known variables into a temp copy and swaps the arg path', () => {
    const src = join(tmp, 'WITH_VARS_SYSTEM.md');
    writeFileSync(src, 'You are ${model.name} on ${os.platform}.');
    const r = renderSystemPromptFileArgs(
      { args: ['--system-prompt-file', src], loaded: ['x'], model: 'M' },
      { modelId: 'deepseek-v4-pro[1m]', variablesFactory: fakeFactory },
    );
    assert.equal(r.args[0], '--system-prompt-file');
    assert.notEqual(r.args[1], src, 'path must point at the rendered temp copy');
    assert.equal(r.args[1], join(renderedPromptDir(), 'WITH_VARS_SYSTEM.md'));
    assert.equal(readFileSync(r.args[1], 'utf-8'), 'You are deepseek-v4-pro on testos.');
    assert.equal(r.model, 'M', 'non-args fields pass through');
    assert.equal(readFileSync(src, 'utf-8'), 'You are ${model.name} on ${os.platform}.', 'source file untouched');
  });

  it('strips the [1m] context-window suffix from modelId before it becomes ${model.name}', () => {
    let seenOverrides = null;
    const spy = (overrides) => { seenOverrides = overrides; return fakeFactory(overrides); };
    const src = join(tmp, 'STRIP_SYSTEM.md');
    writeFileSync(src, '${model.name}');
    renderSystemPromptFileArgs(
      { args: ['--system-prompt-file', src], loaded: [], model: null },
      { modelId: 'claude-opus-4-8[1m]', variablesFactory: spy },
    );
    assert.deepEqual(seenOverrides, { model: { name: 'claude-opus-4-8' } });
  });

  it('keeps unknown placeholders literal (shell syntax in prompt text survives)', () => {
    const src = join(tmp, 'SHELL_SYSTEM.md');
    writeFileSync(src, 'run with ${HOME}/bin and ${os.platform}');
    const r = renderSystemPromptFileArgs(
      { args: ['--append-system-prompt-file', src], loaded: [], model: null },
      { variablesFactory: fakeFactory },
    );
    assert.equal(readFileSync(r.args[1], 'utf-8'), 'run with ${HOME}/bin and testos');
  });

  it('passes files without placeholders through untouched and never collects variables', () => {
    let called = 0;
    const spy = () => { called++; return fakeFactory(); };
    const src = join(tmp, 'PLAIN_SYSTEM.md');
    writeFileSync(src, 'no placeholders here');
    const r = renderSystemPromptFileArgs(
      { args: ['--system-prompt-file', src], loaded: [], model: null },
      { variablesFactory: spy },
    );
    assert.equal(r.args[1], src, 'raw path kept');
    assert.equal(called, 0, 'variable collection must be lazy');
  });

  it('keeps the raw path when the source file only has unknown placeholders (no useless temp copy)', () => {
    const src = join(tmp, 'ONLY_UNKNOWN_SYSTEM.md');
    writeFileSync(src, 'just ${NOT_A_VAR}');
    const r = renderSystemPromptFileArgs(
      { args: ['--system-prompt-file', src], loaded: [], model: null },
      { variablesFactory: fakeFactory },
    );
    assert.equal(r.args[1], src);
  });

  it('falls back to the raw path when the file is unreadable (spawn must not break)', () => {
    const missing = join(tmp, 'MISSING_SYSTEM.md');
    const origWarn = console.warn; let logged = '';
    console.warn = (...a) => { logged += a.join(' '); };
    let r;
    try {
      r = renderSystemPromptFileArgs(
        { args: ['--system-prompt-file', missing], loaded: [], model: null },
        { variablesFactory: fakeFactory },
      );
    } finally { console.warn = origWarn; }
    assert.equal(r.args[1], missing);
    assert.match(logged, /render failed/);
  });

  it('renders both injected files of one spawn, collecting variables once', () => {
    let called = 0;
    const spy = () => { called++; return fakeFactory(); };
    const a = join(tmp, 'A_SYSTEM.md');
    const b = join(tmp, 'B_APPEND_SYSTEM.md');
    writeFileSync(a, 'a=${os.platform}');
    writeFileSync(b, 'b=${os.platform}');
    const r = renderSystemPromptFileArgs(
      { args: ['--system-prompt-file', a, '--append-system-prompt-file', b], loaded: [], model: null },
      { variablesFactory: spy },
    );
    assert.equal(called, 1);
    assert.equal(readFileSync(r.args[1], 'utf-8'), 'a=testos');
    assert.equal(readFileSync(r.args[3], 'utf-8'), 'b=testos');
  });

  it('empty args pass through unchanged', () => {
    const input = { args: [], loaded: [], model: null };
    assert.equal(renderSystemPromptFileArgs(input, {}), input);
  });

  it('null / non-object input → safe default (entry guard, PR#128)', () => {
    assert.deepEqual(renderSystemPromptFileArgs(null), { args: [], loaded: [], model: null });
    assert.deepEqual(renderSystemPromptFileArgs(undefined), { args: [], loaded: [], model: null });
    assert.deepEqual(renderSystemPromptFileArgs(42), { args: [], loaded: [], model: null });
  });
});

describe('createSystemPromptVariables opts.cwd', () => {
  it('resolves cwd-dependent variables against the passed directory', () => {
    // A fresh temp dir is not a git repository — cwd flows through, git derives from it.
    const vars = createSystemPromptVariables({}, { cwd: tmp });
    assert.equal(vars.environment.cwd, tmp);
    assert.equal(vars.git.isRepository, 'false');
    assert.ok(existsSync(tmp));
  });
});
