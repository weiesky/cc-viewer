// 分支覆盖补强：server/lib/voice-pack-manager.js
// 目标 — 把 detectAudioFormat 的 ogg/m4a 臂、saveAudio 的非 Buffer / 空文件名臂、
// list/get/delete 在目录缺失 + FS 失败时的 catch/return 臂、reconcile 无 events 臂等
// 单跑口径未覆盖的分支补齐。仅新增本文件,不改源码/不改既有测试。
import './_shims/register.mjs';
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, rmSync, writeFileSync, existsSync, chmodSync, readFileSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 动态加载目标(顶层 await),避免纯 Node import 期对 src/utils Vite 风格的踩坑;
// 本模块本身无 Vite import,但遵循子代理统一约定。
const VPM = await import('../server/lib/voice-pack-manager.js');
const {
  detectAudioFormat,
  saveAudio,
  listUserAudio,
  getUserAudioPath,
  deleteUserAudio,
  reconcileVoicePackPrefs,
  isValidId,
} = VPM;

function mkTmp() {
  const dir = join(tmpdir(), `ccv-branch-vpm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// 最小合法 WAV(detectAudioFormat 只读前 12 字节)。
function tinyWav(extra = 32) {
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(4 + extra, 4);
  head.write('WAVE', 8);
  return Buffer.concat([head, Buffer.alloc(extra)]);
}

// 'OggS' 魔术字节 — 覆盖 L54-55 ogg 臂。
function tinyOgg() {
  const head = Buffer.from([0x4F, 0x67, 0x67, 0x53]); // OggS
  return Buffer.concat([head, Buffer.alloc(64)]);
}

// 'ftyp' 在偏移 4 — 覆盖 L56-57 m4a 臂。byte0-3 任意但不能匹配前面的 mp3/wav/ogg。
function tinyM4a() {
  const head = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // ....ftyp
  return Buffer.concat([head, Buffer.alloc(64)]);
}

describe('detectAudioFormat — ogg/m4a 魔术字节臂', () => {
  it('识别 OggS 头为 ogg', () => {
    assert.equal(detectAudioFormat(tinyOgg()), 'ogg');
  });
  it('识别偏移 4 处 ftyp 为 m4a', () => {
    assert.equal(detectAudioFormat(tinyM4a()), 'm4a');
  });
  it('null / undefined buffer 返回 null', () => {
    assert.equal(detectAudioFormat(null), null);
    assert.equal(detectAudioFormat(undefined), null);
  });
});

describe('saveAudio — 防御性输入臂', () => {
  let logDir;
  beforeEach(() => { logDir = mkTmp(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('非 Buffer 入参抛 "must be a Buffer" (L90-92)', () => {
    assert.throws(
      () => saveAudio(logDir, 'x.wav', 'not a buffer', { isLoopback: true }),
      /must be a Buffer/i,
    );
    assert.throws(
      () => saveAudio(logDir, 'x.wav', null, { isLoopback: true }),
      /must be a Buffer/i,
    );
    assert.throws(
      () => saveAudio(logDir, 'x.wav', new Uint8Array([1, 2, 3]), { isLoopback: true }),
      /must be a Buffer/i,
    );
  });

  it('filename 为 falsy 时 sidecar originalName 走 "" 兜底 (L115 || \'\')', () => {
    const r = saveAudio(logDir, null, tinyWav(), { isLoopback: true });
    const sidecar = JSON.parse(readFileSync(join(logDir, 'voice-packs', `${r.id}.json`), 'utf-8'));
    assert.equal(sidecar.originalName, '');
    // undefined filename 同路径
    const r2 = saveAudio(logDir, undefined, tinyWav(), { isLoopback: true });
    const sidecar2 = JSON.parse(readFileSync(join(logDir, 'voice-packs', `${r2.id}.json`), 'utf-8'));
    assert.equal(sidecar2.originalName, '');
  });

  it('默认参数(不传 opts)走 loopbackOnly=true/isLoopback=true 默认值', () => {
    // 不传第四参 → 解构默认值生效,应成功保存(覆盖默认值分支)。
    const r = saveAudio(logDir, 'def.wav', tinyWav());
    assert.equal(r.format, 'wav');
    assert.ok(existsSync(r.path));
  });

  it('保存 ogg / m4a 各自落盘且扩展名正确', () => {
    const ogg = saveAudio(logDir, 'a.ogg', tinyOgg(), { isLoopback: true });
    assert.equal(ogg.format, 'ogg');
    assert.equal(ogg.ext, '.ogg');
    const m4a = saveAudio(logDir, 'b.m4a', tinyM4a(), { isLoopback: true });
    assert.equal(m4a.format, 'm4a');
    assert.equal(m4a.ext, '.m4a');
  });
});

describe('listUserAudio — 目录缺失 / 排序臂', () => {
  let logDir;
  beforeEach(() => { logDir = mkTmp(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('voice-packs 目录不存在返回 [] (L123)', () => {
    // 全新 logDir,尚未创建 voice-packs 子目录。
    assert.deepEqual(listUserAudio(logDir), []);
  });

  it('多文件按 mtime 倒序 — 触发排序比较器 (L142)', async () => {
    const first = saveAudio(logDir, 'first.wav', tinyWav(), { isLoopback: true });
    // 让两个文件 mtime 拉开差距,确保比较器走有意义的分支。
    const dir = join(logDir, 'voice-packs');
    const path1 = join(dir, `${first.id}.wav`);
    const oldTime = new Date(Date.now() - 60_000);
    // 用 utimes 把第一个文件改旧
    const { utimesSync } = await import('node:fs');
    utimesSync(path1, oldTime, oldTime);
    const second = saveAudio(logDir, 'second.wav', tinyWav(), { isLoopback: true });
    const list = listUserAudio(logDir);
    assert.equal(list.length, 2);
    // 最新的(second)排在前
    assert.equal(list[0].id, second.id);
    assert.equal(list[1].id, first.id);
  });

  it('sidecar 解析失败时 originalName 回退到 <id><ext> (L137-139 catch)', () => {
    const r = saveAudio(logDir, 'has-sidecar.wav', tinyWav(), { isLoopback: true });
    // 破坏 sidecar JSON,使 JSON.parse 抛错走 catch。
    const sidecar = join(logDir, 'voice-packs', `${r.id}.json`);
    writeFileSync(sidecar, '{ this is : not valid json ]');
    const list = listUserAudio(logDir);
    const entry = list.find(e => e.id === r.id);
    assert.ok(entry);
    assert.equal(entry.originalName, `${r.id}.wav`, 'sidecar 坏掉应回退到 <id><ext>');
  });

  it('sidecar 存在但缺 originalName 字段也回退 (L138 ?. 假臂)', () => {
    const r = saveAudio(logDir, 'no-name.wav', tinyWav(), { isLoopback: true });
    const sidecar = join(logDir, 'voice-packs', `${r.id}.json`);
    writeFileSync(sidecar, JSON.stringify({ id: r.id, ext: '.wav' })); // 无 originalName
    const list = listUserAudio(logDir);
    const entry = list.find(e => e.id === r.id);
    assert.equal(entry.originalName, `${r.id}.wav`);
  });
});

describe('getUserAudioPath — 目录缺失臂', () => {
  let logDir;
  beforeEach(() => { logDir = mkTmp(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('合法 id 但 voice-packs 目录不存在返回 null (L147-148)', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
    assert.equal(isValidId(id), true);
    assert.equal(getUserAudioPath(logDir, id), null);
  });

  it('合法 id 但目录存在却无对应文件返回 null (循环走完未命中)', () => {
    saveAudio(logDir, 'other.wav', tinyWav(), { isLoopback: true });
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
    assert.equal(getUserAudioPath(logDir, id), null);
  });
});

describe('deleteUserAudio — 目录缺失 / unlink 失败臂', () => {
  let logDir;
  beforeEach(() => { logDir = mkTmp(); });
  afterEach(() => {
    // 还原可能被 chmod 的目录权限,确保清理成功。
    try { chmodSync(join(logDir, 'voice-packs'), 0o755); } catch {}
    try { rmSync(logDir, { recursive: true, force: true }); } catch {}
  });

  it('voice-packs 目录不存在返回 false (L164)', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
    assert.equal(deleteUserAudio(logDir, id), false);
  });

  it('文件存在但 unlink 抛错时走 catch,removed 保持 false (L168 / L171)', function () {
    if (process.platform === 'win32') return; // chmod 在 win 不可靠
    if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root 无视权限
    const r = saveAudio(logDir, 'locked.wav', tinyWav(), { isLoopback: true });
    const dir = join(logDir, 'voice-packs');
    // 目录置只读 → unlinkSync 抛 EACCES,被 catch 吞掉。
    chmodSync(dir, 0o555);
    const result = deleteUserAudio(logDir, r.id);
    // 文件仍在(删不掉),removed=false。
    chmodSync(dir, 0o755);
    assert.equal(result, false, 'unlink 失败应返回 false');
    assert.equal(existsSync(r.path), true, '文件应仍然存在');
  });
});

describe('reconcileVoicePackPrefs — 无 events / 非对象臂', () => {
  let logDir;
  beforeEach(() => { logDir = mkTmp(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('vp.events 缺失时用 {} 兜底 (L324 : {})', () => {
    const r = reconcileVoicePackPrefs(logDir, { enabled: true });
    assert.ok(r && typeof r === 'object');
    assert.ok(r.events && typeof r.events === 'object');
    // 每个 EVENT_KEY 在空 events 上读到 undefined → 走 val==null continue,不报错。
    assert.equal(Object.keys(r.events).length, 0);
  });

  it('vp.events 为非对象(数组/字符串)时也用 {} 兜底', () => {
    const r1 = reconcileVoicePackPrefs(logDir, { events: 'nope' });
    assert.deepEqual(r1.events, {});
    const r2 = reconcileVoicePackPrefs(logDir, { events: null });
    assert.deepEqual(r2.events, {});
  });

  it('非对象 vp 原样返回 (字符串 / 数字 / false)', () => {
    assert.equal(reconcileVoicePackPrefs(logDir, 'x'), 'x');
    assert.equal(reconcileVoicePackPrefs(logDir, 42), 42);
    assert.equal(reconcileVoicePackPrefs(logDir, false), false);
  });

  it('events 含非字符串值(数字/对象)被重置为 null', () => {
    const vp = { events: { askQuestion: 12345, planApproval: { nested: true }, turnEnd: true } };
    const r = reconcileVoicePackPrefs(logDir, vp);
    assert.equal(r.events.askQuestion, null);
    assert.equal(r.events.planApproval, null);
    assert.equal(r.events.turnEnd, null);
  });
});
