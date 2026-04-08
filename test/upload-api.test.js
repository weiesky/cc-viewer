import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Unit tests for the multipart upload parsing logic extracted from server.js.
 * We test the parsing + file-saving logic directly without starting an HTTP server.
 */

// Replicate the server-side parsing logic as a testable function
function parseAndSaveUpload(buf, boundary, uploadDir) {
  const MAX_UPLOAD = 50 * 1024 * 1024;
  if (buf.length > MAX_UPLOAD) throw new Error('File too large (max 50MB)');

  const headerEnd = buf.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('Malformed multipart');
  const headerStr = buf.slice(0, headerEnd).toString();
  const nameMatch = headerStr.match(/filename="([^"]+)"/);
  if (!nameMatch) throw new Error('No filename');
  const originalName = nameMatch[1].replace(/[/\\]/g, '_');
  const bodyStart = headerEnd + 4;
  const closingBoundary = Buffer.from('\r\n--' + boundary);
  const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
  const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);

  mkdirSync(uploadDir, { recursive: true });
  const ts = Date.now();
  const dotIdx = originalName.lastIndexOf('.');
  const uniqueName = dotIdx > 0
    ? `${originalName.slice(0, dotIdx)}-${ts}${originalName.slice(dotIdx)}`
    : `${originalName}-${ts}`;
  const savePath = join(uploadDir, uniqueName);
  writeFileSync(savePath, fileData);
  return { ok: true, path: savePath, originalName, uniqueName };
}

function buildMultipart(boundary, filename, content) {
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([Buffer.from(header), Buffer.from(content), Buffer.from(footer)]);
}

function makeTmpDir() {
  const dir = join(tmpdir(), `ccv-upload-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('upload API parsing', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('parses multipart and saves file with unique name', () => {
    const boundary = '----TestBoundary123';
    const buf = buildMultipart(boundary, 'hello.txt', 'file content here');
    const result = parseAndSaveUpload(buf, boundary, dir);

    assert.equal(result.ok, true);
    assert.equal(result.originalName, 'hello.txt');
    assert.ok(result.uniqueName.startsWith('hello-'));
    assert.ok(result.uniqueName.endsWith('.txt'));
    assert.equal(readFileSync(result.path, 'utf-8'), 'file content here');
  });

  it('generates unique names for same file uploaded twice', async () => {
    const boundary = '----TestBoundary456';
    const buf1 = buildMultipart(boundary, 'dup.png', 'data1');
    const r1 = parseAndSaveUpload(buf1, boundary, dir);
    // ensure different timestamp
    await new Promise(r => setTimeout(r, 5));
    const buf2 = buildMultipart(boundary, 'dup.png', 'data2');
    const r2 = parseAndSaveUpload(buf2, boundary, dir);

    assert.notEqual(r1.path, r2.path);
    assert.equal(readFileSync(r1.path, 'utf-8'), 'data1');
    assert.equal(readFileSync(r2.path, 'utf-8'), 'data2');
    assert.equal(readdirSync(dir).length, 2);
  });

  it('sanitizes path separators in filename', () => {
    const boundary = '----TestBoundary789';
    const buf = buildMultipart(boundary, '../etc/passwd', 'nope');
    const result = parseAndSaveUpload(buf, boundary, dir);

    assert.ok(!result.originalName.includes('/'));
    assert.ok(!result.originalName.includes('\\'));
  });

  it('throws on malformed multipart (no header end)', () => {
    const buf = Buffer.from('garbage data without headers');
    assert.throws(() => parseAndSaveUpload(buf, 'boundary', dir), /Malformed multipart/);
  });

  it('throws on missing filename', () => {
    const buf = Buffer.from('--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\ndata\r\n--boundary--');
    assert.throws(() => parseAndSaveUpload(buf, 'boundary', dir), /No filename/);
  });

  it('handles filename without extension', () => {
    const boundary = '----TestNoExt';
    const buf = buildMultipart(boundary, 'Makefile', 'all: build');
    const result = parseAndSaveUpload(buf, boundary, dir);

    assert.ok(result.uniqueName.startsWith('Makefile-'));
    assert.equal(readFileSync(result.path, 'utf-8'), 'all: build');
  });

  it('handles binary content', () => {
    const boundary = '----TestBinary';
    const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const buf = Buffer.concat([Buffer.from(header), binaryData, Buffer.from(footer)]);
    const result = parseAndSaveUpload(buf, boundary, dir);

    const saved = readFileSync(result.path);
    assert.deepStrictEqual(saved, binaryData);
  });
});
