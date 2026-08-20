/**
 * src/utils/teammateAvatars.js 单元测试。
 *
 * 该模块用 17 个 `import x from '...svg?raw'`（Vite 语法），_shims loader 会把每个
 * svg 资源 stub 成字符串 "__ccv_asset_stub__:<文件名>.svg"，正好用来断言
 * ROLE_MAP 的 角色→svg 映射 与 getTeammateAvatar 的解析回退逻辑。
 * 因此本文件必须 import _shims/register.mjs 后用【动态 import】加载目标模块。
 *
 * 覆盖：
 *   - ROLE_MAP 全部 17 个角色映射到对应 svg stub
 *   - getTeammateAvatar 返回 { svg, color, role } 结构
 *   - 解析优先级链：prefix > suffix > contains > abbrev-prefix > hash-fallback > default
 *   - "Teammate: " 前缀剥离、"(model-info)" 后缀剥离、大小写无关
 *   - 空/空白名 → default
 *   - color 为 var(--avatar-bg-N)，N ∈ [0,19] 且对同名稳定
 *   - hash 回退对未匹配名稳定（pin 当前确定性输出）
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let ROLE_MAP, getTeammateAvatar;

before(async () => {
  const m = await import('../src/utils/teammateAvatars.js');
  ROLE_MAP = m.ROLE_MAP;
  getTeammateAvatar = m.getTeammateAvatar;
});

const stub = (file) => `__ccv_asset_stub__:${file}`;

describe('ROLE_MAP', () => {
  it('包含 17 个角色（16 实角色 + default）', () => {
    assert.equal(Object.keys(ROLE_MAP).length, 17);
  });

  it('每个角色映射到与其同名的 svg stub', () => {
    const expected = {
      worker: 'worker.svg',
      reviewer: 'reviewer.svg',
      researcher: 'researcher.svg',
      explorer: 'explorer.svg',
      analyst: 'analyst.svg',
      tracer: 'tracer.svg',
      investigator: 'investigator.svg',
      builder: 'builder.svg',
      implementer: 'implementer.svg',
      auditor: 'auditor.svg',
      translator: 'translator.svg',
      security: 'security.svg',
      scanner: 'scanner.svg',
      expert: 'expert.svg',
      executor: 'executor.svg',
      designer: 'designer.svg',
      default: 'default.svg',
    };
    for (const [role, file] of Object.entries(expected)) {
      assert.equal(ROLE_MAP[role].svg, stub(file), `role ${role}`);
    }
  });
});

describe('getTeammateAvatar - 返回结构', () => {
  it('返回 { svg, color, role } 三字段', () => {
    const r = getTeammateAvatar('worker-1');
    assert.deepEqual(Object.keys(r).sort(), ['color', 'role', 'svg']);
    assert.equal(r.role, 'worker');
    assert.equal(r.svg, stub('worker.svg'));
    assert.match(r.color, /^var\(--avatar-bg-\d+\)$/);
  });

  it('color 索引落在 [0,19]', () => {
    for (const name of ['a', 'worker', 'reviewer-x', 'zzz', 'verylongnamehere']) {
      const m = getTeammateAvatar(name).color.match(/^var\(--avatar-bg-(\d+)\)$/);
      assert.ok(m, name);
      const idx = Number(m[1]);
      assert.ok(idx >= 0 && idx <= 19, `${name} -> ${idx}`);
    }
  });

  it('同名稳定返回同 color 与 role', () => {
    const a = getTeammateAvatar('stable-name');
    const b = getTeammateAvatar('stable-name');
    assert.deepEqual(a, b);
  });
});

describe('getTeammateAvatar - 空/空白', () => {
  it('null/undefined/空串/纯空白 → default', () => {
    for (const name of [null, undefined, '', '   ']) {
      const r = getTeammateAvatar(name);
      assert.equal(r.role, 'default');
      assert.equal(r.svg, stub('default.svg'));
    }
  });

  it('空名 color 索引为 0（空串 hash=0）', () => {
    assert.equal(getTeammateAvatar('').color, 'var(--avatar-bg-0)');
  });
});

describe('getTeammateAvatar - 前后缀剥离', () => {
  it('剥离 "Teammate: " 前缀（大小写无关）后再解析', () => {
    assert.equal(getTeammateAvatar('Teammate: worker-1').role, 'worker');
    assert.equal(getTeammateAvatar('TEAMMATE: reviewer-x').role, 'reviewer');
  });

  it('剥离尾部 "(model-info)" 后缀后再解析', () => {
    // "analyzer-bot (sonnet)" -> strip -> "analyzer-bot" -> contains 'analy' -> analyst
    assert.equal(getTeammateAvatar('analyzer-bot (sonnet)').role, 'analyst');
  });

  it('前后缀同时剥离', () => {
    const r = getTeammateAvatar('Teammate: builder-x (claude-opus)');
    assert.equal(r.role, 'builder');
  });
});

describe('getTeammateAvatar - PREFIX_RULES（最高优先级）', () => {
  it('worker- / reviewer- / researcher- / explorer- / explore- / translator- / svg-creator-', () => {
    assert.equal(getTeammateAvatar('worker-9').role, 'worker');
    assert.equal(getTeammateAvatar('reviewer-9').role, 'reviewer');
    assert.equal(getTeammateAvatar('researcher-9').role, 'researcher');
    assert.equal(getTeammateAvatar('explorer-9').role, 'explorer');
    assert.equal(getTeammateAvatar('explore-9').role, 'explorer');
    assert.equal(getTeammateAvatar('translator-9').role, 'translator');
    assert.equal(getTeammateAvatar('svg-creator-x').role, 'designer');
  });

  it('大小写无关（输入被 toLowerCase）', () => {
    assert.equal(getTeammateAvatar('WORKER-1').role, 'worker');
    assert.equal(getTeammateAvatar('Worker').role, 'worker'); // contains 'work'
  });
});

describe('getTeammateAvatar - SUFFIX_RULES', () => {
  it('各后缀映射到对应角色', () => {
    const cases = {
      'x-reviewer': 'reviewer',
      'x-analyst': 'analyst',
      'x-tracer': 'tracer',
      'x-investigator': 'investigator',
      'x-builder': 'builder',
      'x-impl': 'implementer',
      'x-auditor': 'auditor',
      'x-scanner': 'scanner',
      'x-expert': 'expert',
      'x-executor': 'executor',
    };
    for (const [name, role] of Object.entries(cases)) {
      assert.equal(getTeammateAvatar(name).role, role, name);
    }
  });
});

describe('getTeammateAvatar - CONTAINS_RULES', () => {
  it('关键字子串映射（前后缀均不命中时）', () => {
    assert.equal(getTeammateAvatar('SecurityGuard').role, 'security');
    assert.equal(getTeammateAvatar('the-implementer-team').role, 'implementer');
    assert.equal(getTeammateAvatar('do-review-now').role, 'reviewer');
    assert.equal(getTeammateAvatar('go-explor-around').role, 'explorer');
    assert.equal(getTeammateAvatar('deep-research-x').role, 'researcher');
    assert.equal(getTeammateAvatar('data-analy-x').role, 'analyst');
    assert.equal(getTeammateAvatar('trac-it').role, 'tracer');
    assert.equal(getTeammateAvatar('investigat-it').role, 'investigator');
    assert.equal(getTeammateAvatar('with-build-in-it').role, 'builder');
    assert.equal(getTeammateAvatar('audit-it').role, 'auditor');
    assert.equal(getTeammateAvatar('translat-it').role, 'translator');
    assert.equal(getTeammateAvatar('scan-it').role, 'scanner');
    assert.equal(getTeammateAvatar('expert-x').role, 'expert');
    assert.equal(getTeammateAvatar('execut-it').role, 'executor');
    assert.equal(getTeammateAvatar('design-it').role, 'designer');
    assert.equal(getTeammateAvatar('work-it').role, 'worker');
  });
});

describe('getTeammateAvatar - ABBREV_PREFIX_RULES', () => {
  it('cr- / r- / ui- / ux- → reviewer（在 contains 之后）', () => {
    assert.equal(getTeammateAvatar('cr-1').role, 'reviewer');
    assert.equal(getTeammateAvatar('r-2').role, 'reviewer');
    assert.equal(getTeammateAvatar('ui-x').role, 'reviewer');
    assert.equal(getTeammateAvatar('ux-y').role, 'reviewer');
  });
});

describe('getTeammateAvatar - 优先级顺序', () => {
  it('prefix 早于 contains：foo-reviewer 走 suffix(reviewer) 而非 contains', () => {
    // foo-reviewer 命中 SUFFIX '-reviewer'，结果 reviewer
    assert.equal(getTeammateAvatar('foo-reviewer').role, 'reviewer');
  });

  it('PREFIX 早于 CONTAINS：explore- 前缀 即便也含 explor 仍走 explorer', () => {
    assert.equal(getTeammateAvatar('explore-x').role, 'explorer');
  });

  it('CONTAINS 早于 ABBREV：含 work 的 r-xx 应优先匹配 contains? r-rework -> work -> worker', () => {
    // 'r-rework' 含 'work'(contains) 先于 abbrev 'r-'，故 worker
    assert.equal(getTeammateAvatar('r-rework').role, 'worker');
  });
});

describe('getTeammateAvatar - hash 回退（无任何规则命中）', () => {
  it('未匹配名落入确定性 hash 回退（pin 现状）', () => {
    // 这些名不命中任何 prefix/suffix/contains/abbrev 规则
    assert.equal(getTeammateAvatar('zzz').role, 'translator');
    assert.equal(getTeammateAvatar('random-xyz-name').role, 'auditor');
  });

  it('hash 回退对同名稳定、且 role 属于 ROLE_MAP 非 default 集合', () => {
    const nonDefault = Object.keys(ROLE_MAP).filter(k => k !== 'default');
    const r1 = getTeammateAvatar('qqpp');
    const r2 = getTeammateAvatar('qqpp');
    assert.equal(r1.role, r2.role);
    assert.ok(nonDefault.includes(r1.role));
    assert.notEqual(r1.role, 'default');
  });
});
