import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Canonical absolute path to the target module — used by subprocess children so
// their coverage is attributed to the real file (no query-busting URLs).
const TARGET = join(__dirname, '..', 'server', 'lib', 'git-diff.js');

let getGitDiffs, getUnpushedCommits;

before(async () => {
  // 动态 import 目标模块（避免 Vite 风格副作用，符合项目测试惯例）。
  const mod = await import('../server/lib/git-diff.js');
  getGitDiffs = mod.getGitDiffs;
  getUnpushedCommits = mod.getUnpushedCommits;
});

// 私有临时目录助手：用 mkdtemp 保证并行隔离，绝不写共享目录。
function makeTmpDir(tag) {
  return mkdtempSync(join(tmpdir(), `ccv-branch-gitdiff-${tag}-`));
}

function initRepo(dir) {
  execSync('git init -q', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email t@t.com', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name T', { cwd: dir, stdio: 'pipe' });
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' });
}

/**
 * 在子进程中以「假 git（PATH 注入）」运行目标模块的某个导出。
 * 子进程继承 NODE_V8_COVERAGE（spread process.env），覆盖率会被父进程合并，
 * 计入 canonical 文件。fakeGitScript 是一段 /bin/sh，按 "$*" 模拟各 git 子命令。
 *
 * @returns 解析后的 JSON 结果（子进程把目标导出的返回值 JSON.stringify 到 stdout）
 */
function runWithFakeGit({ tag, fakeGitScript, callJs, cwdSetup }) {
  const shimDir = makeTmpDir(`shim-${tag}`);
  const repoDir = makeTmpDir(`repo-${tag}`);
  try {
    const gitPath = join(shimDir, 'git');
    writeFileSync(gitPath, fakeGitScript, { mode: 0o755 });
    chmodSync(gitPath, 0o755);
    if (typeof cwdSetup === 'function') cwdSetup(repoDir);

    const runnerJs = `
      const REPO = ${JSON.stringify(repoDir)};
      const mod = await import(${JSON.stringify(TARGET)});
      const { getGitDiffs, getUnpushedCommits } = mod;
      const out = await (async () => { ${callJs} })();
      process.stdout.write(JSON.stringify(out));
    `;
    const runnerPath = join(shimDir, 'runner.mjs');
    writeFileSync(runnerPath, runnerJs);

    const res = spawnSync(process.execPath, [runnerPath], {
      encoding: 'utf-8',
      // 关键：spread process.env 保留 NODE_V8_COVERAGE，再把 shim 目录前置到 PATH。
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
    });
    assert.equal(res.status, 0, `子进程退出码应为 0；stderr=${res.stderr}`);
    return JSON.parse(res.stdout || 'null');
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
}

describe('git-diff 分支补充覆盖', () => {
  // ---- 87-88: getUnpushedCommits 中 rev-parse --abbrev-ref HEAD 抛错的 catch ----
  it('非 git 目录下 getUnpushedCommits 走 rev-parse catch，返回 branch=null', async () => {
    const dir = makeTmpDir('nongit');
    try {
      const r = await getUnpushedCommits(dir);
      assert.equal(r.hasUpstream, false);
      assert.equal(r.branch, null);
      assert.equal(r.upstream, null);
      assert.deepEqual(r.commits, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---- 255-256: getGitDiffs 二进制检测 is_binary=true ----
  it('修改过的二进制文件被标记为 is_binary（numstat 输出 -\\t-\\t）', async () => {
    const dir = makeTmpDir('bin');
    try {
      initRepo(dir);
      writeFileSync(join(dir, 'b.bin'), Buffer.from([0x00, 0x01, 0x02, 0x42]));
      execSync('git add b.bin && git commit -qm init', { cwd: dir, stdio: 'pipe' });
      writeFileSync(join(dir, 'b.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x99]));
      const r = await getGitDiffs(dir, ['b.bin']);
      assert.equal(r.length, 1);
      assert.equal(r[0].is_binary, true);
      // 二进制不读内容
      assert.equal(r[0].old_content, '');
      assert.equal(r[0].new_content, '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---- 301-302: 工作树模式下 readFileSync 抛错 → new_content='' 的 catch ----
  it('工作树模式下新内容不可读（EACCES）走 catch，new_content 置空', async () => {
    const dir = makeTmpDir('perm');
    try {
      initRepo(dir);
      const fp = join(dir, 'p.txt');
      writeFileSync(fp, 'orig\n');
      execSync('git add p.txt && git commit -qm init', { cwd: dir, stdio: 'pipe' });
      writeFileSync(fp, 'modified-but-unreadable\n');
      chmodSync(fp, 0o000); // existsSync/statSync 通过，readFileSync 抛 EACCES
      const r = await getGitDiffs(dir, ['p.txt']);
      // 还原权限以便清理
      chmodSync(fp, 0o644);
      assert.equal(r.length, 1);
      assert.equal(r[0].status, 'M');
      assert.equal(r[0].is_new, false);
      assert.equal(r[0].old_content, 'orig\n'); // git show HEAD 成功
      assert.equal(r[0].new_content, '');        // readFileSync 失败 → 空
    } finally {
      // 防御：若上面 chmod 还原前抛错，这里再尝试一次
      try { chmodSync(join(dir, 'p.txt'), 0o644); } catch {}
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---- 101-102: upstream 解析成功但不符合 SAFE_REF → 返回 upstream:null ----
  it('upstream 含非法字符未通过 SAFE_REF 时返回 hasUpstream=false（假 git）', () => {
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"rev-parse --abbrev-ref HEAD"*) echo "main"; exit 0;;',
      // 含空格 → 不匹配 /^[A-Za-z0-9_./\\-]+$/
      '  *"@{upstream}"*) echo "bad upstream ref"; exit 0;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'safe-ref',
      fakeGitScript: fakeGit,
      callJs: 'return await getUnpushedCommits(REPO);',
    });
    assert.equal(r.hasUpstream, false);
    assert.equal(r.branch, 'main');
    assert.equal(r.upstream, null);
    assert.deepEqual(r.commits, []);
  });

  // ---- 126-127: git log upstream..HEAD 抛错的 catch（hasUpstream 仍为 true）----
  it('git log 失败时返回 hasUpstream=true 且 commits 为空（假 git）', () => {
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"rev-parse --abbrev-ref HEAD"*) echo "main"; exit 0;;',
      '  *"@{upstream}"*) echo "origin/main"; exit 0;;',
      '  *" log "*) echo "boom" >&2; exit 1;;',
      '  *"log "*) echo "boom" >&2; exit 1;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'log-fail',
      fakeGitScript: fakeGit,
      callJs: 'return await getUnpushedCommits(REPO);',
    });
    assert.equal(r.hasUpstream, true);
    assert.equal(r.branch, 'main');
    assert.equal(r.upstream, 'origin/main');
    assert.deepEqual(r.commits, []);
  });

  // ---- 271-272: 工作树模式下 git show HEAD:file 失败 → old_content='' 的 catch ----
  it('工作树模式下旧内容 git show 失败走 catch，old_content 置空（假 git）', () => {
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      // 报告为已修改（status M，非新建非删除）
      '  *"status --porcelain"*) printf " M f.txt\\n"; exit 0;;',
      // numstat 返回空 → 非二进制
      '  *"--numstat"*) printf ""; exit 0;;',
      // git show HEAD:f.txt 失败 → 触发旧内容 catch
      '  *"show "*) echo "fatal: bad object" >&2; exit 128;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'oldshow-fail',
      fakeGitScript: fakeGit,
      cwdSetup: (repo) => writeFileSync(join(repo, 'f.txt'), 'new working tree content\n'),
      callJs: 'return await getGitDiffs(REPO, ["f.txt"]);',
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'f.txt');
    assert.equal(r[0].status, 'M');
    assert.equal(r[0].is_new, false);
    assert.equal(r[0].old_content, '');                         // show 失败 → 空
    assert.equal(r[0].new_content, 'new working tree content\n'); // 工作树读取成功
  });

  // ---- 321-323: getGitDiffs 外层 catch（git status 抛错 → continue）----
  it('git status 失败时外层 catch 跳过该文件（假 git）', () => {
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"status --porcelain"*) echo "fatal: not a git repository" >&2; exit 128;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'status-fail',
      fakeGitScript: fakeGit,
      callJs: 'return await getGitDiffs(REPO, ["whatever.txt"]);',
    });
    assert.deepEqual(r, []);
  });

  // ---- L89 `!branch` 左臂：rev-parse 输出空字符串 → branch='' 直接返回 ----
  it('rev-parse 输出空字符串时（branch 为空）走 !branch 早返回（假 git）', () => {
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"rev-parse --abbrev-ref HEAD"*) printf "\\n"; exit 0;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'empty-branch',
      fakeGitScript: fakeGit,
      callJs: 'return await getUnpushedCommits(REPO);',
    });
    assert.equal(r.hasUpstream, false);
    assert.equal(r.branch, '');
    assert.equal(r.upstream, null);
  });

  // ---- L100 `!upstream` 左臂：@{upstream} 解析出空字符串 ----
  it('@{upstream} 输出空字符串时走 !upstream 早返回（假 git）', () => {
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"rev-parse --abbrev-ref HEAD"*) echo "main"; exit 0;;',
      '  *"@{upstream}"*) printf "\\n"; exit 0;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'empty-upstream',
      fakeGitScript: fakeGit,
      callJs: 'return await getUnpushedCommits(REPO);',
    });
    assert.equal(r.hasUpstream, false);
    assert.equal(r.branch, 'main');
    assert.equal(r.upstream, null);
  });

  // ---- L147 `st[0] || 'M'`：name-status 行首即制表符（状态字段为空）→ 回退 'M' ----
  it('git log 的 name-status 行状态字段为空时文件状态回退为 M（假 git）', () => {
    // 构造一个 commit 块：header 用 \x1e 分隔、\x1f 字段分隔，紧跟一行以 TAB 开头的文件行。
    const SEP = String.fromCharCode(0x1e);
    const FS = String.fromCharCode(0x1f);
    const logOut = `${SEP}abc123def4567890abc123def4567890abc12345${FS}Author${FS}2020-01-01T00:00:00Z${FS}subject\\n\\tonlyfile.txt\\n`;
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"rev-parse --abbrev-ref HEAD"*) echo "main"; exit 0;;',
      '  *"@{upstream}"*) echo "origin/main"; exit 0;;',
      `  *" log "*) printf '%b' "${logOut}"; exit 0;;`,
      `  *"log "*) printf '%b' "${logOut}"; exit 0;;`,
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'log-empty-status',
      fakeGitScript: fakeGit,
      callJs: 'return await getUnpushedCommits(REPO);',
    });
    assert.equal(r.hasUpstream, true);
    assert.equal(r.commits.length, 1);
    assert.equal(r.commits[0].files.length, 1);
    assert.equal(r.commits[0].files[0].file, 'onlyfile.txt');
    assert.equal(r.commits[0].files[0].status, 'M'); // 空状态字段回退
  });

  // ---- L168 假分支(parse 非数字) + L170：rev-list 路径覆盖 ----
  it('truncated 后 rev-list 返回非数字时保持默认 truncated（假 git）', () => {
    const SEP = String.fromCharCode(0x1e);
    const FS = String.fromCharCode(0x1f);
    // 两个 commit，maxCommits=2 → 命中 cap → truncated 默认 true
    const h1 = 'a'.repeat(40), h2 = 'b'.repeat(40);
    const logOut =
      `${SEP}${h1}${FS}A1${FS}2020-01-01T00:00:00Z${FS}s1\\nA\\tf1.txt\\n` +
      `${SEP}${h2}${FS}A2${FS}2020-01-02T00:00:00Z${FS}s2\\nA\\tf2.txt\\n`;
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      '  *"rev-parse --abbrev-ref HEAD"*) echo "main"; exit 0;;',
      '  *"@{upstream}"*) echo "origin/main"; exit 0;;',
      '  *"rev-list --count"*) echo "not-a-number"; exit 0;;',
      `  *" log "*) printf '%b' "${logOut}"; exit 0;;`,
      `  *"log "*) printf '%b' "${logOut}"; exit 0;;`,
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'revlist-nan',
      fakeGitScript: fakeGit,
      callJs: 'return await getUnpushedCommits(REPO, { maxCommits: 2 });',
    });
    assert.equal(r.commits.length, 2);
    // parse 失败 → if 不进入 → 保持默认 truncated=true, totalCount=commits.length
    assert.equal(r.truncated, true);
    assert.equal(r.totalCount, 2);
  });

  // ---- L218 `st[0] || 'M'`（diff-tree 状态空）+ L235 commitStatusMap.get 未命中回退 ----
  it('commit 模式下 diff-tree 状态空行与未命中文件均回退状态 M（假 git）', () => {
    const hash = 'c'.repeat(40);
    // diff-tree 输出一行以 TAB 开头（状态空）的 mapped.txt；查询 absent.txt 不在表中。
    const dtOut = '\\tmapped.txt\\n';
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      `  *"diff-tree -r --no-commit-id --name-status"*) printf '%b' "${dtOut}"; exit 0;;`,
      // numstat：空 → 非二进制
      '  *"--numstat"*) printf ""; exit 0;;',
      // show <hash>^:file（旧）与 <hash>:file（新）都返回内容
      '  *"show "*) echo "content-line"; exit 0;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'commit-status-fallback',
      fakeGitScript: fakeGit,
      callJs: `return await getGitDiffs(REPO, ["mapped.txt", "absent.txt"], ${JSON.stringify(hash)});`,
    });
    assert.equal(r.length, 2);
    const mapped = r.find((d) => d.file === 'mapped.txt');
    const absent = r.find((d) => d.file === 'absent.txt');
    assert.equal(mapped.status, 'M'); // diff-tree 行状态空 → 'M'
    assert.equal(absent.status, 'M'); // 未在表中 → get() undefined → 'M'
  });

  // ---- commit 模式 >5MB：is_large 分支(L281-284)实为死代码（见 unreachable 论证）。
  // 这里验证「超大新内容」在 commit 模式下被 maxBuffer(5MB) 拒绝 → 落入 catch(L285-287)，
  // 而非 is_large 分支。即真实可达的是 catch，而非 is_large。 ----
  it('commit 模式下超大新内容被 maxBuffer 拒绝落入 catch（is_large 在此模式不可达）', () => {
    const hash = 'd'.repeat(40);
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      // 文件在该 commit 新增（A）→ is_new=true → 跳过旧内容，只取新内容
      `  *"diff-tree -r --no-commit-id --name-status"*) printf 'A\\tbig.txt\\n'; exit 0;;`,
      '  *"--numstat"*) printf ""; exit 0;;',
      // show <hash>:big.txt 输出 >5MB → 超过该调用的 maxBuffer(5MB) → execFile reject
      '  *"show "*) yes "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" | head -c 6291456; exit 0;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'commit-large',
      fakeGitScript: fakeGit,
      callJs: `return await getGitDiffs(REPO, ["big.txt"], ${JSON.stringify(hash)});`,
    });
    assert.equal(r.length, 1);
    // maxBuffer 拒绝 → 走 catch → new_content=''，不会命中 is_large
    assert.equal(r[0].is_large, undefined);
    assert.equal(r[0].new_content, '');
  });

  // ---- L285-287：commit 模式下 git show <hash>:file 失败 → new_content='' ----
  it('commit 模式下新内容 git show 失败走 catch，new_content 置空（假 git）', () => {
    const hash = 'e'.repeat(40);
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      // 文件新增（A）→ is_new=true，跳过旧内容；新内容 show 失败
      `  *"diff-tree -r --no-commit-id --name-status"*) printf 'A\\tg.txt\\n'; exit 0;;`,
      '  *"--numstat"*) printf ""; exit 0;;',
      '  *"show "*) echo "fatal: bad object" >&2; exit 128;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'commit-show-fail',
      fakeGitScript: fakeGit,
      callJs: `return await getGitDiffs(REPO, ["g.txt"], ${JSON.stringify(hash)});`,
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].is_new, true);
    assert.equal(r[0].new_content, '');
  });

  // ---- L220-222：commit 模式下 diff-tree 整体失败 → commitStatusMap 置空 Map ----
  it('commit 模式下 diff-tree 失败时回退空状态表，文件状态仍为 M（假 git）', () => {
    const hash = 'f'.repeat(40);
    const fakeGit = [
      '#!/bin/sh',
      'case "$*" in',
      `  *"diff-tree -r --no-commit-id --name-status"*) echo "boom" >&2; exit 1;;`,
      '  *"--numstat"*) printf ""; exit 0;;',
      '  *"show "*) echo "c"; exit 0;;',
      '  *) echo "unexpected: $*" >&2; exit 1;;',
      'esac',
    ].join('\n') + '\n';
    const r = runWithFakeGit({
      tag: 'difftree-fail',
      fakeGitScript: fakeGit,
      callJs: `return await getGitDiffs(REPO, ["x.txt"], ${JSON.stringify(hash)});`,
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].status, 'M'); // 空表 → get() undefined → 'M'
  });
});
