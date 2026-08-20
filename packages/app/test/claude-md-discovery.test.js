/**
 * server/lib/claude-md-discovery.js 单元测试。
 *
 * 覆盖：
 *   - 仅 global / 仅 project / 两者并存的发现结果
 *   - 父链 walk 在 .git 处停止
 *   - id 由 realpath 导出，跨调用稳定
 *   - basename(real) !== 'CLAUDE.md' 的 symlink swap 被拒
 *   - 同一 realpath 的两条入口被去重
 *   - CLAUDE.md 是目录（非文件）被跳过
 *   - readCandidateById 校验 id 形态、404、403(policy)、413(size)、200(成功)
 *
 * 已知未覆盖（评估为低风险，工程化代价高）：
 *   - homedir 终止分支：mock os.homedir 在 ESM 子进程外注入较繁琐
 *   - 8 层 MAX_DEPTH 终止：构造 9 级深目录树成本高且增益有限
 *   - filesystem root (parent === dir) 终止：无法在沙箱内可靠构造
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverClaudeMdCandidates,
  readCandidateById,
} from '../server/lib/claude-md-discovery.js';

function setup() {
  const TMP = mkdtempSync(join(tmpdir(), 'ccv-claude-md-disc-'));
  const cleanup = () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} };
  return { TMP, cleanup };
}

describe('discoverClaudeMdCandidates', { concurrency: false }, () => {

  it('returns empty when no CLAUDE.md exists anywhere', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(project, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      // 用 .git 抢在 homedir 之前停掉父链 walk —— 否则 walk 会一路走到真实 $HOME，
      // 命中真实用户的 CLAUDE.md 污染本测试。
      mkdirSync(join(project, '.git'));
      const out = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: fakeClaudeCfg });
      assert.deepEqual(out, []);
    } finally { cleanup(); }
  });

  it('returns global only when ~/.claude/CLAUDE.md exists', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(project, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(project, '.git')); // 防止 walk 上溯到真实 $HOME 命中宿主 CLAUDE.md
      writeFileSync(join(fakeClaudeCfg, 'CLAUDE.md'), '# global');
      const out = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: fakeClaudeCfg });
      assert.equal(out.length, 1);
      assert.equal(out[0].scope, 'global');
      assert.equal(out[0].tail, '.claude/CLAUDE.md');
      assert.match(out[0].id, /^[0-9a-f]{12}$/);
    } finally { cleanup(); }
  });

  it('returns project + global when both exist; project first', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(project, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(project, '.git'));
      writeFileSync(join(project, 'CLAUDE.md'), '# project');
      writeFileSync(join(fakeClaudeCfg, 'CLAUDE.md'), '# global');
      const out = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: fakeClaudeCfg });
      assert.equal(out.length, 2);
      assert.equal(out[0].scope, 'project');
      assert.equal(out[0].tail, 'CLAUDE.md');
      assert.equal(out[1].scope, 'global');
    } finally { cleanup(); }
  });

  it('walks parents and stops at .git', () => {
    const { TMP, cleanup } = setup();
    try {
      // TMP/repo/.git, TMP/repo/CLAUDE.md, TMP/repo/sub/sub2/(cwd)
      // 父链应该走 sub2 → sub → repo (因为 repo 有 .git，含本层后停)
      const repo = join(TMP, 'repo');
      const sub = join(repo, 'sub');
      const sub2 = join(sub, 'sub2');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(sub2, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(repo, '.git'));
      writeFileSync(join(repo, 'CLAUDE.md'), '# repo root');
      writeFileSync(join(sub, 'CLAUDE.md'), '# sub');
      writeFileSync(join(sub2, 'CLAUDE.md'), '# cwd');
      // 故意在 TMP（.git 之上）也放一个，应该走不到
      writeFileSync(join(TMP, 'CLAUDE.md'), '# above-git');
      const out = discoverClaudeMdCandidates({ cwd: sub2, claudeConfigDir: fakeClaudeCfg });
      // 期望: sub2 / sub / repo 三条 project 候选；不含 TMP 那条
      const projectCandidates = out.filter(o => o.scope === 'project');
      assert.equal(projectCandidates.length, 3);
      const tails = projectCandidates.map(o => o.tail);
      assert.deepEqual(tails, ['CLAUDE.md', '../CLAUDE.md', '../../CLAUDE.md']);
    } finally { cleanup(); }
  });

  it('id is stable across two calls when FS unchanged', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(project, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(project, '.git'));
      writeFileSync(join(project, 'CLAUDE.md'), '# A');
      const a = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: fakeClaudeCfg });
      const b = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: fakeClaudeCfg });
      assert.equal(a[0].id, b[0].id);
    } finally { cleanup(); }
  });

  it('rejects symlink whose realpath basename is not CLAUDE.md', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(project, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(project, '.git'));
      // 写一个无害"诱饵"目标(模拟 /etc/passwd) —— 关键是 basename 不为 CLAUDE.md
      const lure = join(TMP, 'passwd');
      writeFileSync(lure, 'root:x:0:0:::');
      symlinkSync(lure, join(project, 'CLAUDE.md'));
      const out = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: fakeClaudeCfg });
      assert.deepEqual(out, []); // basename 校验拦下
    } finally { cleanup(); }
  });

  it('dedupes when two parent levels symlink to the same real CLAUDE.md', () => {
    const { TMP, cleanup } = setup();
    try {
      // basename 校验要求 realpath 落点的文件名仍是 CLAUDE.md，
      // 所以 canonical 文件放在 canon/CLAUDE.md，两个符号链接也都叫 CLAUDE.md。
      const canon = join(TMP, 'canon');
      mkdirSync(canon, { recursive: true });
      const realFile = join(canon, 'CLAUDE.md');
      writeFileSync(realFile, '# canonical');
      const repo = join(TMP, 'repo');
      const sub = join(repo, 'sub');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(sub, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(repo, '.git'));
      symlinkSync(realFile, join(sub, 'CLAUDE.md'));
      symlinkSync(realFile, join(repo, 'CLAUDE.md'));
      const out = discoverClaudeMdCandidates({ cwd: sub, claudeConfigDir: fakeClaudeCfg });
      const projectCandidates = out.filter(o => o.scope === 'project');
      assert.equal(projectCandidates.length, 1, 'duplicates by realpath should collapse');
    } finally { cleanup(); }
  });

  it('skips CLAUDE.md when it is a directory not a file', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'project');
      const fakeClaudeCfg = join(TMP, 'fake-claude');
      mkdirSync(project, { recursive: true });
      mkdirSync(fakeClaudeCfg, { recursive: true });
      mkdirSync(join(project, '.git'));
      // CLAUDE.md as a directory
      mkdirSync(join(project, 'CLAUDE.md'));
      const out = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: fakeClaudeCfg });
      assert.deepEqual(out, []);
    } finally { cleanup(); }
  });

});

describe('readCandidateById', { concurrency: false }, () => {

  function fakePolicyAllow(real) { return { ok: true, real }; }
  function fakePolicyDeny(_real) { return { ok: false, reason: 'sensitive-prefix' }; }

  it('rejects malformed id', () => {
    const r = readCandidateById([], 'NOT-HEX', { maxBytes: 1024, isReadAllowedFn: fakePolicyAllow });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it('returns 404 when id not in candidates', () => {
    const r = readCandidateById([], '0123456789ab', { maxBytes: 1024, isReadAllowedFn: fakePolicyAllow });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });

  // tmpdir 在 macOS 上 realpath 为 /private/var/...; 用 realpathSync(file) 来比对
  function findOwnedEntry(candidates, file) {
    const realFile = realpathSync(file);
    return candidates.find(c => c.realPath === realFile);
  }

  it('returns content for valid id under policy allow', () => {
    const { TMP, cleanup } = setup();
    try {
      // 用 .git 终止父链，避免一路走到真实 $HOME 拉到宿主 CLAUDE.md
      const project = join(TMP, 'p');
      mkdirSync(project, { recursive: true });
      mkdirSync(join(project, '.git'));
      const file = join(project, 'CLAUDE.md');
      writeFileSync(file, '# hi\nbody');
      const candidates = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: '' });
      const entry = findOwnedEntry(candidates, file);
      assert.ok(entry);
      const r = readCandidateById(candidates, entry.id, { maxBytes: 1024, isReadAllowedFn: fakePolicyAllow });
      assert.equal(r.ok, true);
      assert.equal(r.content, '# hi\nbody');
      assert.equal(r.scope, 'project');
    } finally { cleanup(); }
  });

  it('returns 403 when policy denies', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'p');
      mkdirSync(project, { recursive: true });
      mkdirSync(join(project, '.git'));
      const file = join(project, 'CLAUDE.md');
      writeFileSync(file, '# x');
      const candidates = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: '' });
      const entry = findOwnedEntry(candidates, file);
      assert.ok(entry);
      const r = readCandidateById(candidates, entry.id, { maxBytes: 1024, isReadAllowedFn: fakePolicyDeny });
      assert.equal(r.ok, false);
      assert.equal(r.status, 403);
    } finally { cleanup(); }
  });

  it('returns 413 when file exceeds maxBytes', () => {
    const { TMP, cleanup } = setup();
    try {
      const project = join(TMP, 'p');
      mkdirSync(project, { recursive: true });
      mkdirSync(join(project, '.git'));
      const file = join(project, 'CLAUDE.md');
      writeFileSync(file, 'x'.repeat(2000));
      const candidates = discoverClaudeMdCandidates({ cwd: project, claudeConfigDir: '' });
      const entry = findOwnedEntry(candidates, file);
      assert.ok(entry);
      const r = readCandidateById(candidates, entry.id, { maxBytes: 100, isReadAllowedFn: fakePolicyAllow });
      assert.equal(r.ok, false);
      assert.equal(r.status, 413);
    } finally { cleanup(); }
  });
});
