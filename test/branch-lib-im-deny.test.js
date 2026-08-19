// 针对 server/lib/im-deny.js 的分支补洞测试（仅新增,不改源码/不动现有测试）。
// 目标:把单跑口径 branch 覆盖从 ~81% 提到 >=95%。
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { resolve } from 'node:path';

let evaluateImDeny;
before(async () => {
  // canonical 静态相对 import(不加 query),保证记账落到正确文件。
  ({ evaluateImDeny } = await import('../packages/app/server/lib/im-deny.js'));
});

const HOME = '/home/tester';
const opts = { home: HOME };

describe('im-deny 分支补洞: pathOf 输入形态', () => {
  it('使用 notebook_path 字段(file_path 缺失时的 || 第二臂)', () => {
    // NotebookEdit 走 notebook_path;命中凭证目录即 deny,证明 notebook_path 被取用。
    const r = evaluateImDeny('NotebookEdit', { notebook_path: resolve(HOME, '.ssh/x.ipynb') }, opts);
    assert.equal(r.deny, true);
  });

  it('使用 path 字段(file_path 与 notebook_path 都缺失时的 || 第三臂)', () => {
    // Read 走 path;命中 .npmrc(READ_REL_PATHS)即 deny,证明 path 被取用。
    const r = evaluateImDeny('Read', { path: resolve(HOME, '.npmrc') }, opts);
    assert.equal(r.deny, true);
  });

  it('path 非法落非凭证区时正常放行(path 取到但不敏感)', () => {
    const r = evaluateImDeny('Read', { path: '/tmp/x/note.md' }, opts);
    assert.equal(r.deny, false);
  });

  it('fp 为空字符串 -> !fp 短路臂 -> 返回 deny:false', () => {
    // typeof '' === 'string' 为真,走到 || 右臂 !fp 为真 => null => deny:false。
    const r = evaluateImDeny('Read', { file_path: '' }, opts);
    assert.equal(r.deny, false);
  });

  it('fp 为非字符串(数字) -> typeof !== string 第一臂为真 -> deny:false', () => {
    const r = evaluateImDeny('Write', { file_path: 12345 }, opts);
    assert.equal(r.deny, false);
  });

  it('三个路径字段全缺失 -> fp 为 undefined -> deny:false', () => {
    const r = evaluateImDeny('Edit', {}, opts);
    assert.equal(r.deny, false);
  });

  it('fp 恰为 "~" -> 展开为 home 本身(fp === "~" 真臂)', () => {
    // home 目录本身不在任何 cred root 之内,也不命中精确文件 => 放行,但分支被覆盖。
    const r = evaluateImDeny('Read', { file_path: '~' }, opts);
    assert.equal(r.deny, false);
  });

  it('fp 以 "~/" 开头 -> 展开(else if 真臂)且命中凭证目录', () => {
    const r = evaluateImDeny('Read', { file_path: '~/.aws/credentials' }, opts);
    assert.equal(r.deny, true);
  });

  it('fp 以普通绝对路径开头 -> 既非 "~" 也非 "~/"(两 if 假臂)', () => {
    const r = evaluateImDeny('Write', { file_path: '/var/data/app.conf' }, opts);
    assert.equal(r.deny, false);
  });
});

describe('im-deny 分支补洞: underAny 的 === 相等臂', () => {
  it('Read 路径恰等于凭证根目录本身(absPath === r 真臂,非 startsWith)', () => {
    // 直接给 .ssh 目录本身(无尾部子路径),命中 underAny 的第一个比较臂。
    const r = evaluateImDeny('Read', { file_path: resolve(HOME, '.ssh') }, opts);
    assert.equal(r.deny, true);
    assert.equal(r.reason, 'read of a credential directory');
  });

  it('Write 路径恰等于凭证根目录本身(.aws)', () => {
    const r = evaluateImDeny('Write', { file_path: resolve(HOME, '.aws') }, opts);
    assert.equal(r.deny, true);
    assert.equal(r.reason, 'write to a credential directory');
  });

  it('路径是凭证根的兄弟前缀(.sshx)不应误命中 startsWith(r+"/") 边界', () => {
    // .sshx 不等于 .ssh 也不以 .ssh/ 开头 => 不 deny(两比较臂均假)。
    const r = evaluateImDeny('Read', { file_path: resolve(HOME, '.sshx/file') }, opts);
    assert.equal(r.deny, false);
  });
});

describe('im-deny 分支补洞: Bash command 类型与短路', () => {
  it('command 为非字符串 -> typeof 三元假臂 -> cmd="" -> !cmd 真臂 deny:false', () => {
    const r = evaluateImDeny('Bash', { command: 42 }, opts);
    assert.equal(r.deny, false);
  });

  it('command 为对象(非字符串)同样走假臂放行', () => {
    const r = evaluateImDeny('Bash', { command: { foo: 1 } }, opts);
    assert.equal(r.deny, false);
  });

  it('command 是字符串且为空 -> 三元真臂取值后 !cmd 仍为真 -> deny:false', () => {
    const r = evaluateImDeny('Bash', { command: '' }, opts);
    assert.equal(r.deny, false);
  });

  it('command 命中规则后立即返回 reason(for 循环 test 真臂)', () => {
    const r = evaluateImDeny('Bash', { command: 'sudo rm -rf /' }, opts);
    assert.equal(r.deny, true);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  });

  it('command 走完所有规则未命中 -> 循环结束 deny:false', () => {
    const r = evaluateImDeny('Bash', { command: 'echo hello world' }, opts);
    assert.equal(r.deny, false);
  });
});

describe('im-deny 分支补洞: opts.home 默认值', () => {
  it('opts 缺省 home -> 回退 os.homedir()(opts.home || ... 右臂)', () => {
    const real = os.homedir();
    // 在真实 home 下构造凭证目录路径,证明走的是 os.homedir() 回退。
    const r = evaluateImDeny('Read', { file_path: resolve(real, '.ssh/id_rsa') });
    assert.equal(r.deny, true);
  });

  it('完全不传 opts 也使用 os.homedir() 且普通路径放行', () => {
    const r = evaluateImDeny('Read', { file_path: '/tmp/whatever.txt' });
    assert.equal(r.deny, false);
  });

  it('opts.home 提供时优先使用(opts.home || 左臂)', () => {
    // /home/tester/.ssh 在自定义 home 下命中;但在真实 home 下不会(除非真机就是该路径)。
    const r = evaluateImDeny('Read', { file_path: resolve(HOME, '.ssh/id_rsa') }, { home: HOME });
    assert.equal(r.deny, true);
  });
});

describe('im-deny 分支补洞: 各工具分发与精确文件臂', () => {
  it('Read 命中 READ_REL_PATHS 精确文件(.netrc)', () => {
    const r = evaluateImDeny('Read', { file_path: resolve(HOME, '.netrc') }, opts);
    assert.equal(r.deny, true);
    assert.equal(r.reason, 'read of a secret/credential file');
  });

  it('Read 不命中凭证目录也不命中精确文件 -> 末尾 deny:false', () => {
    const r = evaluateImDeny('Read', { file_path: resolve(HOME, '.claude/CLAUDE.md') }, opts);
    assert.equal(r.deny, false);
  });

  it('Write 命中 WRITE_HOME_FILES(.profile)', () => {
    const r = evaluateImDeny('Write', { file_path: resolve(HOME, '.profile') }, opts);
    assert.equal(r.deny, true);
    assert.equal(r.reason, 'write to a shell startup / credential file');
  });

  it('Write 命中 WRITE_REL_PATHS(settings.local.json)', () => {
    const r = evaluateImDeny('Edit', { file_path: resolve(HOME, '.claude/settings.local.json') }, opts);
    assert.equal(r.deny, true);
    assert.equal(r.reason, 'write to protected global config (settings/hooks or IM secrets)');
  });

  it('Write 不命中任何敏感臂 -> 末尾 deny:false', () => {
    const r = evaluateImDeny('Write', { file_path: resolve(HOME, '.claude/cc-viewer/IM_x/note.md') }, opts);
    assert.equal(r.deny, false);
  });

  it('未知工具名直接 deny:false(三个 if 全假,末尾 return)', () => {
    assert.equal(evaluateImDeny('WebSearch', { query: 'x' }, opts).deny, false);
    assert.equal(evaluateImDeny('Glob', { pattern: '*' }, opts).deny, false);
  });

  it('toolInput 缺省走默认 {}(参数默认值分支)', () => {
    assert.equal(evaluateImDeny('Bash').deny, false);
    assert.equal(evaluateImDeny('Read').deny, false);
  });
});
