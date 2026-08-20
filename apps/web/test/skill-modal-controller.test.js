/**
 * src/utils/skillModalController.js 单元测试 —— 共享「开关 / 永久删除」控制器。
 *
 * 这是新抽出的乐观更新 + 失败回滚 + reload 保位合并逻辑，原本零测试覆盖（服务端很全，前端这块是空白）。
 * 控制器以「类组件实例」为 host（state._skillsModal / state._fsSkills / setState / reloadFsSkills），
 * 测试用一个仿 React 的假 host（setState 同步浅合并、reloadFsSkills 返回可配置结果）+ 打桩的全局 fetch +
 * antd message stub（见 _shims/antd-stub.mjs）来驱动各分支，断言「状态变化」而非 toast 文案。
 *
 * 模块依赖（apiUrl 读 window.location、antd message、i18n 无扩展名 import）需要：
 *  - 先 register vite-loader（无扩展名 / 资源 import）+ antd-stub（裸 'antd'）
 *  - 提供 window / document / navigator 全局（apiUrl 在模块顶层就读 window.location.search）
 *  - 再【动态 import】目标模块
 */
import './_shims/register.mjs';
import { register } from 'node:module';
register('./_shims/antd-stub.mjs', import.meta.url);

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// apiUrl.js 顶层执行 `new URLSearchParams(window.location.search)`，import 前 window 必须就位
globalThis.window = globalThis.window || { location: { search: '' } };
if (!globalThis.window.location) globalThis.window.location = { search: '' };
globalThis.document = globalThis.document || { querySelector: () => null };

// 打桩全局 fetch：每个用例覆写 fetchHandler；默认抛错以暴露未配置的用例。
// 保存原值并在 after() 还原（real-request-guard R2：改了全局 fetch 必须可还原，不污染同进程后续用例）。
const ORIG_FETCH = globalThis.fetch;
let fetchHandler = async () => { throw new Error('fetchHandler not set'); };
globalThis.fetch = (...args) => fetchHandler(...args);
after(() => { globalThis.fetch = ORIG_FETCH; });

const resp = (ok, body) => ({ ok, json: async () => body });

let H;       // skillModalController 模块
let skillKey;

before(async () => {
  H = await import('../src/utils/skillModalController.js');
  ({ skillKey } = await import('../src/utils/skillsParser.js'));
});

// 仿 React 类组件实例：setState 同步、支持函数式 updater（控制器只用函数式），浅合并到 host.state。
function makeHost({ skills = [], fsSkills = [], reload = null, toggling = new Set() } = {}) {
  const host = {
    reloadResult: reload,
    reloadCalls: 0,
    state: {
      _skillsModal: { open: true, loading: false, error: null, skills, toggling },
      _fsSkills: fsSkills,
    },
    setState(updater) {
      const partial = typeof updater === 'function' ? updater(host.state) : updater;
      host.state = { ...host.state, ...partial };
    },
    async reloadFsSkills() {
      host.reloadCalls += 1;
      return host.reloadResult || { ok: false };
    },
  };
  return host;
}

const mkSkill = (over = {}) => ({ source: 'project', name: 'alpha', enabled: true, path: '/p/.claude/skills/alpha', ...over });
const sB = () => ({ source: 'user', name: 'beta', enabled: false, path: '/h/.claude/skills-skip/beta' });

describe('handleSkillToggle', () => {
  it('success: 乐观翻转 + reload 保位合并 + toggling 清空 + _fsSkills 乐观更新', async () => {
    const host = makeHost({
      skills: [mkSkill(), sB()],
      fsSkills: [mkSkill(), sB()],
      // 权威态：alpha 被关掉、path 搬到 skills-skip（顺序故意打乱，验证保位）
      reload: { ok: true, skills: [sB(), mkSkill({ enabled: false, path: '/p/.claude/skills-skip/alpha' })] },
    });
    let calls = 0;
    fetchHandler = async () => { calls += 1; return resp(true, { ok: true }); };

    await H.handleSkillToggle(host, host.state._skillsModal.skills[0]); // 关 alpha

    assert.equal(calls, 1);
    assert.equal(host.reloadCalls, 1);
    assert.equal(host.state._skillsModal.toggling.size, 0, 'toggling 应清空');
    const merged = host.state._skillsModal.skills;
    assert.deepEqual(merged.map(s => s.name), ['alpha', 'beta'], '保位：alpha 仍在 beta 前');
    assert.equal(merged[0].enabled, false, '用权威态：alpha 关闭');
    assert.equal(host.state._fsSkills[0].enabled, false, '_fsSkills 乐观翻转');
  });

  it('failure (DUPLICATE): 回滚到原值 + 不调用 reload + toggling 清空', async () => {
    const host = makeHost({ skills: [mkSkill()], fsSkills: [mkSkill()] });
    fetchHandler = async () => resp(false, { code: 'DUPLICATE', error: 'dup' });

    await H.handleSkillToggle(host, host.state._skillsModal.skills[0]);

    assert.equal(host.state._skillsModal.skills[0].enabled, true, '失败回滚到原 enabled');
    assert.equal(host.reloadCalls, 0, '!ok 提前返回，不 reload');
    assert.equal(host.state._skillsModal.toggling.size, 0);
  });

  it('network throw: 回滚 + toggling 清空', async () => {
    const host = makeHost({ skills: [mkSkill()], fsSkills: [mkSkill()] });
    fetchHandler = async () => { throw new Error('neterr'); };

    await H.handleSkillToggle(host, host.state._skillsModal.skills[0]);

    assert.equal(host.state._skillsModal.skills[0].enabled, true, '网络异常也回滚');
    assert.equal(host.state._skillsModal.toggling.size, 0);
  });

  it('re-entrancy: 该行已在 toggling 中 → 直接返回，不发请求', async () => {
    const s = mkSkill();
    const host = makeHost({ skills: [s], toggling: new Set([skillKey(s)]) });
    let calls = 0;
    fetchHandler = async () => { calls += 1; return resp(true, { ok: true }); };

    await H.handleSkillToggle(host, host.state._skillsModal.skills[0]);

    assert.equal(calls, 0, '重入被挡，fetch 不应被调用');
  });
});

describe('handleSkillDelete', () => {
  it('success: 乐观移除该行 + _fsSkills 过滤 + reload 合并 + toggling 清空', async () => {
    const host = makeHost({
      skills: [mkSkill(), sB()],
      fsSkills: [mkSkill(), sB()],
      reload: { ok: true, skills: [sB()] },
    });
    let calls = 0;
    fetchHandler = async () => { calls += 1; return resp(true, { ok: true }); };

    await H.handleSkillDelete(host, host.state._skillsModal.skills[0]); // 删 alpha

    assert.equal(calls, 1);
    assert.equal(host.reloadCalls, 1);
    assert.equal(host.state._skillsModal.toggling.size, 0);
    assert.equal(host.state._skillsModal.skills.length, 1);
    assert.equal(host.state._skillsModal.skills[0].name, 'beta');
    assert.ok(!host.state._fsSkills.find(s => s.name === 'alpha'), '_fsSkills 也移除 alpha');
  });

  it('failure: 不移除该行 + 不 reload + toggling 清空', async () => {
    const host = makeHost({ skills: [mkSkill(), sB()], fsSkills: [mkSkill(), sB()] });
    fetchHandler = async () => resp(false, { error: 'nope' });

    await H.handleSkillDelete(host, host.state._skillsModal.skills[0]);

    assert.ok(host.state._skillsModal.skills.find(s => s.name === 'alpha'), '失败不移除');
    assert.equal(host.reloadCalls, 0);
    assert.equal(host.state._skillsModal.toggling.size, 0);
  });

  it('re-entrancy: 该行已在 toggling 中 → 直接返回，不发请求', async () => {
    const s = mkSkill();
    const host = makeHost({ skills: [s], toggling: new Set([skillKey(s)]) });
    let calls = 0;
    fetchHandler = async () => { calls += 1; return resp(true, { ok: true }); };

    await H.handleSkillDelete(host, host.state._skillsModal.skills[0]);

    assert.equal(calls, 0, '重入被挡，fetch 不应被调用');
  });
});

describe('mergePreservingOrder', () => {
  it('保持 prev 顺序，prev 未见过的新条目排末尾', () => {
    const prev = [mkSkill(), sB()];
    const result = [
      sB(),
      mkSkill({ path: '/p/.claude/skills-skip/alpha' }), // path 变了但 source+name 不变 → 同 orderKey
      { source: 'project', name: 'cee', enabled: true, path: '/p/.claude/skills/cee' }, // 新条目
    ];
    const merged = H.mergePreservingOrder(prev, result);
    assert.deepEqual(merged.map(s => s.name), ['alpha', 'beta', 'cee']);
  });

  it('prev 为空 → 全部视为新条目，原样返回（稳定顺序）', () => {
    const result = [mkSkill(), sB()];
    const merged = H.mergePreservingOrder([], result);
    assert.equal(merged.length, 2);
  });
});
