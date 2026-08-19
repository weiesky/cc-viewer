// 分支覆盖补强:server/lib/im-senders.js
// 目标分支:readSenders 的非对象/数组降级、upsertSender 的 profile 默认值与 name/avatar 三元 :null 臂、
// 以及 MAX_SENDERS 淘汰排序里 (map[a].ts || 0) 的 || 0 兜底。
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// 私有 CCV_LOG_DIR,避免与并发的其它测试文件抢共享日志目录。必须在 import 目标模块前设好。
const PRIV = join(os.tmpdir(), `ccv-branch-imsenders-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
mkdirSync(PRIV, { recursive: true });
process.env.CCV_LOG_DIR = PRIV;

let mod, imLock;
before(async () => {
  imLock = await import('../packages/app/server/lib/im-lock.js');
  mod = await import('../packages/app/server/lib/im-senders.js');
});

let n = 0;
function freshId() { return `branch_senders_${process.pid}_${n++}`; }
function dirOf(id) { return imLock.imDir(id); }
function wipe(id) { try { rmSync(dirOf(id), { recursive: true, force: true }); } catch { /* noop */ } }
function writeRaw(id, text) {
  const d = dirOf(id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'im-senders.json'), text);
}

describe('im-senders 分支补强', () => {
  it('readSenders:JSON 是数组 → 降级为 {}(!Array.isArray 假臂)', () => {
    const id = freshId(); wipe(id);
    writeRaw(id, '[1,2,3]');
    assert.deepEqual(mod.readSenders(id), {});
    wipe(id);
  });

  it('readSenders:JSON 是数字 → 降级为 {}(typeof object 假臂)', () => {
    const id = freshId(); wipe(id);
    writeRaw(id, '42');
    assert.deepEqual(mod.readSenders(id), {});
    wipe(id);
  });

  it('readSenders:JSON 是字符串 → 降级为 {}', () => {
    const id = freshId(); wipe(id);
    writeRaw(id, '"hello"');
    assert.deepEqual(mod.readSenders(id), {});
    wipe(id);
  });

  it('readSenders:JSON 是 null → 降级为 {}(o 真值假臂)', () => {
    const id = freshId(); wipe(id);
    writeRaw(id, 'null');
    assert.deepEqual(mod.readSenders(id), {});
    wipe(id);
  });

  it('upsertSender:完全不传 profile → 走默认 {}(profile = {} 默认参数),name/avatar 均落 null', () => {
    const id = freshId(); wipe(id);
    assert.equal(mod.upsertSender(id, 'u1'), true);
    const map = mod.readSenders(id);
    assert.equal(map.u1.name, null, 'name 三元 :null 臂');
    assert.equal(map.u1.avatar, null, 'avatar 三元 :null 臂');
    wipe(id);
  });

  it('upsertSender:profile.name 显式为 null/undefined → name 落 null(:null 臂),avatar 有值', () => {
    const id = freshId(); wipe(id);
    assert.equal(mod.upsertSender(id, 'u2', { name: null, avatar: 'https://a/x.png' }), true);
    const map = mod.readSenders(id);
    assert.equal(map.u2.name, null);
    assert.equal(map.u2.avatar, 'https://a/x.png');
    wipe(id);
  });

  it('upsertSender:name/avatar 非字符串(数字)→ String() 真臂,转成字符串', () => {
    const id = freshId(); wipe(id);
    assert.equal(mod.upsertSender(id, 'u3', { name: 123, avatar: 456 }), true);
    const map = mod.readSenders(id);
    assert.equal(map.u3.name, '123');
    assert.equal(map.u3.avatar, '456');
    wipe(id);
  });

  it('MAX_SENDERS 淘汰:已有条目 ts 缺失 → 排序用 (ts || 0) 兜底,最旧被淘汰', () => {
    const id = freshId(); wipe(id);
    // 预置一张已满 + 1 的映射,其中部分条目没有 ts 字段(模拟历史/外部写入),
    // 触发 keys.sort 里 (map[a].ts || 0) 的 || 0 兜底分支。
    const map = {};
    for (let i = 0; i < mod.MAX_SENDERS; i++) {
      // 一半带 ts,一半不带,确保 || 0 兜底臂被走到。
      map[`old${i}`] = i % 2 === 0 ? { name: `n${i}`, avatar: null, ts: 1000 + i } : { name: `n${i}`, avatar: null };
    }
    writeRaw(id, JSON.stringify(map));
    // 再 upsert 一个新的 → 总数 MAX+1 → 触发淘汰逻辑。
    assert.equal(mod.upsertSender(id, 'fresh', { name: 'F' }), true);
    const out = mod.readSenders(id);
    assert.equal(Object.keys(out).length, mod.MAX_SENDERS);
    assert.equal('fresh' in out, true, '新条目应保留');
    // 没有 ts 的旧条目(ts→0,最旧)应被优先淘汰。
    assert.equal('old1' in out, false, 'ts 缺失的最旧条目应被淘汰');
    wipe(id);
  });

  it('upsertSender:prev 存在且 name/avatar 都未变 → 跳过写盘返回 false(prev 真臂全等)', () => {
    const id = freshId(); wipe(id);
    assert.equal(mod.upsertSender(id, 'u9', { name: 'Z', avatar: 'a' }), true);
    assert.equal(mod.upsertSender(id, 'u9', { name: 'Z', avatar: 'a' }), false);
    wipe(id);
  });
});
