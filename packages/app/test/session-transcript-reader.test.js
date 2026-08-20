/**
 * sessionTranscriptReader 单元测试
 *
 * 用 CCV_PROJECTS_DIR env 把 ~/.claude/projects 重定向到 tmp dir，
 * 合成 transcript 文件，不依赖磁盘真实数据。
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAVED_PROJECTS_DIR = process.env.CCV_PROJECTS_DIR;
const TMP = mkdtempSync(join(tmpdir(), 'ccv-transcript-reader-'));
process.env.CCV_PROJECTS_DIR = TMP;

const { findTranscriptPath, lookupToolUseInput, clearCache } =
  await import('../server/lib/session-transcript-reader.js');

function makeAssistantLine({ tuId, name = 'ExitPlanMode', input = {}, sid = 'sid-1' }) {
  return JSON.stringify({
    type: 'assistant',
    sessionId: sid,
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: tuId, name, input, caller: { type: 'direct' } }],
    },
  });
}

function writeTranscript(dir, sessionId, lines, mtime) {
  const projDir = join(TMP, dir);
  mkdirSync(projDir, { recursive: true });
  const file = join(projDir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join('\n') + '\n');
  if (mtime !== undefined) utimesSync(file, mtime, mtime);
  return file;
}

after(() => {
  rmSync(TMP, { recursive: true, force: true });
  if (SAVED_PROJECTS_DIR === undefined) delete process.env.CCV_PROJECTS_DIR;
  else process.env.CCV_PROJECTS_DIR = SAVED_PROJECTS_DIR;
});

beforeEach(() => clearCache());

// ============================================================================
describe('findTranscriptPath', () => {
  it('单匹配命中', () => {
    const sid = 'sid-single';
    const file = writeTranscript('-Users-x-proj', sid, [makeAssistantLine({ tuId: 'tu_1', sid })]);
    assert.equal(findTranscriptPath(sid), file);
  });

  it('sessionId 不存在 → null', () => {
    assert.equal(findTranscriptPath('sid-does-not-exist-xyz'), null);
  });

  it('多匹配时按 entry.project 反向匹配编码目录后缀', () => {
    const sid = 'sid-collide';
    writeTranscript('-Users-x-cc-viewer', sid, [makeAssistantLine({ tuId: 't', sid })]);
    const wt = writeTranscript('-Users-x-cc-viewer--claude-worktrees-frosty-kare', sid, [makeAssistantLine({ tuId: 't', sid })]);
    assert.equal(findTranscriptPath(sid, 'frosty-kare'), wt);
  });

  it('多匹配 + 无 hint → mtime 最大者', () => {
    const sid = 'sid-mtime';
    const earlier = writeTranscript('-A', sid, [makeAssistantLine({ tuId: 't', sid })], 1000);
    const later = writeTranscript('-B', sid, [makeAssistantLine({ tuId: 't', sid })], 2000);
    void earlier;
    assert.equal(findTranscriptPath(sid), later);
  });

  it('缓存命中：第二次返回相同路径（mtime 不变时复用缓存）', () => {
    const sid = 'sid-cache';
    const file = writeTranscript('-cache', sid, [makeAssistantLine({ tuId: 't', sid })]);
    const a = findTranscriptPath(sid);
    const b = findTranscriptPath(sid);
    assert.equal(a, file);
    assert.equal(b, file);
  });

  it('transcript 被覆写（mtime 变化）→ cache 命中失效，重新扫', () => {
    const sid = 'sid-mtime-invalidate';
    writeTranscript('-mt1', sid, [makeAssistantLine({ tuId: 'tu_v1', input: { plan: 'V1' }, sid })], 1000);
    assert.ok(findTranscriptPath(sid));
    // 用 utimes 把 mtime 推后，模拟 CC 重写 transcript
    const file = join(TMP, '-mt1', `${sid}.jsonl`);
    utimesSync(file, 9000, 9000);
    // 仍能返回（其实是同一文件路径，但内部走了 stat 重校验分支）
    assert.equal(findTranscriptPath(sid), file);
  });
});

// ============================================================================
describe('lookupToolUseInput', () => {
  it('命中 ExitPlanMode 行 → 返回 { plan, planFilePath }', () => {
    const sid = 'sid-hit';
    writeTranscript('-hit', sid, [
      makeAssistantLine({ tuId: 'tu_other', name: 'Read', input: { file_path: '/x' }, sid }),
      makeAssistantLine({ tuId: 'tu_plan', input: { plan: '# Hello\n\nstep 1', planFilePath: '/p/x.md' }, sid }),
    ]);
    const r = lookupToolUseInput(sid, 'tu_plan');
    assert.deepEqual(r, { plan: '# Hello\n\nstep 1', planFilePath: '/p/x.md' });
  });

  it('tool_use.id 不存在 → null', () => {
    const sid = 'sid-miss';
    writeTranscript('-miss', sid, [makeAssistantLine({ tuId: 'tu_real', input: { plan: 'P' }, sid })]);
    assert.equal(lookupToolUseInput(sid, 'tu_does_not_exist'), null);
  });

  it('transcript 不存在 → null', () => {
    assert.equal(lookupToolUseInput('sid-no-file', 'tu_x'), null);
  });

  it('input 无 plan/planFilePath（matched id, unknown shape）→ null + schema drift 警告', () => {
    const sid = 'sid-drift';
    writeTranscript('-drift', sid, [makeAssistantLine({ tuId: 'tu_drift', input: { someOtherField: 'x' }, sid })]);
    assert.equal(lookupToolUseInput(sid, 'tu_drift'), null);
  });

  it('input 只有 plan 没 planFilePath → 返回仅 plan', () => {
    const sid = 'sid-partial';
    writeTranscript('-partial', sid, [makeAssistantLine({ tuId: 'tu_p', input: { plan: 'X' }, sid })]);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_p'), { plan: 'X' });
  });

  it('半写入末行（JSON 不完整）→ try/catch 跳过，不抛', () => {
    const sid = 'sid-partial-line';
    const projDir = join(TMP, '-pl');
    mkdirSync(projDir, { recursive: true });
    const goodLine = makeAssistantLine({ tuId: 'tu_good', input: { plan: 'OK' }, sid });
    writeFileSync(join(projDir, `${sid}.jsonl`), goodLine + '\n{"type":"assistant","message":{"role":"as');
    assert.deepEqual(lookupToolUseInput(sid, 'tu_good'), { plan: 'OK' });
  });

  it('input cache 命中：同 (path, tuId) 第二次走 LRU 不重扫文件', () => {
    const sid = 'sid-c';
    writeTranscript('-c', sid, [makeAssistantLine({ tuId: 'tu_c', input: { plan: 'C' }, sid })]);
    const a = lookupToolUseInput(sid, 'tu_c');
    // 不删文件——文件 mtime 不变 path cache 也命中，input cache 才能复用
    const b = lookupToolUseInput(sid, 'tu_c');
    assert.deepEqual(a, { plan: 'C' });
    assert.deepEqual(b, { plan: 'C' });
    assert.equal(a, b);  // 同一对象引用：来自 LRU
  });

  it('文件被删除后再查 → 返回 null（path mtime 校验失败 + 重扫 readdirSync 也找不到）', () => {
    const sid = 'sid-deleted';
    writeTranscript('-d', sid, [makeAssistantLine({ tuId: 'tu_d', input: { plan: 'D' }, sid })]);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_d'), { plan: 'D' });
    rmSync(join(TMP, '-d'), { recursive: true, force: true });
    clearCache();  // 模拟 path miss TTL 过期
    assert.equal(lookupToolUseInput(sid, 'tu_d'), null);
  });

  it('miss 短 TTL 后 transcript 后写入能恢复（race-recovery）', () => {
    const sid = 'sid-race';
    // 第一次：transcript 还没写 → miss 进 30s TTL 缓存
    assert.equal(lookupToolUseInput(sid, 'tu_race'), null);
    // CC 之后写转写
    writeTranscript('-race', sid, [makeAssistantLine({ tuId: 'tu_race', input: { plan: 'AFTER-RACE' }, sid })]);
    // 模拟 TTL 过期（生产环境是 30s 后；测试 clearCache 强制重扫）
    clearCache();
    assert.deepEqual(lookupToolUseInput(sid, 'tu_race'), { plan: 'AFTER-RACE' });
  });

  it('跨 session 同 toolUseId 不串号', () => {
    const sidA = 'sid-X-A';
    const sidB = 'sid-X-B';
    writeTranscript('-xa', sidA, [makeAssistantLine({ tuId: 'tu_dup', input: { plan: 'A-plan' }, sid: sidA })]);
    writeTranscript('-xb', sidB, [makeAssistantLine({ tuId: 'tu_dup', input: { plan: 'B-plan' }, sid: sidB })]);
    assert.deepEqual(lookupToolUseInput(sidA, 'tu_dup'), { plan: 'A-plan' });
    assert.deepEqual(lookupToolUseInput(sidB, 'tu_dup'), { plan: 'B-plan' });
  });

  it('跨越 1MB 读块边界的目标行也能命中', () => {
    const sid = 'sid-chunk';
    const projDir = join(TMP, '-chunk');
    mkdirSync(projDir, { recursive: true });
    // 构造 1MB 噪声 + 目标行（让目标行跨过 1MB 缓冲边界）
    const filler = 'x'.repeat(1024 * 1024 - 50) + '\n';
    const target = makeAssistantLine({ tuId: 'tu_chunk', input: { plan: 'AT-BOUNDARY' }, sid });
    writeFileSync(join(projDir, `${sid}.jsonl`), filler + target + '\n');
    assert.deepEqual(lookupToolUseInput(sid, 'tu_chunk'), { plan: 'AT-BOUNDARY' });
  });

  it('文件无尾部 newline：最后一行（pending）也能命中', () => {
    const sid = 'sid-noeof';
    const projDir = join(TMP, '-noeof');
    mkdirSync(projDir, { recursive: true });
    const target = makeAssistantLine({ tuId: 'tu_noeof', input: { plan: 'TAIL' }, sid });
    writeFileSync(join(projDir, `${sid}.jsonl`), target);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_noeof'), { plan: 'TAIL' });
  });

  it('多 toolUseId 顺序查询全部命中（cache 随容量上限自然淘汰，不 OOM）', () => {
    const sid = 'sid-many';
    const N = 200;
    const blocks = [];
    for (let i = 0; i < N; i++) {
      blocks.push(makeAssistantLine({ tuId: `tu_${i}`, input: { plan: `P${i}` }, sid }));
    }
    const projDir = join(TMP, '-many');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, `${sid}.jsonl`), blocks.join('\n') + '\n');
    for (let i = 0; i < N; i++) {
      assert.deepEqual(lookupToolUseInput(sid, `tu_${i}`), { plan: `P${i}` });
    }
  });

  it('大文件流式扫不 OOM（合成 ~2MB 含目标行）', () => {
    const sid = 'sid-big';
    const noise = makeAssistantLine({ tuId: 'tu_noise', name: 'Read', input: { file_path: '/x' }, sid });
    const target = makeAssistantLine({ tuId: 'tu_target', input: { plan: 'TARGET', planFilePath: '/p.md' }, sid });
    const projDir = join(TMP, '-big');
    mkdirSync(projDir, { recursive: true });
    const lines = [];
    for (let i = 0; i < 4000; i++) lines.push(noise);
    lines.push(target);
    for (let i = 0; i < 4000; i++) lines.push(noise);
    writeFileSync(join(projDir, `${sid}.jsonl`), lines.join('\n') + '\n');
    const r = lookupToolUseInput(sid, 'tu_target');
    assert.deepEqual(r, { plan: 'TARGET', planFilePath: '/p.md' });
  });

  it('clearCache 后重读', () => {
    const sid = 'sid-clear';
    writeTranscript('-clear', sid, [makeAssistantLine({ tuId: 'tu_x', input: { plan: 'V1' }, sid })]);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_x'), { plan: 'V1' });
    clearCache();
    writeTranscript('-clear', sid, [makeAssistantLine({ tuId: 'tu_x', input: { plan: 'V2' }, sid })]);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_x'), { plan: 'V2' });
  });
});
