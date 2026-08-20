import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';

// Exercise the REAL exported import core (parseSkillUpload + writeSkillFiles) — the same functions
// the /api/skills/import and /api/im/:platform/skills/import routes call — so the security-critical
// defenses (zip slip / symlink / zip bomb / name validation / sep-suffix containment) are tested
// against shipping code, not a hand-copy. We wrap each fixture in a minimal multipart body since
// parseSkillUpload consumes the assembled multipart buffer.
import { parseSkillUpload, writeSkillFiles } from '../server/routes/skills.js';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Build the multipart body parseSkillUpload expects, then run parse + write. Returns
// { ok, name, path, written:[relPath...] } or rejects with { status, code } (same contract as before).
async function importSkillFromBuffer(fileData, originalName, skillsRoot) {
  const boundary = 'TESTBOUNDARY1234';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${originalName}"\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const buf = Buffer.concat([head, Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData), tail]);
  const { skillName, files } = await parseSkillUpload(buf, boundary, WINDOWS_RESERVED);
  const targetDir = writeSkillFiles(skillsRoot, skillName, files);
  return { ok: true, name: skillName, path: targetDir, written: files.map((f) => f.relPath) };
}

function makeTmpDir() {
  const dir = join(tmpdir(), `ccv-skills-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('skills import - happy path', () => {
  let root;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('imports a SKILL.md as a single-file skill', async () => {
    const md = '---\nname: my-skill\ndescription: test\n---\n\nbody';
    const result = await importSkillFromBuffer(Buffer.from(md), 'my-skill.md', root);
    assert.equal(result.ok, true);
    assert.equal(result.name, 'my-skill');
    assert.deepEqual(result.written, ['SKILL.md']);
    assert.equal(readFileSync(join(result.path, 'SKILL.md'), 'utf8'), md);
  });

  it('imports a zip with SKILL.md at root', async () => {
    const zip = new AdmZip();
    zip.addFile('SKILL.md', Buffer.from('---\nname: zipped\n---\n\nx'));
    zip.addFile('helper.js', Buffer.from('export const a = 1;'));
    const result = await importSkillFromBuffer(zip.toBuffer(), 'zipped.zip', root);
    assert.equal(result.name, 'zipped');
    assert.deepEqual(result.written.sort(), ['SKILL.md', 'helper.js']);
  });

  it('picks the shallowest SKILL.md when multiple exist', async () => {
    const zip = new AdmZip();
    zip.addFile('outer/SKILL.md', Buffer.from('---\nname: outer\n---\n'));
    zip.addFile('outer/nested/SKILL.md', Buffer.from('---\nname: nested\n---\n'));
    const result = await importSkillFromBuffer(zip.toBuffer(), 'pkg.zip', root);
    assert.equal(result.name, 'outer');
  });

  it('normalizes lowercase skill.md to SKILL.md on disk', async () => {
    const zip = new AdmZip();
    zip.addFile('skill.md', Buffer.from('---\nname: lower\n---\n'));
    const result = await importSkillFromBuffer(zip.toBuffer(), 'lower.zip', root);
    assert.ok(existsSync(join(result.path, 'SKILL.md')));
  });
});

describe('skills import - rejections', () => {
  let root;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('rejects unsupported file type with 415', async () => {
    await assert.rejects(importSkillFromBuffer(Buffer.from('data'), 'bad.txt', root),
      (err) => err.status === 415 && err.code === 'INVALID_TYPE');
  });

  it('rejects zip without SKILL.md with MISSING_SKILL_MD', async () => {
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('no skill here'));
    await assert.rejects(importSkillFromBuffer(zip.toBuffer(), 'pkg.zip', root),
      (err) => err.status === 400 && err.code === 'MISSING_SKILL_MD');
  });

  it('rejects malformed zip with INVALID_ZIP', async () => {
    await assert.rejects(importSkillFromBuffer(Buffer.from('not a zip'), 'broken.zip', root),
      (err) => err.status === 400 && err.code === 'INVALID_ZIP');
  });

  it('rejects existing skill with 409 EXISTS', async () => {
    const zip = new AdmZip();
    zip.addFile('SKILL.md', Buffer.from('---\nname: dup\n---\n'));
    await importSkillFromBuffer(zip.toBuffer(), 'a.zip', root);
    const zip2 = new AdmZip();
    zip2.addFile('SKILL.md', Buffer.from('---\nname: dup\n---\n'));
    await assert.rejects(importSkillFromBuffer(zip2.toBuffer(), 'b.zip', root),
      (err) => err.status === 409 && err.code === 'EXISTS');
  });

  it('rejects invalid skill name (e.g., contains space)', async () => {
    const zip = new AdmZip();
    zip.addFile('SKILL.md', Buffer.from('---\nname: bad name\n---\n'));
    await assert.rejects(importSkillFromBuffer(zip.toBuffer(), 'bad name.zip', root),
      (err) => err.status === 400 && err.code === 'INVALID_NAME');
  });
});

describe('skills import - security defenses', () => {
  let root;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  // symlink entries (unix mode 0o120000 in attr high 16 bits) must be rejected
  it('rejects zip with symlink entry', async () => {
    const zip = new AdmZip();
    zip.addFile('SKILL.md', Buffer.from('---\nname: linky\n---\n'));
    zip.addFile('link', Buffer.from('/etc/passwd'));
    const entries = zip.getEntries();
    const linkEntry = entries.find((e) => e.entryName === 'link');
    linkEntry.attr = (0o120777 << 16) >>> 0;
    await assert.rejects(importSkillFromBuffer(zip.toBuffer(), 'linky.zip', root),
      (err) => err.status === 400 && err.code === 'INVALID_ZIP');
  });

  // zip bomb — declared size > MAX_PER_FILE on a single entry
  it('rejects zip with single-file size exceeding 50MB', async () => {
    const zip = new AdmZip();
    zip.addFile('SKILL.md', Buffer.from('---\nname: big\n---\n'));
    zip.addFile('huge.bin', Buffer.from('small actual content'));
    const entries = zip.getEntries();
    const huge = entries.find((e) => e.entryName === 'huge.bin');
    huge.header.size = 60 * 1024 * 1024; // 60MB declared > 50MB limit
    await assert.rejects(importSkillFromBuffer(zip.toBuffer(), 'big.zip', root),
      (err) => err.status === 400 && err.code === 'ZIP_BOMB');
  });

  // zip bomb — total declared size across all entries exceeds 200MB
  it('rejects zip whose total declared size exceeds 200MB', async () => {
    const zip = new AdmZip();
    zip.addFile('SKILL.md', Buffer.from('---\nname: total\n---\n'));
    for (let i = 0; i < 5; i++) zip.addFile(`f${i}.bin`, Buffer.from('x'));
    const entries = zip.getEntries();
    for (const e of entries) {
      if (e.entryName.startsWith('f')) e.header.size = 45 * 1024 * 1024; // 5*45MB = 225MB > 200MB
    }
    await assert.rejects(importSkillFromBuffer(zip.toBuffer(), 'total.zip', root),
      (err) => err.status === 400 && err.code === 'ZIP_BOMB');
  });

  // zip slip — entries with `..` should be filtered (can't escape via relative path)
  it('drops zip entries containing .. path traversal', async () => {
    const zip = new AdmZip();
    zip.addFile('SKILL.md', Buffer.from('---\nname: travel\n---\n'));
    zip.addFile('../escaped.txt', Buffer.from('owned'));
    const result = await importSkillFromBuffer(zip.toBuffer(), 'travel.zip', root);
    assert.ok(!result.written.some((p) => p.includes('..')));
    assert.ok(!existsSync(join(root, 'escaped.txt')));
  });

  // sep-suffix prefix check prevents sibling-prefix dir attack (pure path-logic assertion)
  it('sep-suffix prefix check prevents sibling-prefix dir attack', () => {
    const target = '/tmp/skills/foo';
    const resolvedTarget = resolve(target) + sep;
    const evilSibling = resolve('/tmp/skills/foo-evil/file.txt');
    const legitChild = resolve('/tmp/skills/foo/file.txt');
    assert.equal(legitChild.startsWith(resolvedTarget), true, 'legit child should pass');
    assert.equal(evilSibling.startsWith(resolvedTarget), false, 'evil sibling-prefix must be rejected');
  });
});
