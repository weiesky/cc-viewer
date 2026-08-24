// Unit tests for src/utils/builtinPromptTabs.js — the built-in tab rules that only
// exist in UI code (dual-tombstone clear, shadowed race guard, effective disabled state).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SCOPE,
  isBuiltinEntryDisabled,
  builtinTargetScope,
  builtinToggleScopes,
  isBuiltinShadowed,
} from '../src/utils/builtinPromptTabs.js';

describe('isBuiltinEntryDisabled — 有效禁用态合成', () => {
  it('workspace/global 任一为真即禁用；全假/空/缺失 → 未禁用', () => {
    assert.equal(isBuiltinEntryDisabled({ disabled: { workspace: true, global: false } }), true);
    assert.equal(isBuiltinEntryDisabled({ disabled: { workspace: false, global: true } }), true);
    assert.equal(isBuiltinEntryDisabled({ disabled: { workspace: true, global: true } }), true);
    assert.equal(isBuiltinEntryDisabled({ disabled: { workspace: false, global: false } }), false);
    assert.equal(isBuiltinEntryDisabled({ disabled: {} }), false);
    assert.equal(isBuiltinEntryDisabled({}), false);
    assert.equal(isBuiltinEntryDisabled(null), false);
    assert.equal(isBuiltinEntryDisabled(undefined), false);
  });
});

describe('builtinTargetScope — 目标作用域', () => {
  it('选择 workspace 且有活动工作区 → workspace；其余一律 global', () => {
    assert.equal(builtinTargetScope('workspace', true), 'workspace');
    assert.equal(builtinTargetScope('workspace', false), 'global');
    assert.equal(builtinTargetScope('global', true), 'global');
    assert.equal(builtinTargetScope(undefined, true), 'global');
  });
});

describe('builtinToggleScopes — 禁用/启用目标 scope 列表', () => {
  it('禁用 → 仅所选目标 scope', () => {
    assert.deepEqual(builtinToggleScopes({ disabled: {} }, true, 'global'), ['global']);
    assert.deepEqual(builtinToggleScopes({ disabled: {} }, true, 'workspace'), ['workspace']);
  });

  it('启用 → 所有实际墓碑所在 scope（双墓碑一次全清，防死路）', () => {
    assert.deepEqual(builtinToggleScopes({ disabled: { workspace: true } }, false, 'global'), ['workspace']);
    assert.deepEqual(builtinToggleScopes({ disabled: { global: true } }, false, 'global'), ['global']);
    assert.deepEqual(builtinToggleScopes({ disabled: { workspace: true, global: true } }, false, 'global'), ['workspace', 'global']);
  });

  it('启用但无任何墓碑 → 空列表（状态已一致，调用方无操作）', () => {
    assert.deepEqual(builtinToggleScopes({ disabled: {} }, false, 'global'), []);
    assert.deepEqual(builtinToggleScopes(null, false, 'global'), []);
  });
});

describe('isBuiltinShadowed — shadowed 竞态判定', () => {
  const entries = [
    { name: 'KIMI-K3', scope: 'builtin' },
    { name: 'OPUS', scope: 'global' },
    { name: 'KIMI-K3', scope: 'workspace' }, // 会话内新建未持久化也在 entries 里
  ];

  it('非内置条目占用目标 key → true（含未持久化新页签）', () => {
    assert.equal(isBuiltinShadowed(entries, 'global:OPUS'), true);
    assert.equal(isBuiltinShadowed(entries, 'workspace:KIMI-K3'), true);
  });

  it('仅内置条目同名/其它 scope 空闲 → false', () => {
    assert.equal(isBuiltinShadowed(entries, 'global:KIMI-K3'), false); // builtin scope 不算占用
    assert.equal(isBuiltinShadowed(entries, 'global:GLM-5.2'), false);
    assert.equal(isBuiltinShadowed([], 'global:OPUS'), false);
    assert.equal(isBuiltinShadowed(null, 'global:OPUS'), false);
  });
});

describe('BUILTIN_SCOPE 常量', () => {
  it('是 builtin', () => {
    assert.equal(BUILTIN_SCOPE, 'builtin');
  });
});
