/**
 * Unit tests for src/utils/sdkModelChip.js — the pure guard behind AppHeader's SDK
 * launch-model chip. The chip is a hot-switch FALLBACK: it only renders when the proxy
 * hot-switch chip renders nothing (official Default / dormant) AND we're in SDK mode with
 * a known launch model. Hot-switch must always win.
 *
 * src/utils is Vite-style (extensionless relative imports), so the shims loader registers
 * first, then the target is dynamically imported.
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let shouldRenderSdkModelChip;

before(async () => {
  ({ shouldRenderSdkModelChip } = await import('../src/utils/sdkModelChip.js'));
});

describe('sdkModelChip — shouldRenderSdkModelChip', () => {
  it('代理热切换 chip 已渲染 → false(热切换优先,绝不出双标)', () => {
    assert.equal(shouldRenderSdkModelChip({ sdkMode: true, sdkModel: 'claude-sonnet-4-6', proxyChipVisible: true }), false);
  });

  it('官方 Default(chip 不渲染)+ sdkMode + 已知 model → true', () => {
    assert.equal(shouldRenderSdkModelChip({ sdkMode: true, sdkModel: 'claude-sonnet-4-6', proxyChipVisible: false }), true);
  });

  it('sdkModel 为 null/空(sdk-init 未发或无 model)→ false', () => {
    assert.equal(shouldRenderSdkModelChip({ sdkMode: true, sdkModel: null, proxyChipVisible: false }), false);
    assert.equal(shouldRenderSdkModelChip({ sdkMode: true, sdkModel: '', proxyChipVisible: false }), false);
    assert.equal(shouldRenderSdkModelChip({ sdkMode: true, sdkModel: undefined, proxyChipVisible: false }), false);
  });

  it('非 SDK 模式 → false(即便 chip 槽空且有 model)', () => {
    assert.equal(shouldRenderSdkModelChip({ sdkMode: false, sdkModel: 'claude-sonnet-4-6', proxyChipVisible: false }), false);
  });
});
