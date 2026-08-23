/**
 * wsOpen gate expression guard (grep-guard static assertions).
 *
 * Regression background: wsOpen in App.jsx / Mobile.jsx was once written as
 * `!isLocalLog && !sdkMode`, which meant the terminal WS never connected in SDK mode —
 * sdk-user-message and the three-way approval replies (sdk-ask-answer / sdk-plan-answer /
 * perm-hook-answer) all silently dropped (App.jsx comments admitted "SDK-mode WS being
 * missing is a latent issue"). After the fix SDK mode also connects; PTY-only messages are
 * no-oped on
 * the server side by the isSdkMode guard (server.js).
 *
 * Same pattern as new-ui-i18n.test.js: read source and assert with regex, no React/JSX
 * (render-level tests cannot run under node:test — see the header note in
 * single-ws-submit.test.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appSrc = readFileSync(join(SRC, 'App.jsx'), 'utf-8');
const mobileSrc = readFileSync(join(SRC, 'Mobile.jsx'), 'utf-8');

describe('wsOpen gate — SDK 模式不再被排除', () => {
  it('App.jsx:wsOpen 不含 sdkMode 排除', () => {
    const m = appSrc.match(/const wsOpen = ([^;]+);/);
    assert.ok(m, 'App.jsx 应有 const wsOpen = ... 赋值');
    assert.ok(!m[1].includes('sdkMode'), `App.jsx wsOpen 仍排除 sdkMode: ${m[1]}`);
  });

  it('Mobile.jsx:wsOpen 不含 sdkMode 排除', () => {
    const m = mobileSrc.match(/const wsOpen = ([^;]+);/);
    assert.ok(m, 'Mobile.jsx 应有 const wsOpen = ... 赋值');
    assert.ok(!m[1].includes('sdkMode'), `Mobile.jsx wsOpen 仍排除 sdkMode: ${m[1]}`);
  });

  it('两处的 isLocalLog 排除保留(本地日志查看仍不连)', () => {
    const mApp = appSrc.match(/const wsOpen = ([^;]+);/);
    const mMob = mobileSrc.match(/const wsOpen = ([^;]+);/);
    // App uses the instance field this._isLocalLog, Mobile uses the local variable
    // mobileIsLocalLog — assert case-insensitively.
    assert.ok(/isLocalLog/i.test(mApp[1]), 'App.jsx 的 isLocalLog 排除被误删');
    assert.ok(/isLocalLog/i.test(mMob[1]), 'Mobile.jsx 的 isLocalLog 排除被误删');
  });
});
