/**
 * server/lib/claude-md-discovery.js 分支补强测试。
 *
 * 目标分支(单跑口径 baseline 75-77% → >=95%):
 *   - pushIfFile 内 isReadAllowedFn 注入闸:policy={ok:false} 与 policy=null 两臂 (66-68)
 *   - readCandidateById: basename 二次校验失败 (136-137)
 *   - readCandidateById: fstat !isFile (open 成功但落点是目录) (154-155)
 *   - readCandidateById: openSync 抛错被 catch 兜住 (175)
 *   - discoverClaudeMdCandidates: cwd 不可 realpath 时 `safeRealpath(cwd)||cwd` 回退臂
 *   - readCandidateById: 大文件多次 readSync 循环 + n===0 break 路径
 *
 * 这些用例只构造数据 (candidates 数组手搓) 或注入 fake policy/fn,
 * 不触碰真实 ~/.claude,父链一律用 .git 终止防污染。
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, mkdtempSync, rmSync, realpathSync, symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

let discoverClaudeMdCandidates;
let readCandidateById;

before(async () => {
  const mod = await import('../server/lib/claude-md-discovery.js');
  discoverClaudeMdCandidates = mod.discoverClaudeMdCandidates;
  readCandidateById = mod.readCandidateById;
});

function setup() {
  const TMP = mkdtempSync(join(tmpdir(), 'ccv-branch-cmd-'));
  const cleanup = () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} };
  return { TMP, cleanup };
}

function makeId(realPath) {
  return createHash('sha1').update(realPath).digest('hex').slice(0, 12);
}

describe('discoverClaudeMdCandidates 分支补强', { concurrency: false }, () => {

  it('isReadAllowedFn 返回 {ok:false} 时候选被剔除', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(project, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(project, '.git'));
      writeFileSync(join(project, 'CLAUDE.md'), '# project');
      writeFileSync(join(fakeClaudeCfg, 'CLAUDE.md'), '# global');
      const deny = (real) => ({ ok: false, real });
      const out = discoverClaudeMdCandidates({
        cwd: project, claudeConfigDir: fakeClaudeCfg, isReadAllowedFn: deny,
      });
      assert.deepEqual(out, [], '所有候选都被 policy 拒绝 → 空列表');
    } finally { cleanup(); }
  });

  it('isReadAllowedFn 返回 null (falsy) 时候选被剔除', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      mkdirSync(project, { recursive: true });
      mkdirSync(join(project, '.git'));
      writeFileSync(join(project, 'CLAUDE.md'), '# project');
      const denyNull = () => null;
      const out = discoverClaudeMdCandidates({
        cwd: project, claudeConfigDir: '', isReadAllowedFn: denyNull,
      });
      assert.deepEqual(out, [], 'policy 为 null → 走 `!policy` 短路臂剔除');
    } finally { cleanup(); }
  });

  it('isReadAllowedFn 返回 {ok:true} 时候选保留', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      mkdirSync(project, { recursive: true });
      mkdirSync(join(project, '.git'));
      writeFileSync(join(project, 'CLAUDE.md'), '# project');
      const allow = (real) => ({ ok: true, real });
      const out = discoverClaudeMdCandidates({
        cwd: project, claudeConfigDir: '', isReadAllowedFn: allow,
      });
      const proj = out.filter(o => o.scope === 'project');
      assert.equal(proj.length, 1, 'policy 放行 → 候选保留');
    } finally { cleanup(); }
  });

  it('pushIfFile 各 guard TRUE 臂:不存在/dangling symlink/basename swap/目录/dedup', () => {
    const { TMP, cleanup } = setup();
    try {
      // 构造一个 repo,父链在 .git 终止;在多层放各种"应跳过"的入口。
      const repo = join(TMP, 'repo');
      const a = join(repo, 'a');
      const b = join(a, 'b');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(b, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(repo, '.git'));

      // b 层:CLAUDE.md 是目录 → isFileSafe false 跳过 (existsSync true,!isFile)
      mkdirSync(join(b, 'CLAUDE.md'));
      // a 层:dangling symlink → existsSync 对 broken symlink 为 false → existsSync 假臂
      symlinkSync(join(TMP, 'nowhere-CLAUDE.md'), join(a, 'CLAUDE.md'));
      // repo 层:正常 canonical 文件(会被收)
      const canon = join(repo, 'CLAUDE.md');
      writeFileSync(canon, '# repo');

      // global:basename swap 诱饵 —— ~/.claude/CLAUDE.md 是指向 passwd 的 symlink
      const lure = join(TMP, 'passwd');
      writeFileSync(lure, 'root:x');
      symlinkSync(lure, join(fakeClaudeCfg, 'CLAUDE.md'));

      const out = discoverClaudeMdCandidates({ cwd: b, claudeConfigDir: fakeClaudeCfg });
      const proj = out.filter(o => o.scope === 'project');
      // 只有 repo 那条 canonical 进列表;b(目录)/a(dangling)/global(basename swap) 全跳过
      assert.equal(proj.length, 1);
      assert.equal(realpathSync(canon), proj[0].realPath);
      assert.equal(out.filter(o => o.scope === 'global').length, 0, 'basename swap 的 global 被拦');
    } finally { cleanup(); }
  });

  it('父链 tail 三元:子层 CLAUDE.md vs 父层 ../CLAUDE.md (两臂)', () => {
    const { TMP, cleanup } = setup();
    try {
      const repo = join(TMP, 'repo');
      const sub = join(repo, 'sub');
      mkdirSync(sub, { recursive: true });
      mkdirSync(join(repo, '.git'));
      writeFileSync(join(sub, 'CLAUDE.md'), '# sub');   // dir===startReal → tail 'CLAUDE.md'
      writeFileSync(join(repo, 'CLAUDE.md'), '# repo'); // dir!==startReal → rel 非空臂
      const out = discoverClaudeMdCandidates({ cwd: sub, claudeConfigDir: '' });
      const tails = out.filter(o => o.scope === 'project').map(o => o.tail);
      assert.deepEqual(tails, ['CLAUDE.md', '../CLAUDE.md']);
    } finally { cleanup(); }
  });

  it('seenReal 去重:两层 symlink 指向同一物理 CLAUDE.md 只留一条', () => {
    const { TMP, cleanup } = setup();
    try {
      const canonDir = join(TMP, 'canon');
      mkdirSync(canonDir, { recursive: true });
      const realFile = join(canonDir, 'CLAUDE.md');
      writeFileSync(realFile, '# canonical');
      const repo = join(TMP, 'repo');
      const sub = join(repo, 'sub');
      mkdirSync(sub, { recursive: true });
      mkdirSync(join(repo, '.git'));
      symlinkSync(realFile, join(sub, 'CLAUDE.md'));
      symlinkSync(realFile, join(repo, 'CLAUDE.md'));
      const out = discoverClaudeMdCandidates({ cwd: sub, claudeConfigDir: '' });
      assert.equal(out.filter(o => o.scope === 'project').length, 1, 'realpath 去重 → seenReal.has 真臂');
    } finally { cleanup(); }
  });

  it('claudeConfigDir 为空字符串时跳过 global 候选 (if 假臂)', () => {
    const { TMP, cleanup } = setup();
    try {
      const repo = join(TMP, 'repo');
      mkdirSync(repo, { recursive: true });
      mkdirSync(join(repo, '.git'));
      writeFileSync(join(repo, 'CLAUDE.md'), '# p');
      const out = discoverClaudeMdCandidates({ cwd: repo, claudeConfigDir: '' });
      assert.equal(out.filter(o => o.scope === 'global').length, 0);
    } finally { cleanup(); }
  });

  it('cwd 无法 realpath 时回退到原始 cwd 字符串 (||cwd 臂)', () => {
    const { TMP, cleanup } = setup();
    try {
      // 传一个不存在的 cwd —— safeRealpath 返回 null,触发 `|| cwd` 回退;
      // 然后 startReal=该不存在路径,join 出的 CLAUDE.md 也不存在 → existsSync 假 → 不收;
      // 父链上溯过程不命中真实 $HOME(其下无 .git 但会因 atRoot 或 homedir 终止)。
      // 为防上溯污染,把 cwd 放在 TMP 之下并在 TMP/.git 之外不放任何 CLAUDE.md。
      const ghost = join(TMP, 'repo', 'does-not-exist');
      // TMP/repo/.git 用于父链终止(ghost 的祖先含 repo)
      mkdirSync(join(TMP, 'repo', '.git'), { recursive: true });
      const out = discoverClaudeMdCandidates({
        cwd: ghost, claudeConfigDir: '',
      });
      assert.ok(Array.isArray(out), '回退后仍返回数组(无候选)');
      assert.equal(out.filter(o => o.scope === 'project').length, 0);
    } finally { cleanup(); }
  });
});

describe('readCandidateById 分支补强', { concurrency: false }, () => {

  function fakeAllow(real) { return { ok: true, real }; }

  it('id 形态非法 → 400 Invalid id', () => {
    const r1 = readCandidateById([], 'XYZ', { maxBytes: 10, isReadAllowedFn: fakeAllow });
    assert.equal(r1.ok, false);
    assert.equal(r1.status, 400);
    const r2 = readCandidateById([], 123, { maxBytes: 10, isReadAllowedFn: fakeAllow });
    assert.equal(r2.status, 400, 'id 非字符串也 400');
  });

  it('id 合法但不在 candidates → 404 not found', () => {
    const r = readCandidateById([], 'abcdef012345', { maxBytes: 10, isReadAllowedFn: fakeAllow });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
    assert.match(r.error, /not found/i);
  });

  it('policy 拒绝 → 403 Forbidden + reason', () => {
    const { TMP, cleanup } = setup();
    try {
      const okFile = join(TMP, 'CLAUDE.md');
      writeFileSync(okFile, '# ok');
      const real = realpathSync(okFile);
      const id = makeId(real);
      const candidates = [{
        id, scope: 'project', realPath: real, tail: 'CLAUDE.md', mtimeMs: 0,
      }];
      const deny = () => ({ ok: false, reason: 'sensitive-prefix' });
      const r = readCandidateById(candidates, id, { maxBytes: 1024, isReadAllowedFn: deny });
      assert.equal(r.ok, false);
      assert.equal(r.status, 403);
      assert.equal(r.reason, 'sensitive-prefix');
    } finally { cleanup(); }
  });

  it('文件超过 maxBytes → 413 File too large', () => {
    const { TMP, cleanup } = setup();
    try {
      const okFile = join(TMP, 'CLAUDE.md');
      writeFileSync(okFile, 'x'.repeat(5000));
      const real = realpathSync(okFile);
      const id = makeId(real);
      const candidates = [{
        id, scope: 'project', realPath: real, tail: 'CLAUDE.md', mtimeMs: 0,
      }];
      const r = readCandidateById(candidates, id, { maxBytes: 100, isReadAllowedFn: fakeAllow });
      assert.equal(r.ok, false);
      assert.equal(r.status, 413);
    } finally { cleanup(); }
  });

  it('basename 二次校验失败 → 404 (136-137)', () => {
    const { TMP, cleanup } = setup();
    try {
      // 手搓一个候选:realPath basename 不是 CLAUDE.md,但 id 形态合法且匹配。
      const bogus = join(TMP, 'NOT_CLAUDE.txt');
      writeFileSync(bogus, 'x');
      const realBogus = realpathSync(bogus);
      const id = makeId(realBogus);
      const candidates = [{
        id, scope: 'project', realPath: realBogus, tail: 'NOT_CLAUDE.txt', mtimeMs: 0,
      }];
      const r = readCandidateById(candidates, id, { maxBytes: 1024, isReadAllowedFn: fakeAllow });
      assert.equal(r.ok, false);
      assert.equal(r.status, 404);
      assert.match(r.error, /basename/i);
    } finally { cleanup(); }
  });

  it('fstat 落点非文件(目录)→ 400 Not a file (154-155)', () => {
    const { TMP, cleanup } = setup();
    try {
      // policy.real 指向一个名为 CLAUDE.md 的目录:openSync 成功,fstat isFile 假。
      const dirAsClaude = join(TMP, 'CLAUDE.md');
      mkdirSync(dirAsClaude);
      const real = realpathSync(dirAsClaude);
      const id = makeId(real);
      const candidates = [{
        id, scope: 'project', realPath: real, tail: 'CLAUDE.md', mtimeMs: 0,
      }];
      // policy 返回的 real 仍是该目录 → 进 openSync→fstat 分支
      const policyDirReal = () => ({ ok: true, real });
      const r = readCandidateById(candidates, id, { maxBytes: 1024, isReadAllowedFn: policyDirReal });
      assert.equal(r.ok, false);
      assert.equal(r.status, 400);
      assert.match(r.error, /Not a file/i);
    } finally { cleanup(); }
  });

  it('openSync 抛错(real 不存在)→ catch 返回 500/错误码 (175)', () => {
    const { TMP, cleanup } = setup();
    try {
      // 候选的 realPath 合法(basename=CLAUDE.md)且文件存在以通过 basename 校验;
      // 但 policy.real 指向一个不存在的兄弟路径 → openSync 抛 ENOENT → catch。
      const okFile = join(TMP, 'CLAUDE.md');
      writeFileSync(okFile, '# ok');
      const real = realpathSync(okFile);
      const id = makeId(real);
      const candidates = [{
        id, scope: 'project', realPath: real, tail: 'CLAUDE.md', mtimeMs: 0,
      }];
      const ghost = join(TMP, 'ghost', 'CLAUDE.md'); // 不存在
      const policyGhostReal = () => ({ ok: true, real: ghost });
      const r = readCandidateById(candidates, id, { maxBytes: 1024, isReadAllowedFn: policyGhostReal });
      assert.equal(r.ok, false);
      assert.equal(r.status, 500);
      assert.ok(r.error === 'ENOENT' || r.error === 'read-failed', `error=${r.error}`);
    } finally { cleanup(); }
  });

  it('catch 兜底:policy.real 非法导致 openSync 抛错 → 500 + e.code', () => {
    const { TMP, cleanup } = setup();
    try {
      const okFile = join(TMP, 'CLAUDE.md');
      writeFileSync(okFile, '# ok');
      const real = realpathSync(okFile);
      const id = makeId(real);
      const candidates = [{
        id, scope: 'project', realPath: real, tail: 'CLAUDE.md', mtimeMs: 0,
      }];
      // policy.real 为 null → openSync(null) 抛 TypeError(带 code=ERR_INVALID_ARG_TYPE)→ catch。
      // 走 `e && e.code ? e.code : 'read-failed'` 的 e.code 真臂。
      const policyNullReal = () => ({ ok: true, real: null });
      const r = readCandidateById(candidates, id, { maxBytes: 1024, isReadAllowedFn: policyNullReal });
      assert.equal(r.ok, false);
      assert.equal(r.status, 500);
      assert.equal(r.error, 'ERR_INVALID_ARG_TYPE', 'e 带 code → 返回 e.code');
    } finally { cleanup(); }
  });

  it('大文件:多次 readSync 循环读满后成功返回完整内容', () => {
    const { TMP, cleanup } = setup();
    try {
      const okFile = join(TMP, 'CLAUDE.md');
      const big = 'a'.repeat(500000); // 500KB,迫使 readSync 多轮
      writeFileSync(okFile, big);
      const real = realpathSync(okFile);
      const id = makeId(real);
      const candidates = [{
        id, scope: 'project', realPath: real, tail: 'CLAUDE.md', mtimeMs: 0,
      }];
      const r = readCandidateById(candidates, id, { maxBytes: 10_000_000, isReadAllowedFn: fakeAllow });
      assert.equal(r.ok, true);
      assert.equal(r.content.length, big.length);
      assert.equal(r.content, big);
      assert.equal(r.scope, 'project');
      assert.equal(r.tail, 'CLAUDE.md');
    } finally { cleanup(); }
  });

  it('空文件(size=0)直接返回空内容,跳过 read 循环', () => {
    const { TMP, cleanup } = setup();
    try {
      const okFile = join(TMP, 'CLAUDE.md');
      writeFileSync(okFile, '');
      const real = realpathSync(okFile);
      const id = makeId(real);
      const candidates = [{
        id, scope: 'project', realPath: real, tail: 'CLAUDE.md', mtimeMs: 0,
      }];
      const r = readCandidateById(candidates, id, { maxBytes: 1024, isReadAllowedFn: fakeAllow });
      assert.equal(r.ok, true);
      assert.equal(r.content, '');
    } finally { cleanup(); }
  });
});
