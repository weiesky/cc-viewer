import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  KEEP_CLAUDE_NO_FLICKER_ENV,
  prepareEmbeddedShellSpawn,
  stripClaudeNoFlickerUnlessOptedIn,
  KEEP_CLAUDE_FULLSCREEN_ENV,
  applyClaudeAltScreenPref,
} from '../server/lib/terminal-env.js';

const tmpDirs = [];

afterEach(() => {
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ccv-terminal-env-'));
  tmpDirs.push(dir);
  return dir;
}

describe('terminal-env: CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN default-on/opt-out', () => {
  it('默认注入 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1(未 opt-out)', () => {
    const env = {};
    applyClaudeAltScreenPref(env, {});
    assert.equal(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, '1');
  });

  it('sourceEnv 里 opt-out(CCV_KEEP_CLAUDE_FULLSCREEN=1)→ 不注入', () => {
    const env = {};
    applyClaudeAltScreenPref(env, { [KEEP_CLAUDE_FULLSCREEN_ENV]: '1' });
    assert.equal(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, undefined);
  });

  it('env 里 opt-out(继承自 {...process.env})→ 不注入', () => {
    const env = { [KEEP_CLAUDE_FULLSCREEN_ENV]: '1' };
    applyClaudeAltScreenPref(env, {});
    assert.equal(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, undefined);
  });

  it('剥离 cc-viewer 内部 opt-out 开关，不泄漏给子进程', () => {
    const env = { [KEEP_CLAUDE_FULLSCREEN_ENV]: '1' };
    applyClaudeAltScreenPref(env, {});
    assert.equal(env[KEEP_CLAUDE_FULLSCREEN_ENV], undefined);
  });

  it('尊重用户显式 CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN(含显式 "0" 主动开全屏，不覆盖)', () => {
    const env = { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '0' };
    applyClaudeAltScreenPref(env, {});
    assert.equal(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, '0');
  });

  it('opt-out 值非 "1" 不触发(只认精确 "1"，仍默认注入)', () => {
    const env = {};
    applyClaudeAltScreenPref(env, { [KEEP_CLAUDE_FULLSCREEN_ENV]: 'true' });
    assert.equal(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN, '1');
  });
});

describe('terminal-env: CLAUDE_CODE_NO_FLICKER handling', () => {
  it('strips inherited CLAUDE_CODE_NO_FLICKER by default', () => {
    const env = { CLAUDE_CODE_NO_FLICKER: '1' };
    stripClaudeNoFlickerUnlessOptedIn(env, {});
    assert.equal(env.CLAUDE_CODE_NO_FLICKER, undefined);
  });

  it('preserves CLAUDE_CODE_NO_FLICKER when explicitly opted in', () => {
    const env = { CLAUDE_CODE_NO_FLICKER: '1' };
    stripClaudeNoFlickerUnlessOptedIn(env, { [KEEP_CLAUDE_NO_FLICKER_ENV]: '1' });
    assert.equal(env.CLAUDE_CODE_NO_FLICKER, '1');
  });

  it('wraps zsh rc so user rc can run before unsetting NO_FLICKER', () => {
    const rcDir = makeTmpDir();
    const homeDir = makeTmpDir();
    const env = { CLAUDE_CODE_NO_FLICKER: '1' };
    const result = prepareEmbeddedShellSpawn('/bin/zsh', env, { rcDir, homeDir, sourceEnv: {} });

    assert.equal(result.command, '/bin/zsh');
    assert.deepEqual(result.args, []);
    assert.equal(result.env.CLAUDE_CODE_NO_FLICKER, undefined);
    assert.equal(result.env.CCV_ORIGINAL_ZDOTDIR, homeDir);
    assert.equal(result.env.ZDOTDIR, rcDir);

    const zshEnvWrapper = readFileSync(join(rcDir, '.zshenv'), 'utf8');
    assert.match(zshEnvWrapper, /source "\$__ccv_original_zdotdir\/\.zshenv"/);
    assert.match(zshEnvWrapper, /export ZDOTDIR="\$__ccv_wrapper_zdotdir"/);

    const zshRcWrapper = readFileSync(join(rcDir, '.zshrc'), 'utf8');
    assert.match(zshRcWrapper, /source "\$__ccv_original_zdotdir\/\.zshrc"/);
    assert.match(zshRcWrapper, /unset CLAUDE_CODE_NO_FLICKER/);
  });

  it('wraps bash with an rcfile that unsets NO_FLICKER after user rc', () => {
    const rcDir = makeTmpDir();
    const homeDir = makeTmpDir();
    const env = { CLAUDE_CODE_NO_FLICKER: '1' };
    const result = prepareEmbeddedShellSpawn('/bin/bash', env, { rcDir, homeDir, sourceEnv: {} });

    assert.equal(result.command, '/bin/bash');
    assert.deepEqual(result.args, ['--rcfile', join(rcDir, 'bashrc'), '-i']);
    assert.equal(result.env.CLAUDE_CODE_NO_FLICKER, undefined);
    assert.equal(result.env.CCV_ORIGINAL_BASHRC, join(homeDir, '.bashrc'));

    const wrapper = readFileSync(join(rcDir, 'bashrc'), 'utf8');
    assert.match(wrapper, /CCV_ORIGINAL_BASHRC/);
    assert.match(wrapper, /unset CLAUDE_CODE_NO_FLICKER/);
  });

  it("spawns zsh that actually sources the user's ~/.zshrc (regression)", { skip: !existsSync('/bin/zsh') }, () => {
    const rcDir = makeTmpDir();
    const homeDir = makeTmpDir();
    // Synthetic user rc files so we can detect whether the wrapper sourced them.
    writeFileSync(join(homeDir, '.zshenv'), 'export CCV_TEST_ZSHENV_LOADED=1\n');
    writeFileSync(join(homeDir, '.zshrc'), 'export CCV_TEST_ZSHRC_LOADED=1\nccv_test_fn() { echo from-user-zshrc; }\n');

    const env = {};
    const result = prepareEmbeddedShellSpawn('/bin/zsh', env, { rcDir, homeDir, sourceEnv: {} });

    const probe = spawnSync('/bin/zsh', ['-i', '-c', 'echo "ENV=${CCV_TEST_ZSHENV_LOADED:-0} RC=${CCV_TEST_ZSHRC_LOADED:-0} FN=$(typeset -f ccv_test_fn >/dev/null && echo yes || echo no)"'], {
      env: { ...result.env, HOME: homeDir, PATH: process.env.PATH },
      encoding: 'utf8',
    });
    assert.equal(probe.status, 0, `zsh exited ${probe.status}: ${probe.stderr}`);
    // Wrapper bug previously made the [[ != ]] check in .zshrc compare wrapper==wrapper,
    // silently skipping `source $HOME/.zshrc` — so RC and FN would stay at the defaults.
    assert.match(probe.stdout, /ENV=1 RC=1 FN=yes/, `user zshrc not sourced: ${probe.stdout}`);
  });

  it('leaves shell startup unchanged when NO_FLICKER keep opt-in is set', () => {
    const rcDir = makeTmpDir();
    const homeDir = makeTmpDir();
    const env = {
      CLAUDE_CODE_NO_FLICKER: '1',
      [KEEP_CLAUDE_NO_FLICKER_ENV]: '1',
    };
    const result = prepareEmbeddedShellSpawn('/bin/zsh', env, { rcDir, homeDir, sourceEnv: {} });

    assert.equal(result.env.CLAUDE_CODE_NO_FLICKER, '1');
    assert.equal(result.env.ZDOTDIR, undefined);
    assert.deepEqual(result.args, []);
  });
});
