// Regression net: lock the EVENT_KEYS set in place so any future "let's add timeoutWarning
// back" PR fails CI loudly instead of silently reactivating events that have no UI hook
// (倒计时已 24h 实质无超时，AskTimeoutCountdown isInfiniteTimeout return null 不再触发预警).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_KEYS,
  DEFAULT_BINDINGS,
  BUNDLED_PACK_IDS,
  getDefaultBindingsForLocale,
} from '../src/voice-pack-events.js';

describe('voice-pack-events.js EVENT_KEYS 不变量', () => {
  it('当前 EVENT_KEYS 锁定为 3 项 (planApproval / askQuestion / turnEnd)', () => {
    assert.equal(EVENT_KEYS.length, 3, `EVENT_KEYS 长度必须为 3，实测 ${EVENT_KEYS.length}: ${EVENT_KEYS.join(',')}`);
    assert.deepEqual(
      [...EVENT_KEYS].sort(),
      ['askQuestion', 'planApproval', 'turnEnd'],
      'EVENT_KEYS 内容必须严格匹配（防 typo / 误增 / 误删）',
    );
  });

  it('timeoutWarning5min / timeoutWarning60s 已彻底剔除（防回滚）', () => {
    assert.ok(!EVENT_KEYS.includes('timeoutWarning5min'),
      'timeoutWarning5min 已删除（24h 无超时后无意义），不应回滚到 EVENT_KEYS');
    assert.ok(!EVENT_KEYS.includes('timeoutWarning60s'),
      'timeoutWarning60s 已删除（24h 无超时后无意义），不应回滚到 EVENT_KEYS');
  });

  it('DEFAULT_BINDINGS 与 EVENT_KEYS 一一对应（防 schema 漂移）', () => {
    const bindingKeys = Object.keys(DEFAULT_BINDINGS).sort();
    const eventKeys = [...EVENT_KEYS].sort();
    assert.deepEqual(bindingKeys, eventKeys,
      'DEFAULT_BINDINGS 的 keys 必须与 EVENT_KEYS 严格一致（任一处漏改都会让用户绑定/默认值不一致）');
  });

  it('DEFAULT_BINDINGS 值合法（在 BUNDLED_PACK_IDS 内或 null）', () => {
    for (const [key, val] of Object.entries(DEFAULT_BINDINGS)) {
      assert.ok(
        val === null || BUNDLED_PACK_IDS.includes(val),
        `DEFAULT_BINDINGS.${key} = ${JSON.stringify(val)} 非法（必须 null 或 BUNDLED_PACK_IDS 之一）`,
      );
    }
  });
});

describe('BUNDLED_PACK_IDS', () => {
  it('当前锁定为 default + sanguo 两项', () => {
    assert.deepEqual([...BUNDLED_PACK_IDS].sort(), ['default', 'sanguo']);
  });

  it('已冻结防意外可变（防 push("evil") 这种 supply-chain 注入）', () => {
    assert.ok(Object.isFrozen(BUNDLED_PACK_IDS), 'BUNDLED_PACK_IDS 必须 Object.freeze');
  });
});

describe('getDefaultBindingsForLocale', () => {
  // Contract: function accepts CANONICAL locale codes as emitted by getLang()
  // (post-LANG_MAP normalisation) — i.e. one of LANG_OPTIONS values (zh, zh-TW,
  // en, ja, ...). Raw navigator.language strings like zh-Hans / zh-HK are
  // folded to canonical forms upstream in i18n.js. This function does NOT
  // re-implement that fold (architect P1: declarative table, no control flow).
  it('canonical zh / zh-TW → sanguo seed', () => {
    for (const locale of ['zh', 'zh-TW']) {
      const b = getDefaultBindingsForLocale(locale);
      assert.equal(b.planApproval, 'sanguo', `${locale} planApproval should be sanguo`);
      assert.equal(b.askQuestion, 'sanguo', `${locale} askQuestion should be sanguo`);
      assert.equal(b.turnEnd, null, `${locale} turnEnd stays null`);
    }
  });

  it('lowercase tolerance for canonical zh-tw (getLang() emits mixed case)', () => {
    // getLang() returns 'zh-TW' but function lowercases internally — verify.
    const b = getDefaultBindingsForLocale('zh-tw');
    assert.equal(b.planApproval, 'sanguo');
  });

  it('非中文 canonical locale → DEFAULT_BINDINGS (butler)', () => {
    for (const locale of ['en', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR', 'ru', 'ar']) {
      const b = getDefaultBindingsForLocale(locale);
      assert.equal(b.planApproval, 'default', `${locale} planApproval should be default`);
      assert.equal(b.askQuestion, 'default', `${locale} askQuestion should be default`);
      assert.equal(b.turnEnd, null);
    }
  });

  it('garbage / nullish input → DEFAULT_BINDINGS (no crash)', () => {
    for (const locale of [undefined, null, '', 123, {}, '../etc/passwd']) {
      const b = getDefaultBindingsForLocale(locale);
      assert.equal(b.planApproval, 'default');
    }
  });

  it('所有返回值都在 BUNDLED_PACK_IDS 或 null 之内（与 server 路由对齐）', () => {
    for (const locale of ['zh', 'zh-TW', 'en', 'ja', 'fr']) {
      const b = getDefaultBindingsForLocale(locale);
      for (const val of Object.values(b)) {
        assert.ok(
          val === null || BUNDLED_PACK_IDS.includes(val),
          `seed value ${JSON.stringify(val)} for ${locale} not in BUNDLED_PACK_IDS`,
        );
      }
    }
  });
});
