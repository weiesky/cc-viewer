/**
 * session-transcript-reader 分支补全测试
 *
 * 目标:把 branch 覆盖率从 ~75% 提到 >=95%。聚焦以下未覆盖分支:
 *  - 43-45 lruSet 容量上限淘汰(>PATH_CACHE_MAX)
 *  - 74-75 miss 缓存 TTL 内继续返回 null
 *  - 90-92 readdirSync 抛错(projectsDir 不存在)→ miss TTL 缓存
 *  - 170-174 transcript 超过 MAX_TRANSCRIPT_BYTES → 跳过
 *  - 197    pending 末行(无尾换行)是 unknown-shape
 *  - 203-204 scanTranscriptFile 内 openSync 抛错 → 外层 catch
 *
 * 隔离:私有 CCV_PROJECTS_DIR(mkdtemp),私有 CCV_LOG_DIR;动态 import 目标模块。
 */
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync,
  openSync, ftruncateSync, closeSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SAVED_PROJECTS_DIR = process.env.CCV_PROJECTS_DIR;
const SAVED_LOG_DIR = process.env.CCV_LOG_DIR;

const TMP = mkdtempSync(join(tmpdir(), 'ccv-branch-str-'));
const PROJ = join(TMP, 'projects');
mkdirSync(PROJ, { recursive: true });
process.env.CCV_PROJECTS_DIR = PROJ;
process.env.CCV_LOG_DIR = join(TMP, 'logs');

let findTranscriptPath, lookupToolUseInput, clearCache;

before(async () => {
  const mod = await import('../server/lib/session-transcript-reader.js');
  findTranscriptPath = mod.findTranscriptPath;
  lookupToolUseInput = mod.lookupToolUseInput;
  clearCache = mod.clearCache;
});

function exitPlanLine({ tuId, name = 'ExitPlanMode', input = {}, sid = 'sid' }) {
  return JSON.stringify({
    type: 'assistant',
    sessionId: sid,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: tuId, name, input }] },
  });
}

function writeTranscript(dir, sessionId, lines, { noEof = false } = {}) {
  const projDir = join(PROJ, dir);
  mkdirSync(projDir, { recursive: true });
  const file = join(projDir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join('\n') + (noEof ? '' : '\n'));
  return file;
}

after(() => {
  // 还原被改过权限的文件,确保能删
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  if (SAVED_PROJECTS_DIR === undefined) delete process.env.CCV_PROJECTS_DIR;
  else process.env.CCV_PROJECTS_DIR = SAVED_PROJECTS_DIR;
  if (SAVED_LOG_DIR === undefined) delete process.env.CCV_LOG_DIR;
  else process.env.CCV_LOG_DIR = SAVED_LOG_DIR;
});

beforeEach(() => {
  process.env.CCV_PROJECTS_DIR = PROJ;
  clearCache();
});

// ============================================================================
describe('findTranscriptPath 分支', () => {
  it('lruSet 容量上限淘汰:>64 个不同 cacheKey 触发 oldest 删除(43-45)', () => {
    // 每个 sessionId 都命中(写真实文件),迫使 path LRU 写入 >64 条 → 淘汰最旧
    const total = 70;
    const files = [];
    for (let i = 0; i < total; i++) {
      const sid = `evict-${i}`;
      files.push(writeTranscript(`-e${i}`, sid, [exitPlanLine({ tuId: 't', sid })]));
    }
    for (let i = 0; i < total; i++) {
      assert.equal(findTranscriptPath(`evict-${i}`), files[i]);
    }
    // 最旧的 key(evict-0)应已被淘汰:再查仍能正确返回(走重扫而非缓存),证明不崩
    assert.equal(findTranscriptPath('evict-0'), files[0]);
  });

  it('miss 缓存 TTL 内第二次直接返回 null(74-75)', () => {
    // 第一次 miss → 写入 { path:null, expireAt: now+30s }
    assert.equal(findTranscriptPath('ghost-sid-aaa'), null);
    // 第二次:TTL 远未过期 → 命中 miss 缓存的 expireAt>now 分支直接 return null
    assert.equal(findTranscriptPath('ghost-sid-aaa'), null);
  });

  it('projectsDir 不存在 → readdirSync 抛错走 catch,缓存 miss(90-92)', () => {
    const gone = join(TMP, 'nonexistent-projects-dir-zzz');
    process.env.CCV_PROJECTS_DIR = gone;
    clearCache();
    assert.equal(findTranscriptPath('any-sid'), null);
    // 再查一次:走 miss TTL 缓存,仍 null(不抛)
    assert.equal(findTranscriptPath('any-sid'), null);
  });

  it('sessionId 为空 → null(短路 69 行)', () => {
    assert.equal(findTranscriptPath(''), null);
    assert.equal(findTranscriptPath(undefined), null);
  });

  it('缓存命中后 mtime 校验通过 → 复用缓存路径(76-83 else 分支)', () => {
    const sid = 'cache-revalidate';
    const file = writeTranscript('-cr', sid, [exitPlanLine({ tuId: 't', sid })]);
    assert.equal(findTranscriptPath(sid), file); // 第一次:扫描+写缓存
    assert.equal(findTranscriptPath(sid), file); // 第二次:命中缓存+statSync mtime 校验通过
  });

  it('缓存命中但 mtime 已变 → 失效重扫(80 行 fall through)', () => {
    const sid = 'cache-stale';
    const file = writeTranscript('-cs', sid, [exitPlanLine({ tuId: 't', sid })]);
    assert.equal(findTranscriptPath(sid), file);
    // 推后 mtime 模拟 CC 重写 transcript → 缓存 mtime 不匹配 → fall through 重扫
    utimesSync(file, 99999, 99999);
    assert.equal(findTranscriptPath(sid), file);
  });

  it('同名 .jsonl 是目录(非文件)→ isFile() 为假被跳过(99 行)', () => {
    const sid = 'dir-collide';
    const dir = '-dc';
    // 在一个 project 目录里把 `${sid}.jsonl` 建成子目录
    mkdirSync(join(PROJ, dir, `${sid}.jsonl`), { recursive: true });
    // 另一个 project 里放真正的文件
    const real = writeTranscript('-dc-real', sid, [exitPlanLine({ tuId: 't', sid })]);
    assert.equal(findTranscriptPath(sid), real);
  });

  it('多匹配 + projectHint 命中后缀(111-117 else if 分支)', () => {
    const sid = 'multi-hint';
    writeTranscript('-Users-x-cc-viewer', sid, [exitPlanLine({ tuId: 't', sid })]);
    const wt = writeTranscript('-Users-x-cc-viewer--wt-frosty', sid, [exitPlanLine({ tuId: 't', sid })]);
    assert.equal(findTranscriptPath(sid, 'frosty'), wt);
  });

  it('多匹配 + projectHint 无后缀命中 → 回退全集取 mtime(114 hintMatch 空分支)', () => {
    const sid = 'multi-hint-nomatch';
    const a = writeTranscript('-aa', sid, [exitPlanLine({ tuId: 't', sid })]);
    const b = writeTranscript('-bb', sid, [exitPlanLine({ tuId: 't', sid })]);
    utimesSync(a, 1000, 1000);
    utimesSync(b, 2000, 2000);
    // hint 不匹配任何目录后缀 → hintMatch 为空 → 用全集 pickByMtime → b(更新)
    assert.equal(findTranscriptPath(sid, 'totally-absent-hint'), b);
  });

  it('多匹配无 hint:首元素 mtime 更大 → reduce 取 a(57 行 ? a 分支)', () => {
    const sid = 'mtime-first-bigger';
    const a = writeTranscript('-fa', sid, [exitPlanLine({ tuId: 't', sid })]);
    const b = writeTranscript('-fb', sid, [exitPlanLine({ tuId: 't', sid })]);
    // 让两者 mtime 不同,覆盖 a>=b 与 a<b 两种 reduce 路径(本用例 + 上面无后缀用例合起来)
    utimesSync(a, 5000, 5000);
    utimesSync(b, 1000, 1000);
    assert.equal(findTranscriptPath(sid), a);
  });

  it('CCV_PROJECTS_DIR 未设置 → 走 getClaudeConfigDir(...)/projects 默认(26 行 || 分支)', () => {
    // 进程内:删 CCV_PROJECTS_DIR,把 CLAUDE_CONFIG_DIR 指向私有空目录(无 projects 子目录)
    const savedProj = process.env.CCV_PROJECTS_DIR;
    const savedCfg = process.env.CLAUDE_CONFIG_DIR;
    const cfg = mkdtempSync(join(tmpdir(), 'ccv-cfg-'));
    delete process.env.CCV_PROJECTS_DIR;
    process.env.CLAUDE_CONFIG_DIR = cfg;
    clearCache();
    try {
      // projects 子目录不存在 → readdirSync 抛错 → null,且证明走了默认路径(未崩)
      assert.equal(findTranscriptPath('no-such-sid-default-path'), null);
    } finally {
      if (savedProj === undefined) delete process.env.CCV_PROJECTS_DIR;
      else process.env.CCV_PROJECTS_DIR = savedProj;
      if (savedCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = savedCfg;
      try { rmSync(cfg, { recursive: true, force: true }); } catch {}
    }
  });
});

// ============================================================================
describe('lookupToolUseInput / scanTranscriptFile 分支', () => {
  it('transcript 超过 MAX_TRANSCRIPT_BYTES → 跳过返回 null(170-174)', () => {
    const sid = 'too-big';
    const projDir = join(PROJ, '-big');
    mkdirSync(projDir, { recursive: true });
    const file = join(projDir, `${sid}.jsonl`);
    // 用 ftruncate 造稀疏文件,逻辑大小 > 64MB,实际不占盘
    const fd = openSync(file, 'w');
    ftruncateSync(fd, 64 * 1024 * 1024 + 1);
    closeSync(fd);
    assert.equal(lookupToolUseInput(sid, 'tu_x'), null);
  });

  it('pending 末行(无尾换行)是 unknown-shape → schema drift,返回 null(197)', () => {
    const sid = 'pending-unknown';
    // 单行、无尾换行 → 走 pending 分支;input 有字段但无 plan/planFilePath → unknown-shape
    writeTranscript('-pu', sid, [exitPlanLine({ tuId: 'tu_pu', input: { foo: 'bar' }, sid })], { noEof: true });
    assert.equal(lookupToolUseInput(sid, 'tu_pu'), null);
  });

  it('openSync 抛错(文件不可读)→ 外层 catch 返回 null(203-204)', () => {
    const sid = 'unreadable';
    const file = writeTranscript('-ur', sid, [exitPlanLine({ tuId: 'tu_ur', input: { plan: 'P' }, sid })]);
    // 移除读权限:statSync/isFile/existsSync 仍可,但 openSync('r') 抛 EACCES → 内层 try 之外的 catch
    chmodSync(file, 0o000);
    try {
      const r = lookupToolUseInput(sid, 'tu_ur');
      assert.equal(r, null);
    } finally {
      chmodSync(file, 0o644); // 还原以便 after 清理
    }
  });

  it('toolUseId 为空 → null(短路 218 行)', () => {
    assert.equal(lookupToolUseInput('sid', ''), null);
    assert.equal(lookupToolUseInput('', 'tu'), null);
  });

  it('空文件(size===0)→ null(168 行)', () => {
    const sid = 'empty';
    const projDir = join(PROJ, '-empty');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, `${sid}.jsonl`), '');
    assert.equal(lookupToolUseInput(sid, 'tu_x'), null);
  });

  it('pending 末行命中 hit(196 行)', () => {
    const sid = 'pending-hit';
    writeTranscript('-ph', sid, [exitPlanLine({ tuId: 'tu_ph', input: { plan: 'TAIL-HIT' }, sid })], { noEof: true });
    assert.deepEqual(lookupToolUseInput(sid, 'tu_ph'), { plan: 'TAIL-HIT' });
  });

  it('行含 ExitPlanMode 但不含目标 toolUseId → miss(134 行)', () => {
    const sid = 'name-no-id';
    // 同一行有 ExitPlanMode,但 id 与查询不同 → indexOf(toolUseId)===-1 → miss
    writeTranscript('-nni', sid, [exitPlanLine({ tuId: 'tu_present', input: { plan: 'P' }, sid })]);
    assert.equal(lookupToolUseInput(sid, 'tu_absent_xyz'), null);
  });

  it('message.content 非数组 → miss(140 行)', () => {
    const sid = 'content-nonarray';
    // 用对象渲染:sibling 字段值是对象 {name:'ExitPlanMode',id:'tu_na'},
    // JSON.stringify 会产出字面量 "name":"ExitPlanMode" 与 "id":"tu_na" 过双子串预过滤;
    // 但 message.content 是字符串(非数组)→ Array.isArray 假 → miss
    const line = JSON.stringify({
      type: 'assistant', sessionId: sid,
      message: { role: 'assistant', content: 'plain string content' },
      _decoy: { name: 'ExitPlanMode', id: 'tu_na' },
    });
    // 校验该行确实含两段预过滤子串
    assert.ok(line.indexOf('"name":"ExitPlanMode"') !== -1);
    assert.ok(line.indexOf('tu_na') !== -1);
    writeTranscript('-cna', sid, [line]);
    assert.equal(lookupToolUseInput(sid, 'tu_na'), null);
  });

  it('扫描时遇到空白行(!line)→ 该行 miss(133 行 !line 真分支)', () => {
    const sid = 'blank-line';
    const target = exitPlanLine({ tuId: 'tu_bl', input: { plan: 'P' }, sid });
    // 中间夹一个空白行:split("\n") 产出 "" 进入 lines(被扫描),触发 !line 短路
    const projDir = join(PROJ, '-bl');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, `${sid}.jsonl`), '\n' + target + '\n');
    assert.deepEqual(lookupToolUseInput(sid, 'tu_bl'), { plan: 'P' });
  });

  it('扫描时遇到不含 ExitPlanMode 的普通行 → 该行 miss(134 行真分支)', () => {
    const sid = 'plain-line';
    const plain = JSON.stringify({ type: 'user', sessionId: sid, message: { role: 'user', content: 'hi' } });
    const target = exitPlanLine({ tuId: 'tu_pl', input: { plan: 'P' }, sid });
    // 第一行普通行(不含 ExitPlanMode)→ L133 true → miss;第二行命中
    writeTranscript('-pl', sid, [plain, target]);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_pl'), { plan: 'P' });
  });

  it('content 内混入非目标 block → continue 跳过(145 行)', () => {
    const sid = 'mixed-block';
    const line = JSON.stringify({
      type: 'assistant', sessionId: sid,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },                                  // type 非 tool_use → continue
          { type: 'tool_use', id: 'other', name: 'Read', input: {} },       // name 非 ExitPlanMode → continue
          { type: 'tool_use', id: 'wrong-id', name: 'ExitPlanMode', input: { plan: 'NO' } }, // id 不匹配 → continue
          { type: 'tool_use', id: 'tu_mb', name: 'ExitPlanMode', input: { plan: 'YES' } },   // 命中
        ],
      },
    });
    // 行需含目标 id 才过预过滤
    writeTranscript('-mb', sid, [line]);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_mb'), { plan: 'YES' });
  });

  it('input 只有 planFilePath 没 plan → 返回仅 planFilePath(149 真分支)', () => {
    const sid = 'only-pfp';
    writeTranscript('-opfp', sid, [exitPlanLine({ tuId: 'tu_opfp', input: { planFilePath: '/p/x.md' }, sid })]);
    assert.deepEqual(lookupToolUseInput(sid, 'tu_opfp'), { planFilePath: '/p/x.md' });
  });

  it('input.plan 非字符串(类型不符)→ 不取,落入 unknown-shape(148 假分支)', () => {
    const sid = 'plan-nonstring';
    // plan 是数字、planFilePath 是对象 → 都不是 string → value 空 → input 有键 → unknown-shape → null
    writeTranscript('-pns', sid, [exitPlanLine({ tuId: 'tu_pns', input: { plan: 123, planFilePath: { a: 1 } }, sid })]);
    assert.equal(lookupToolUseInput(sid, 'tu_pns'), null);
  });

  it('命中 block 但 input 为空对象 → miss(151 假 + 153 miss 分支)', () => {
    const sid = 'empty-input';
    // input:{} → 既不 hit 也无键 → unknownShape 保持 false → 返回 miss → null
    writeTranscript('-ei', sid, [exitPlanLine({ tuId: 'tu_ei', input: {}, sid })]);
    assert.equal(lookupToolUseInput(sid, 'tu_ei'), null);
  });
});
