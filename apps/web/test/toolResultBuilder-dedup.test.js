/**
 * Read tool_result intern pool 单元测试。
 * 直接测试纯函数 internReadResult，避免 toolResultBuilder.js 传递依赖
 * （./helpers / ../i18n）的 ESM 后缀缺失污染。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  internReadResult,
  internToolResult,
  _resetReadPoolForTest,
  _getReadPoolSizeForTest,
  _getReadPoolEvictionsForTest,
} from '../src/utils/readResultPool.js';

describe('internReadResult', () => {
  it('should share reference for identical long strings', () => {
    _resetReadPoolForTest();
    const a = 'X'.repeat(2000);
    const b = 'X'.repeat(2000); // 内容相同但是不同字符串实例
    const i1 = internReadResult(a);
    const i2 = internReadResult(b);
    assert.equal(i1, i2, 'identical content should share reference after intern');
    // 因为 a 先注册到 pool，i2 应该 === a（pool ref）
    assert.equal(i2, a, 'second call returns the pool ref, which is a');
  });

  it('should NOT dedup short strings (< 256 chars)', () => {
    _resetReadPoolForTest();
    const s1 = 'short';
    const s2 = 'short'; // 同内容
    const i1 = internReadResult(s1);
    const i2 = internReadResult(s2);
    // 短字符串直接返回原值，不触碰 pool
    assert.equal(i1, s1);
    assert.equal(i2, s2);
    assert.equal(_getReadPoolSizeForTest(), 0, 'short strings must not enter pool');
  });

  it('should distinguish strings with different content', () => {
    _resetReadPoolForTest();
    const a = 'A'.repeat(2000);
    const b = 'B'.repeat(2000);
    internReadResult(a);
    internReadResult(b);
    assert.equal(_getReadPoolSizeForTest(), 2, 'distinct content → 2 pool entries');
  });

  it('should distinguish strings with same length but different prefix or suffix', () => {
    _resetReadPoolForTest();
    const len = 1000;
    const a = 'A'.repeat(len);                       // all A
    const b = 'B' + 'A'.repeat(len - 1);              // 不同前缀
    const c = 'A'.repeat(len - 1) + 'B';              // 不同后缀
    internReadResult(a);
    internReadResult(b);
    internReadResult(c);
    assert.equal(_getReadPoolSizeForTest(), 3, 'prefix/suffix differences must produce distinct hash');
  });

  it('should pass through non-string inputs unchanged', () => {
    _resetReadPoolForTest();
    assert.equal(internReadResult(null), null);
    assert.equal(internReadResult(undefined), undefined);
    assert.equal(internReadResult(123), 123);
    assert.equal(_getReadPoolSizeForTest(), 0);
  });

  it('should respect FIFO eviction at MAX_READ_POOL_SIZE', () => {
    _resetReadPoolForTest();
    // 注入 1001 种不同内容，验证 pool 不会无限增长
    for (let i = 0; i < 1001; i++) {
      // 用唯一前缀确保 hash 不同
      internReadResult(`prefix-${i}-` + 'X'.repeat(2000));
    }
    assert.ok(_getReadPoolSizeForTest() <= 1000, `pool size must be capped at 1000`);
  });

  it('boundary: exactly _MIN_DEDUP_LEN (256) should be deduped', () => {
    _resetReadPoolForTest();
    const exact = 'X'.repeat(256);
    const r1 = internReadResult(exact);
    const r2 = internReadResult('X'.repeat(256)); // same content, different instance
    // 长度 = 256 走 dedup 分支
    assert.equal(r1, r2);
    assert.equal(_getReadPoolSizeForTest(), 1);
  });

  it('boundary: 255 chars should not be deduped', () => {
    _resetReadPoolForTest();
    const justBelow = 'X'.repeat(255);
    internReadResult(justBelow);
    internReadResult('X'.repeat(255));
    assert.equal(_getReadPoolSizeForTest(), 0, '< 256 must skip pool');
  });
});

describe('sig hardening (mid-slice)', () => {
  it('should distinguish strings that share length + first 64 + last 64 but differ in the middle', () => {
    _resetReadPoolForTest();
    const head = 'H'.repeat(64);
    const tail = 'T'.repeat(64);
    const len = 1000;
    const midLen = len - head.length - tail.length;
    // 两个串：head + mid_A + tail vs head + mid_B + tail，等长、同前缀、同后缀，仅中段不同。
    // 老 sig（length + first 64 + last 64）会碰撞；新 sig（加 mid-64）应区分开。
    const a = head + 'A'.repeat(midLen) + tail;
    const b = head + 'B'.repeat(midLen) + tail;
    internReadResult(a);
    internReadResult(b);
    assert.equal(_getReadPoolSizeForTest(), 2, 'mid-slice must distinguish length+head+tail collisions');
  });

  it('should still dedup identical content (mid-slice is additive, not replacing)', () => {
    _resetReadPoolForTest();
    const s = 'X'.repeat(2000);
    const r1 = internReadResult(s);
    const r2 = internReadResult('X'.repeat(2000));
    assert.equal(r1, r2);
    assert.equal(_getReadPoolSizeForTest(), 1, 'identical content stays single pool entry');
  });

  it('strings <= 512 chars use original 2-segment sig (no mid-slice)', () => {
    _resetReadPoolForTest();
    // 边界以下不走 mid-slice 分支，行为应与历史一致
    const s1 = 'X'.repeat(400);
    const s2 = 'X'.repeat(400);
    const r1 = internReadResult(s1);
    const r2 = internReadResult(s2);
    assert.equal(r1, r2);
    assert.equal(_getReadPoolSizeForTest(), 1);
  });
});

describe('eviction counter', () => {
  it('starts at 0 after reset and increments on FIFO eviction', () => {
    _resetReadPoolForTest();
    assert.equal(_getReadPoolEvictionsForTest(), 0, 'reset clears counter');
    // 灌满 pool（1000 条）+ 1 条触发首次淘汰
    for (let i = 0; i < 1000; i++) {
      internReadResult(`prefix-${i}-` + 'X'.repeat(2000));
    }
    assert.equal(_getReadPoolEvictionsForTest(), 0, 'first 1000 entries should not evict');
    internReadResult(`prefix-trigger-` + 'X'.repeat(2000));
    assert.equal(_getReadPoolEvictionsForTest(), 1, 'one over cap → one eviction');
  });
});

describe('internToolResult (generic)', () => {
  it('shares pool with internReadResult (same content → same ref)', () => {
    _resetReadPoolForTest();
    const s = 'X'.repeat(2000);
    const r1 = internReadResult(s);
    const r2 = internToolResult(s);
    assert.equal(r1, r2, 'cross-API content sharing');
    assert.equal(_getReadPoolSizeForTest(), 1, 'shared pool, single entry');
  });

  it('dedups Bash-like output across many entries', () => {
    _resetReadPoolForTest();
    const diff = 'diff --git a/x b/x\n' + 'L'.repeat(2000);
    const refs = [];
    for (let i = 0; i < 50; i++) refs.push(internToolResult(diff));
    assert.equal(_getReadPoolSizeForTest(), 1, '50 calls → 1 pool entry');
    for (let i = 1; i < 50; i++) {
      assert.equal(refs[i], refs[0], `call ${i} shares ref with first`);
    }
  });

  it('passes through short results unchanged', () => {
    _resetReadPoolForTest();
    const r = internToolResult('short bash output');
    assert.equal(r, 'short bash output');
    assert.equal(_getReadPoolSizeForTest(), 0, 'short input must skip pool');
  });

  it('passes through non-string inputs unchanged', () => {
    _resetReadPoolForTest();
    assert.equal(internToolResult(null), null);
    assert.equal(internToolResult(undefined), undefined);
    assert.equal(internToolResult(42), 42);
    assert.equal(_getReadPoolSizeForTest(), 0);
  });
});
