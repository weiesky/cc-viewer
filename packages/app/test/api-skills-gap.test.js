// skills 路由覆盖补缺：补 test/skills-import.test.js（只测 parseSkillUpload/writeSkillFiles 核心）
// 未触达的 HTTP 路由层。目标缺口（c8）：
//   - skillsList（成功 200 / listSkills 抛错→500）：7-16
//   - skillsToggle（成功 200 + 各错误码→HTTP 状态映射 + JSON.parse 失败→500）：20-45
//   - importSkillTo（boundary 缺失/超长→400 / content-length 超限→413 / 流式累计超限→413 abort /
//                    成功 200 / parse 抛 4xx→映射 / 5xx→脱敏 server_error）：198-262
//   - skillsImport（注入 ~/.claude/skills 作为 root）：265-270
//   - parseSkillUpload 边界：md 无 frontmatter → 回落文件名（fallbackBaseName）：63-65,87-88
// 路由范式：在 import 前设 CLAUDE_CONFIG_DIR / CCV_PROJECT_DIR 隔离；req 用 EventEmitter，res 收集回包。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-skills-gap-'));
process.env.CLAUDE_CONFIG_DIR = tmpDir;       // getClaudeConfigDir → tmpDir
process.env.CCV_PROJECT_DIR = join(tmpDir, 'proj');
mkdirSync(process.env.CCV_PROJECT_DIR, { recursive: true });

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

let skillsRoutes, importSkillTo, parseSkillUpload;

before(async () => {
  const mod = await import('../server/routes/skills.js');
  skillsRoutes = mod.skillsRoutes;
  importSkillTo = mod.importSkillTo;
  parseSkillUpload = mod.parseSkillUpload;
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function routeHandler(method, path) {
  const r = skillsRoutes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

// 同步收集回包；handler 可能在 req 'end' 后异步 end()，故返回一个在 res.end 时 resolve 的 promise。
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
function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

function multipart(boundary, filename, fileData) {
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData), tail]);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/skills (skillsList)', () => {
  it('returns 200 with ok:true and a skills array (builtins always present)', async () => {
    const handler = routeHandler('GET', '/api/skills');
    const { res, done } = makeRes();
    handler({}, res, { pathname: '/api/skills' }, true, {});
    const out = await done;
    assert.equal(out.status, 200);
    assert.equal(out.data.ok, true);
    assert.ok(Array.isArray(out.data.skills));
    assert.ok(out.data.skills.length >= 1, 'builtin skills should be listed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/skills/toggle (skillsToggle)', () => {
  const handler = () => routeHandler('POST', '/api/skills/toggle');

  function postToggle(bodyStr) {
    const req = new EventEmitter();
    const { res, done } = makeRes();
    handler()(req, res, { pathname: '/api/skills/toggle' }, true, {});
    req.emit('data', Buffer.from(bodyStr));
    req.emit('end');
    return done;
  }

  // 注意：moveSkill 的 source:'user' 走真实 homedir()/.claude，无法在测试里安全隔离；
  // 故 toggle 成功路径用 source:'project'（base = CCV_PROJECT_DIR/.claude，可控）。
  const projSkills = join(process.env.CCV_PROJECT_DIR, '.claude', 'skills');
  beforeEach(() => {
    const sk = join(projSkills, 'toggle-me');
    mkdirSync(sk, { recursive: true });
    writeFileSync(join(sk, 'SKILL.md'), '---\nname: toggle-me\n---\n');
  });

  it('200 ok when disabling an existing project skill (moves skills→skills-skip)', async () => {
    const out = await postToggle(JSON.stringify({ source: 'project', name: 'toggle-me', enable: false }));
    assert.equal(out.status, 200);
    assert.equal(out.data.ok, true);
    assert.equal(existsSync(join(projSkills, 'toggle-me')), false);
    assert.equal(existsSync(join(process.env.CCV_PROJECT_DIR, '.claude', 'skills-skip', 'toggle-me')), true);
  });

  it('404 SOURCE_MISSING when the named skill does not exist', async () => {
    const out = await postToggle(JSON.stringify({ source: 'project', name: 'no-such-skill', enable: false }));
    assert.equal(out.status, 404);
    assert.equal(out.data.code, 'SOURCE_MISSING');
  });

  it('400 INVALID_NAME for a path-traversal name', async () => {
    const out = await postToggle(JSON.stringify({ source: 'project', name: '../escape', enable: false }));
    assert.equal(out.status, 400);
    assert.equal(out.data.code, 'INVALID_NAME');
  });

  it('400 INVALID_SOURCE for a plugin/builtin source', async () => {
    const out = await postToggle(JSON.stringify({ source: 'builtin', name: 'whatever', enable: false }));
    assert.equal(out.status, 400);
    assert.equal(out.data.code, 'INVALID_SOURCE');
  });

  it('500 with unknown code when the body is not valid JSON', async () => {
    const out = await postToggle('{ not json');
    assert.equal(out.status, 500);
    assert.equal(out.data.code, 'unknown');
  });

  it('destroys the request when the body exceeds 4096 bytes', async () => {
    const handlerFn = handler();
    const req = new EventEmitter();
    let destroyed = false;
    req.destroy = () => { destroyed = true; };
    const { res } = makeRes();
    handlerFn(req, res, { pathname: '/api/skills/toggle' }, true, {});
    req.emit('data', Buffer.alloc(5000, 0x61)); // > 4096
    assert.equal(destroyed, true, 'oversized toggle body should trigger req.destroy()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/skills/import (skillsImport → importSkillTo into ~/.claude/skills)', () => {
  const handler = () => routeHandler('POST', '/api/skills/import');
  const boundary = 'BND-skills-12345';

  function postImport({ headers, chunks, filename, fileData }) {
    const req = new EventEmitter();
    req.headers = headers || { 'content-type': `multipart/form-data; boundary=${boundary}` };
    req.destroy = () => { req.emit('close'); };
    const { res, done } = makeRes();
    handler()(req, res, { pathname: '/api/skills/import' }, true, { WINDOWS_RESERVED_NAMES: WINDOWS_RESERVED });
    const body = chunks || [multipart(boundary, filename, fileData)];
    for (const c of body) req.emit('data', c);
    req.emit('end');
    return done;
  }

  it('400 when the boundary is missing from content-type', async () => {
    const out = await postImport({ headers: { 'content-type': 'multipart/form-data' }, chunks: [] });
    assert.equal(out.status, 400);
    assert.equal(out.data.error, 'Invalid boundary');
  });

  it('400 when the boundary is absurdly long (>200 chars)', async () => {
    const long = 'x'.repeat(250);
    const out = await postImport({ headers: { 'content-type': `multipart/form-data; boundary=${long}` }, chunks: [] });
    assert.equal(out.status, 400);
    assert.equal(out.data.error, 'Invalid boundary');
  });

  it('413 when content-length declares more than 100MB up front', async () => {
    const out = await postImport({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(101 * 1024 * 1024) },
      chunks: [],
    });
    assert.equal(out.status, 413);
    assert.match(out.data.error, /too large/i);
  });

  it('200 imports a SKILL.md into ~/.claude/skills and returns name + path', async () => {
    const md = '---\nname: imported-md-skill\n---\nbody';
    const out = await postImport({ filename: 'imported-md-skill.md', fileData: md });
    assert.equal(out.status, 200);
    assert.equal(out.data.ok, true);
    assert.equal(out.data.name, 'imported-md-skill');
    const onDisk = join(tmpDir, 'skills', 'imported-md-skill', 'SKILL.md');
    assert.equal(existsSync(onDisk), true);
    assert.equal(readFileSync(onDisk, 'utf8'), md);
  });

  it('415 for an unsupported file type (parse throws INVALID_TYPE)', async () => {
    const out = await postImport({ filename: 'notes.txt', fileData: 'hello' });
    assert.equal(out.status, 415);
    assert.equal(out.data.code, 'INVALID_TYPE');
  });

  it('400 for a malformed multipart body (no header terminator)', async () => {
    // 直接发一段没有 \r\n\r\n 的裸数据 → parseSkillUpload headerEnd===-1 → status 400
    const out = await postImport({ chunks: [Buffer.from('garbage-no-multipart-header')] });
    assert.equal(out.status, 400);
  });

  it('409 EXISTS when the target skill dir already present (writeSkillFiles atomic mkdir)', async () => {
    // 预置同名目录 → mkdir(targetDir) 抛 EEXIST → status 409
    mkdirSync(join(tmpDir, 'skills', 'dup-skill'), { recursive: true });
    const md = '---\nname: dup-skill\n---\nx';
    const out = await postImport({ filename: 'dup-skill.md', fileData: md });
    assert.equal(out.status, 409);
    assert.equal(out.data.code, 'EXISTS');
  });

  it('413 and aborts mid-stream when accumulated chunks exceed 100MB', async () => {
    // 用真实 100MB+ buffer 代价过高；改为直接驱动 importSkillTo + 一个能在 >100MB 时触发的分块流。
    // 这里构造 content-length 缺失但流式累计超限：发两块各 60MB 的 buffer。
    const req = new EventEmitter();
    req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    let destroyed = false;
    req.destroy = () => { destroyed = true; };
    const { res, done } = makeRes();
    importSkillTo(req, res, { skillsRoot: join(tmpDir, 'skills'), windowsReserved: WINDOWS_RESERVED });
    req.emit('data', Buffer.alloc(60 * 1024 * 1024));
    req.emit('data', Buffer.alloc(60 * 1024 * 1024)); // 累计 120MB > 100MB → 413 + destroy
    const out = await done;
    assert.equal(out.status, 413);
    assert.equal(destroyed, true, 'stream should be destroyed once over the cap');
    // end 后 aborted 应短路，不再二次回包
    req.emit('end');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('parseSkillUpload fallback name branches', () => {
  it('md without frontmatter falls back to the filename (stripExt)', async () => {
    const boundary = 'b1';
    const buf = multipart(boundary, 'PlainNote.md', 'no frontmatter here, just body text');
    const { skillName, files } = await parseSkillUpload(buf, boundary, WINDOWS_RESERVED);
    assert.equal(skillName, 'PlainNote', 'falls back to base filename without extension');
    assert.deepEqual(files.map((f) => f.relPath), ['SKILL.md']);
  });

  it('zip whose SKILL.md has no name uses the zip root dir name as the skill name', async () => {
    const zip = new AdmZip();
    zip.addFile('rooted-skill/SKILL.md', Buffer.from('no frontmatter\nbody'));
    zip.addFile('rooted-skill/extra.txt', Buffer.from('aux'));
    const boundary = 'b2';
    const buf = multipart(boundary, 'archive.zip', zip.toBuffer());
    const { skillName, files } = await parseSkillUpload(buf, boundary, WINDOWS_RESERVED);
    assert.equal(skillName, 'rooted-skill', 'root dir name used when frontmatter name absent');
    assert.ok(files.some((f) => f.relPath === 'SKILL.md'));
    assert.ok(files.some((f) => f.relPath === 'extra.txt'));
  });

  it('rejects a Windows reserved device filename with 400', async () => {
    const boundary = 'b3';
    const buf = multipart(boundary, 'CON.md', '---\nname: con-skill\n---\n');
    await assert.rejects(
      () => parseSkillUpload(buf, boundary, WINDOWS_RESERVED),
      (e) => e.status === 400 && /Reserved/.test(e.message),
    );
  });
});
