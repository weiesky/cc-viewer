// server/routes/skills.js 分支补强 —— 仅新增测试，目标 branch >= 95%（单跑口径）。
// 已被 test/api-skills-gap.test.js / test/skills-import.test.js 覆盖的主路径不重复，
// 这里专攻残余分支：
//   · skillsList: process.cwd() 回落臂(9) + catch(12-16)
//   · skillsToggle: process.cwd() 回落臂(31)
//   · parseNameFromMd: 有 frontmatter 但无 name → return null(58)
//   · parseSkillUpload: 无 filename(77) / 无闭合 boundary 取到尾(99) / zip 目录条目跳过(121,138,159)
//     / header.size||0(126) / 根级无名 skill.md → prefix=null 臂(153) + fallback(154)
//     / 跨 skillRoot 文件被丢弃(160)
//   · writeSkillFiles: 非 EEXIST 错误重抛(197-198) + 路径逃逸 dest 被 continue(204)
//   · importSkillTo: 无 content-type 头(216) + writeSkillFiles 重抛无 status → 500 脱敏(254,255,257)
// 模块加载期无 Vite 风格 src/utils import，但仍按规范先 import shim，再【动态】import 目标。
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// 私有隔离目录：CLAUDE_CONFIG_DIR (getClaudeConfigDir→此处) + CCV_PROJECT_DIR。
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-skills-'));
process.env.CLAUDE_CONFIG_DIR = tmpDir;
const PROJ = join(tmpDir, 'proj');
mkdirSync(PROJ, { recursive: true });
process.env.CCV_PROJECT_DIR = PROJ;

let skillsRoutes, importSkillTo, parseSkillUpload, writeSkillFiles;

before(async () => {
  const mod = await import('../server/routes/skills.js');
  skillsRoutes = mod.skillsRoutes;
  importSkillTo = mod.importSkillTo;
  parseSkillUpload = mod.parseSkillUpload;
  writeSkillFiles = mod.writeSkillFiles;
});

after(() => {
  process.env.CCV_PROJECT_DIR = PROJ; // 还原任何用例里临时删掉的环境变量
  try { chmodSync(tmpDir, 0o700); } catch { /* ignore */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

function routeHandler(method, path) {
  const r = skillsRoutes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

// res 收集器；end() 时 resolve。
function makeRes() {
  let resolveEnd;
  const done = new Promise((r) => { resolveEnd = r; });
  const res = {
    statusCode: 0, headers: null, body: '',
    writeHead(code, hdrs) { this.statusCode = code; this.headers = hdrs; },
    end(b) { this.body = b || ''; resolveEnd({ status: this.statusCode, headers: this.headers, data: safeParse(this.body) }); },
  };
  return { res, done };
}

function multipart(boundary, filename, fileData) {
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData), tail]);
}

async function waitUntil(pred, { timeout = 3000, interval = 10 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('waitUntil timed out');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('skillsList 残余分支', () => {
  it('CCV_PROJECT_DIR 未设时回落 process.cwd()（仍 200）', async () => {
    const handler = routeHandler('GET', '/api/skills');
    const saved = process.env.CCV_PROJECT_DIR;
    delete process.env.CCV_PROJECT_DIR; // → listSkills({ projectDir: process.cwd() }) 回落臂
    try {
      const { res, done } = makeRes();
      handler({}, res, { pathname: '/api/skills' }, true, {});
      const out = await done;
      assert.equal(out.status, 200);
      assert.equal(out.data.ok, true);
      assert.ok(Array.isArray(out.data.skills));
    } finally {
      process.env.CCV_PROJECT_DIR = saved;
    }
  });

  it('成功路径内部抛错时落入 catch → 500 internal_error', async () => {
    // listSkills 是直接 import 的无法 mock；改用一个仅首次 writeHead 抛错的 res，
    // 强制成功臂(line 10)抛出，驱动 catch(12-16)：console.error → writeHead(500) → end。
    const handler = routeHandler('GET', '/api/skills');
    let writeHeadCalls = 0;
    let resolveEnd;
    const done = new Promise((r) => { resolveEnd = r; });
    const res = {
      statusCode: 0, headers: null, body: '',
      writeHead(code, hdrs) {
        writeHeadCalls += 1;
        if (writeHeadCalls === 1) throw new Error('boom on success writeHead');
        this.statusCode = code; this.headers = hdrs;
      },
      end(b) { this.body = b || ''; resolveEnd(); },
    };
    handler({}, res, { pathname: '/api/skills' }, true, {});
    await done;
    assert.equal(res.statusCode, 500);
    assert.equal(safeParse(res.body).error, 'internal_error');
    assert.equal(writeHeadCalls, 2, 'catch 应再次 writeHead(500)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('skillsToggle 残余分支', () => {
  function postToggle(bodyStr) {
    const handler = routeHandler('POST', '/api/skills/toggle');
    const req = new EventEmitter();
    req.destroy = () => {};
    const { res, done } = makeRes();
    handler(req, res, { pathname: '/api/skills/toggle' }, true, {});
    req.emit('data', Buffer.from(bodyStr));
    req.emit('end');
    return done;
  }

  it('CCV_PROJECT_DIR 未设时回落 process.cwd()（project 源 → SOURCE_MISSING）', async () => {
    const saved = process.env.CCV_PROJECT_DIR;
    delete process.env.CCV_PROJECT_DIR; // → projectDir: process.cwd() 回落臂(31)
    try {
      // cwd()/.claude/skills/<name> 几乎必不存在 → moveSkill 抛 SOURCE_MISSING(404)
      const out = await postToggle(JSON.stringify({ source: 'project', name: 'definitely-absent-skill-xyz', enable: false }));
      assert.equal(out.status, 404);
      assert.equal(out.data.code, 'SOURCE_MISSING');
    } finally {
      process.env.CCV_PROJECT_DIR = saved;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('parseSkillUpload 残余分支', () => {
  it('md 有 frontmatter 但无 name 字段 → parseNameFromMd 返回 null，回落文件名', async () => {
    // m 命中(有 ---\n...\n---)，但 nm 不命中(无 name:) → line 58 的 !nm 真臂 return null。
    const buf = multipart('Bn', 'OnlyDesc.md', '---\ndescription: just a desc\n---\nbody here');
    const { skillName, files } = await parseSkillUpload(buf, 'Bn', WINDOWS_RESERVED);
    assert.equal(skillName, 'OnlyDesc', '无 name 字段时回落到去扩展名的文件名');
    assert.deepEqual(files.map((f) => f.relPath), ['SKILL.md']);
  });

  it('multipart 缺少 filename → 400 No filename', async () => {
    const head = Buffer.from('--Bf\r\nContent-Disposition: form-data; name="file"\r\n\r\n');
    const tail = Buffer.from('\r\n--Bf--\r\n');
    const buf = Buffer.concat([head, Buffer.from('data'), tail]);
    await assert.rejects(
      () => parseSkillUpload(buf, 'Bf', WINDOWS_RESERVED),
      (e) => e.status === 400 && /No filename/.test(e.message),
    );
  });

  it('无闭合 boundary → fileData 取到 buffer 末尾(line 99 else 臂)', async () => {
    const head = Buffer.from('--Bo\r\nContent-Disposition: form-data; name="file"; filename="open.md"\r\n\r\n');
    const md = '---\nname: open-skill\n---\nbody without trailing boundary';
    const buf = Buffer.concat([head, Buffer.from(md)]); // 故意不拼 \r\n--boundary
    const { skillName, files } = await parseSkillUpload(buf, 'Bo', WINDOWS_RESERVED);
    assert.equal(skillName, 'open-skill');
    assert.equal(files[0].data.toString('utf8'), md, '应切到 buffer 末尾');
  });

  it('zip 含目录条目 + size=0 文件 + 根级无名 SKILL.md → 跳目录/||0/prefix=null+fallback', async () => {
    const zip = new AdmZip();
    zip.addFile('adir/', Buffer.alloc(0));                          // 目录条目 → isDirectory 跳过(121,138,159)
    zip.addFile('SKILL.md', Buffer.from('---\ndescription: x\n---\nb')); // 根级、无 name → prefix='' → null 臂(153)+fallback(154)
    zip.addFile('empty.txt', Buffer.alloc(0));                      // size 0 → e.header?.size || 0 的 ||0 臂(126)
    const buf = multipart('Bz', 'Bundle.zip', zip.toBuffer());
    const { skillName, files } = await parseSkillUpload(buf, 'Bz', WINDOWS_RESERVED);
    assert.equal(skillName, 'Bundle', '根级无名 → 回落 zip 文件名(去扩展名)');
    const rels = files.map((f) => f.relPath);
    assert.ok(rels.includes('SKILL.md'));
    assert.ok(rels.includes('empty.txt'));
    assert.ok(!rels.some((r) => r.endsWith('/')), '目录条目不应写入');
  });

  it('zip 中位于 skillRoot 之外的文件被丢弃(line 160 skip 臂)', async () => {
    const zip = new AdmZip();
    zip.addFile('root/SKILL.md', Buffer.from('---\nname: nested-ok\n---\n')); // 根 prefix = root/
    zip.addFile('root/keep.txt', Buffer.from('keep'));
    zip.addFile('sibling/outside.txt', Buffer.from('drop'));                  // 不在 root/ 下 → 跳过
    const buf = multipart('Bx', 'pkg.zip', zip.toBuffer());
    const { skillName, files } = await parseSkillUpload(buf, 'Bx', WINDOWS_RESERVED);
    assert.equal(skillName, 'nested-ok');
    const rels = files.map((f) => f.relPath);
    assert.ok(rels.includes('keep.txt'));
    assert.ok(rels.includes('SKILL.md'));
    assert.ok(!rels.some((r) => r.includes('outside')), 'skillRoot 之外的文件应被丢弃');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('writeSkillFiles 残余分支', () => {
  it('mkdir 抛非 EEXIST 错误(EACCES)时原样重抛(line 197 false→198)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ccv-branch-skills-eacces-'));
    try {
      chmodSync(root, 0o500); // 只读：mkdirSync(root,{recursive}) 不报错(已存在)，但 mkdirSync(targetDir) → EACCES
      assert.throws(
        () => writeSkillFiles(root, 'newskill', [{ relPath: 'SKILL.md', data: Buffer.from('x') }]),
        (e) => e.code === 'EACCES' && e.status === undefined,
        '非 EEXIST 错误应原样重抛，不带 status',
      );
    } finally {
      chmodSync(root, 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('解析出的 relPath 逃逸出 targetDir 时被 continue 跳过(line 204)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ccv-branch-skills-esc-'));
    try {
      const targetDir = writeSkillFiles(root, 'okskill', [
        { relPath: '../../escape-me.txt', data: Buffer.from('owned') }, // 逃逸 → continue
        { relPath: 'good.txt', data: Buffer.from('ok') },               // 正常写入
      ]);
      assert.equal(existsSync(join(targetDir, 'good.txt')), true);
      assert.equal(existsSync(join(root, '..', '..', 'escape-me.txt')), false, '逃逸文件不应被写出');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('importSkillTo 残余分支', () => {
  it('请求缺少 content-type 头 → || \'\' 臂(216)，最终 400 Invalid boundary', async () => {
    const req = new EventEmitter();
    req.headers = {}; // 无 content-type → req.headers['content-type'] || ''
    req.destroy = () => {};
    const { res, done } = makeRes();
    importSkillTo(req, res, { skillsRoot: join(tmpDir, 'skills'), windowsReserved: WINDOWS_RESERVED });
    const out = await done;
    assert.equal(out.status, 400);
    assert.equal(out.data.error, 'Invalid boundary');
  });

  it('writeSkillFiles 抛无 status 错误(EACCES) → status||500 + >=500 脱敏 server_error', async () => {
    // skillsRoot 设为只读目录：parse 成功 → writeSkillFiles 抛 EACCES(无 status) →
    // err?.status || 500 (254) → status>=500 (255 真臂) → server_error 臂(257)。
    const roRoot = mkdtempSync(join(tmpdir(), 'ccv-branch-skills-imp-eacces-'));
    chmodSync(roRoot, 0o500);
    const boundary = 'Bimp';
    const req = new EventEmitter();
    req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    req.destroy = () => {};
    const { res, done } = makeRes();
    try {
      importSkillTo(req, res, { skillsRoot: roRoot, windowsReserved: WINDOWS_RESERVED });
      req.emit('data', multipart(boundary, 'imp-skill.md', '---\nname: imp-skill\n---\nbody'));
      req.emit('end');
      const out = await done;
      assert.equal(out.status, 500);
      assert.equal(out.data.error, 'server_error', '5xx 应脱敏为 server_error');
      assert.equal(out.data.code, 'EACCES');
    } finally {
      chmodSync(roRoot, 0o700);
      rmSync(roRoot, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('稳定性', () => {
  it('waitUntil 助手可用（轮询不依赖固定 sleep）', async () => {
    let flag = false;
    setTimeout(() => { flag = true; }, 20);
    await waitUntil(() => flag, { timeout: 1000, interval: 5 });
    assert.equal(flag, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// skillsDelete 路由 + toggle 的 DUPLICATE 臂（删除是不可逆操作，按仓库 ≥95% 分支约定补齐）。
describe('skillsDelete 路由 + toggle DUPLICATE 臂', () => {
  function postDelete(bodyStr, isLocal = true) {
    const handler = routeHandler('POST', '/api/skills/delete');
    const req = new EventEmitter();
    req.destroy = () => {};
    const { res, done } = makeRes();
    handler(req, res, { pathname: '/api/skills/delete' }, isLocal, {});
    req.emit('data', Buffer.from(bodyStr));
    req.emit('end');
    return done;
  }
  function postToggle(bodyStr) {
    const handler = routeHandler('POST', '/api/skills/toggle');
    const req = new EventEmitter();
    req.destroy = () => {};
    const { res, done } = makeRes();
    handler(req, res, { pathname: '/api/skills/toggle' }, true, {});
    req.emit('data', Buffer.from(bodyStr));
    req.emit('end');
    return done;
  }
  function mkSkill(dir, name, desc) {
    const d = join(PROJ, '.claude', dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SKILL.md'), `---\ndescription: ${desc}\n---\n`);
    return d;
  }

  it('!isLocal → 403 Loopback only（不可逆删除不暴露局域网）', async () => {
    const out = await postDelete(JSON.stringify({ source: 'project', name: 'whatever', enabled: true }), false);
    assert.equal(out.status, 403);
    assert.equal(out.data.error, 'Loopback only');
  });

  it('删除已禁用项 → 200 + 目录被永久移除', async () => {
    const d = mkSkill('skills-skip', 'route-del-off', 'x');
    const out = await postDelete(JSON.stringify({ source: 'project', name: 'route-del-off', enabled: false }));
    assert.equal(out.status, 200);
    assert.equal(out.data.ok, true);
    assert.equal(existsSync(d), false);
  });

  it('不存在 → 404 NOT_FOUND', async () => {
    const out = await postDelete(JSON.stringify({ source: 'project', name: 'route-del-absent', enabled: true }));
    assert.equal(out.status, 404);
    assert.equal(out.data.code, 'NOT_FOUND');
  });

  it('非法 source（builtin）→ 400 INVALID_SOURCE', async () => {
    const out = await postDelete(JSON.stringify({ source: 'builtin', name: 'simplify', enabled: true }));
    assert.equal(out.status, 400);
    assert.equal(out.data.code, 'INVALID_SOURCE');
  });

  it('toggle 同名在 skills/ 与 skills-skip/ 各一份 → 409 DUPLICATE', async () => {
    mkSkill('skills', 'route-dup-tog', 'a');
    mkSkill('skills-skip', 'route-dup-tog', 'b');
    const out = await postToggle(JSON.stringify({ source: 'project', name: 'route-dup-tog', enable: false }));
    assert.equal(out.status, 409);
    assert.equal(out.data.code, 'DUPLICATE');
  });
});
