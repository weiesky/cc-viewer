/**
 * launch-config.test.js
 *
 * Covers server/lib/launch-config.js (the launch-config pipeline extracted from
 * pty-manager and shared by the SDK path):
 *   - withDefaultThinkingDisplay, three branches
 *   - parseResumeArgs (-c/-r variants / --fork-session)
 *   - launchArgsToExtraArgs (flag/value pairs, = forms, boolean flags, short-flag skip)
 *   - splitSdkLaunchArgs (--model/-c/-r/--fork-session hoisted + rest passthrough)
 *   - resolveLaunchSystemPrompt: fresh sentinel injection / user synonym-flag suppression /
 *     env global opt-out / resume pin (snapshot → materialize bytes; no snapshot → F2
 *     does not inject) / suppressInjection / resume turn not persisted as pending
 *     (persistPending=false semantics driven by the caller)
 *
 * Method: mkdtemp a private CCV_LOG_DIR/CLAUDE_CONFIG_DIR → dynamic import (env-sensitive
 * LOG_DIR); modelReader is injected explicitly and never relies on process env (same
 * source as the NODE_TEST_CONTEXT barrier in pty-manager tests).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot;
let lc;
let snapshots;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-launch-config-'));
  process.env.CCV_LOG_DIR = join(tmpRoot, 'logs');
  process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, 'claude-config');
  mkdirSync(process.env.CCV_LOG_DIR, { recursive: true });
  lc = await import('../server/lib/launch-config.js');
  snapshots = await import('../server/lib/system-prompt-snapshots.js');
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function mkProj(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ccv-lc-proj-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe('withDefaultThinkingDisplay', () => {
  it('非数组原样返回(null/undefined/object)', () => {
    assert.equal(lc.withDefaultThinkingDisplay(null), null);
    assert.equal(lc.withDefaultThinkingDisplay(undefined), undefined);
    const obj = { a: 1 };
    assert.equal(lc.withDefaultThinkingDisplay(obj), obj);
  });

  it('无显式 flag → 追加 --thinking-display summarized', () => {
    assert.deepEqual(lc.withDefaultThinkingDisplay(['--print']), ['--print', '--thinking-display', 'summarized']);
  });

  it('已有 --thinking-display(空格或=形式)→ 原样返回', () => {
    assert.deepEqual(lc.withDefaultThinkingDisplay(['--thinking-display', 'full']), ['--thinking-display', 'full']);
    assert.deepEqual(lc.withDefaultThinkingDisplay(['--thinking-display=none']), ['--thinking-display=none']);
  });
});

describe('parseResumeArgs', () => {
  it('非数组/无续接 flag → null', () => {
    assert.equal(lc.parseResumeArgs(null), null);
    assert.equal(lc.parseResumeArgs(['--print']), null);
  });

  it('-c / --continue → continued,无 resumeValue', () => {
    assert.deepEqual(lc.parseResumeArgs(['-c']), { resumeValue: null, picker: false, fork: false });
    assert.deepEqual(lc.parseResumeArgs(['--continue']), { resumeValue: null, picker: false, fork: false });
  });

  it('-r <id> / --resume=<id> / 裸 -r(picker)', () => {
    assert.deepEqual(lc.parseResumeArgs(['-r', 'abc']), { resumeValue: 'abc', picker: false, fork: false });
    assert.deepEqual(lc.parseResumeArgs(['--resume=abc']), { resumeValue: 'abc', picker: false, fork: false });
    assert.deepEqual(lc.parseResumeArgs(['-r']), { resumeValue: null, picker: true, fork: false });
    assert.deepEqual(lc.parseResumeArgs(['-r', '--verbose']), { resumeValue: null, picker: true, fork: false });
  });

  it('--fork-session 与组合', () => {
    assert.deepEqual(lc.parseResumeArgs(['-c', '--fork-session']), { resumeValue: null, picker: false, fork: true });
  });
});

describe('launchArgsToExtraArgs', () => {
  it('flag/value 对 → 键值;布尔 flag → null;=形式拆分', () => {
    const out = lc.launchArgsToExtraArgs([
      '--system-prompt-file', '/tmp/a.md',
      '--append-system-prompt-file=/tmp/b.md',
      '--verbose',
    ]);
    assert.deepEqual(out, {
      'system-prompt-file': '/tmp/a.md',
      'append-system-prompt-file': '/tmp/b.md',
      verbose: null,
    });
  });

  it('短旗与非字符串跳过;空/非数组 → {}', () => {
    assert.deepEqual(lc.launchArgsToExtraArgs(['-c', '--print', 42]), { print: null });
    assert.deepEqual(lc.launchArgsToExtraArgs(null), {});
    assert.deepEqual(lc.launchArgsToExtraArgs([]), {});
  });

  it('尾随无值 flag → null(不吞下一个 flag)', () => {
    assert.deepEqual(lc.launchArgsToExtraArgs(['--foo', '--bar', 'v']), { foo: null, bar: 'v' });
  });
});

describe('splitSdkLaunchArgs', () => {
  it('--model 两种形态提升;rest 保留其他', () => {
    const r = lc.splitSdkLaunchArgs(['--model', 'opus', '--effort', 'high']);
    assert.equal(r.model, 'opus');
    assert.deepEqual(r.rest, ['--effort', 'high']);
    const r2 = lc.splitSdkLaunchArgs(['--model=sonnet']);
    assert.equal(r2.model, 'sonnet');
    assert.deepEqual(r2.rest, []);
  });

  it('-c/-r/--fork-session 提升;裸 -r 标 pickerResume', () => {
    const r = lc.splitSdkLaunchArgs(['-c', '--fork-session']);
    assert.deepEqual({ c: r.continue, f: r.forkSession, res: r.resume, pick: r.pickerResume },
      { c: true, f: true, res: null, pick: false });
    const r2 = lc.splitSdkLaunchArgs(['-r', 'sess-1']);
    assert.equal(r2.resume, 'sess-1');
    const r3 = lc.splitSdkLaunchArgs(['-r']);
    assert.equal(r3.pickerResume, true);
    assert.equal(r3.resume, null);
    const r4 = lc.splitSdkLaunchArgs(['--resume=sess-2']);
    assert.equal(r4.resume, 'sess-2');
  });

  it('无值 --model 不吞下一个 flag(透传给 claude 自己报错)', () => {
    const r = lc.splitSdkLaunchArgs(['--model', '--verbose']);
    assert.equal(r.model, null);
    assert.deepEqual(r.rest, ['--model', '--verbose']);
  });

  it('非数组输入容错', () => {
    const r = lc.splitSdkLaunchArgs(null);
    assert.deepEqual(r.rest, []);
  });
});

describe('resolveLaunchSystemPrompt — fresh 管线', () => {
  it('CC_SYSTEM.md 非空 → --system-prompt-file 注入(无占位符 → 原路径 pass-through)', () => {
    // render is pass-through for files without ${...} (not rewritten into the rendered
    // temp dir) — this is the established optimization contract (system-prompt-render.js),
    // not "rendering is mandatory".
    const proj = mkProj({ 'CC_SYSTEM.md': 'You are a test assistant.' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {}, launchSettings: null,
      modelReader: () => null, persistPending: false,
    });
    assert.equal(r.sysPrompt.args[0], '--system-prompt-file');
    assert.equal(readFileSync(r.sysPrompt.args[1], 'utf8'), 'You are a test assistant.');
    assert.equal(r.sysPrompt.loaded[0], 'CC_SYSTEM.md');
    assert.equal(r.diagnostic, null);
  });

  it('用户已传同义 flag → sentinel 被抑制', () => {
    const proj = mkProj({ 'CC_SYSTEM.md': 'x' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: ['--system-prompt-file', '/user/own.md'], env: {},
      modelReader: () => null, persistPending: false,
    });
    assert.deepEqual(r.sysPrompt.args, []);
  });

  it('env CCV_DISABLE_AUTO_SYSTEM_PROMPT=1 → suppressed,无注入', () => {
    const proj = mkProj({ 'CC_SYSTEM.md': 'x' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: { CCV_DISABLE_AUTO_SYSTEM_PROMPT: '1' },
      modelReader: () => null, persistPending: false,
    });
    assert.deepEqual(r.sysPrompt.args, []);
    assert.equal(r.sysPrompt.suppressed, 'env');
  });

  it('模型命中 system_prompt 条目 → 取代 sentinel', () => {
    // Entry filenames must follow the <NAME>_SYSTEM.md convention (model-system-prompts.js);
    // sysPrompt.model is the matched entry name (normalized to uppercase), not the model id
    // (aligned with the OPUS_SYSTEM.md precedent in pty-manager.test.js).
    const proj = mkProj({ 'CC_SYSTEM.md': 'sentinel' });
    mkdirSync(join(proj, 'system_prompt'));
    writeFileSync(join(proj, 'system_prompt', 'KIMI_SYSTEM.md'), 'model-specific prompt');
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {},
      modelReader: () => 'glink/Kimi-K3:glink_domestic',
      persistPending: false,
    });
    assert.equal(r.sysPrompt.model, 'KIMI');
    assert.equal(readFileSync(r.sysPrompt.args[1], 'utf8'), 'model-specific prompt');
  });

  it('模型解析了但没命中条目 + 目录存在 → diagnostic=no-match', () => {
    const proj = mkProj({});
    mkdirSync(join(proj, 'system_prompt'));
    writeFileSync(join(proj, 'system_prompt', 'other.md'), 'x');
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {},
      modelReader: () => 'some-unmatched-model',
      persistPending: false,
    });
    assert.equal(r.diagnostic, 'no-match');
    assert.equal(r.resolvedModelId, 'some-unmatched-model');
  });

  it('条目存在但无模型信号 → diagnostic=no-model', () => {
    const proj = mkProj({});
    mkdirSync(join(proj, 'system_prompt'));
    writeFileSync(join(proj, 'system_prompt', 'A_SYSTEM.md'), 'x');
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {},
      modelReader: () => null, persistPending: false,
    });
    assert.equal(r.diagnostic, 'no-model');
  });

  it('suppressInjection=true → 注入清零且不持久化 pending', () => {
    const proj = mkProj({ 'CC_SYSTEM.md': 'x' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {},
      modelReader: () => null, suppressInjection: true, persistPending: true,
    });
    assert.deepEqual(r.sysPrompt.args, []);
    assert.equal(r.pendingRec, null);
  });

  it('fresh + persistPending → pending 记录落盘(wire Bind A 用)', () => {
    const proj = mkProj({ 'CC_SYSTEM.md': 'bind-me' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {},
      modelReader: () => null, persistPending: true,
    });
    assert.ok(r.pendingRec, 'pending recorded');
    assert.equal(r.pendingRec.resumeExpected, false);
  });
});

describe('resolveLaunchSystemPrompt — resume pin', () => {
  it('有快照 → 物化原字节(pin),不重渲染', () => {
    const proj = mkProj({ 'CC_SYSTEM.md': 'fresh content should NOT be used' });
    const uuid = '11111111-2222-4333-8444-555555555555';
    snapshots.writeSnapshot(proj, uuid, {
      entries: [{ flag: '--system-prompt-file', basename: 'CC_SYSTEM.md', content: 'PINNED BYTES' }],
      model: 'm1',
    });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {},
      resume: { resumeValue: uuid, picker: false, fork: false },
      modelReader: () => { throw new Error('must not re-resolve on pin'); },
      persistPending: false,
    });
    assert.equal(r.sysPrompt.pinned, true);
    assert.equal(r.sysPrompt.args[0], '--system-prompt-file');
    assert.equal(readFileSync(r.sysPrompt.args[1], 'utf8'), 'PINNED BYTES');
  });

  it('无快照 → F2:完全不注入(不动既有上下文的 system 文本)', () => {
    const proj = mkProj({ 'CC_SYSTEM.md': 'would-be-fresh' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: [], env: {},
      resume: { resumeValue: '66666666-7777-4888-8999-000000000000', picker: false, fork: false },
      modelReader: () => null, persistPending: false,
    });
    assert.equal(r.sysPrompt.pinned, true);
    assert.equal(r.sysPrompt.noRecord, true);
    assert.deepEqual(r.sysPrompt.args, []);
  });

  it('显式 resume:null → 强制 fresh 管线(即使有 -c 在 extraArgs 也不解析)', () => {
    const proj = mkProj({ 'CC_SYSTEM.md': 'fresh' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: ['-c'], env: {},
      resume: null,
      modelReader: () => null, persistPending: false,
    });
    assert.equal(r.sysPrompt.pinned, undefined);
    assert.ok(r.sysPrompt.args.length > 0, 'fresh injection proceeds');
  });

  it('resumeIntent undefined → 从 extraArgs 解析(PTY 路径兼容)', () => {
    const proj = mkProj({});
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    snapshots.writeSnapshot(proj, uuid, {
      entries: [{ flag: '--system-prompt-file', basename: 'CC_SYSTEM.md', content: 'PIN2' }],
      model: null,
    });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: ['-r', uuid], env: {},
      modelReader: () => null, persistPending: false,
    });
    assert.equal(r.sysPrompt.pinned, true);
    assert.equal(readFileSync(r.sysPrompt.args[1], 'utf8'), 'PIN2');
  });

  it('insideLogDir(IM worker)→ 跳过 pin 机械,走 fresh', () => {
    const proj = mkProj({ 'CC_APPEND_SYSTEM.md': 'persona' });
    const r = lc.resolveLaunchSystemPrompt({
      spawnDir: proj, extraArgs: ['-c'], env: {},
      insideLogDir: true,
      modelReader: () => null, persistPending: false,
    });
    assert.equal(r.resume, null, 'insideLogDir forces resume=null');
    assert.ok(r.sysPrompt.args.length > 0);
  });
});
