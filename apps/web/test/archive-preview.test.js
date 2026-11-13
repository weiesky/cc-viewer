import './_shims/register.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { TextEncoder } from 'node:util';
import JSZip from 'jszip';
const { listArchive, readEntry, readEntryText, buildTree, resetBudget } = await import('../src/vendor/archive/index.js');
const { parseZip } = await import('../src/vendor/archive/zip.js');
const { parseTar } = await import('../src/vendor/archive/tar.js');
const { classifyContent, decodeTextBytes, decodeFileName, normalizeEntryPath } = await import('../src/vendor/archive/util.js');
const { detect } = await import('../src/vendor/archive/detect.js');
const { getArchivePreviewKind, flattenArchiveTree, archiveEntryStatus, isArchiveEntrySelected, shouldShowArchiveNotices } = await import('../src/utils/archivePreview.js');

const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);

function tarEntry(path, content, { type = '0', size } = {}) {
  const data = typeof content === 'string' ? bytes(content) : content;
  const block = new Uint8Array(512);
  block.set(bytes(path));
  block.set(bytes('0000644\0'), 100);
  block.set(bytes('0000000\0'), 108);
  block.set(bytes('0000000\0'), 116);
  block.set(bytes(`${(size ?? data.length).toString(8).padStart(11, '0')}\0`), 124);
  block.set(bytes('00000000000\0'), 136);
  block.set(bytes('        '), 148);
  block[156] = type.charCodeAt(0);
  block.set(bytes('ustar\0'), 257);
  block.set(bytes('00'), 263);
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  block.set(bytes(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
  const padding = new Uint8Array((512 - data.length % 512) % 512);
  return new Uint8Array([...block, ...data, ...padding]);
}

function tar(...entries) {
  const size = entries.reduce((sum, entry) => sum + entry.length, 1024);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const entry of entries) { out.set(entry, offset); offset += entry.length; }
  return out;
}

describe('archive entry rendering decisions', () => {
  it('never renders partial or CRC-failed images', () => {
    assert.equal(archiveEntryStatus({ textualHint: 'image', truncated: true }), 'binary');
    assert.equal(archiveEntryStatus({ textualHint: 'image', truncated: false, crcOk: false }), 'binary');
    assert.equal(archiveEntryStatus({ textualHint: 'image', truncated: false, crcOk: true }), 'image');
  });

  it('does not select entry-less implicit directories', () => {
    assert.equal(isArchiveEntrySelected(null, null), false);
    const entry = {};
    assert.equal(isArchiveEntrySelected(entry, entry), true);
  });

  it('shows row and node truncation independently of parser notes', () => {
    assert.equal(shouldShowArchiveNotices({ notes: [], truncated: false }, { truncated: true }), true);
    assert.equal(shouldShowArchiveNotices({ notes: [], truncated: false }, { truncated: false }, true), true);
    const entries = Array.from({ length: 2500 }, (_, i) => ({ path: `file-${i}.txt`, dir: false }));
    const first = flattenArchiveTree(buildTree(entries), new Set());
    const next = flattenArchiveTree(buildTree(entries), new Set(), 4000);
    assert.equal(first.rows.length, 2000);
    assert.equal(first.truncated, true);
    assert.equal(next.rows.length, 2500);
    assert.equal(next.truncated, false);
    const deepEntries = Array.from({ length: 4000 }, (_, i) => ({ path: `root-${i}/a/b/c/d/file.txt`, dir: false }));
    assert.equal(buildTree(deepEntries).truncated, true);
  });

  it('caps entry-name splitting and extended-header payload work', () => {
    assert.equal(normalizeEntryPath('/'.repeat(1024 * 1024)).unsafe, true);
    const hugeMetadata = tar(tarEntry('PaxHeader', new Uint8Array(1024 * 1024), { type: 'x' }));
    assert.throws(() => parseTar(hugeMetadata), error => error.code === 'BAD_TAR');
  });
});

describe('archive format routing and detection', () => {
  it('recognizes supported and unsupported names across path styles', () => {
    assert.deepEqual(getArchivePreviewKind('folder/a.ZIP'), { supported: true, format: 'zip' });
    assert.deepEqual(getArchivePreviewKind('C:\\tmp\\a.tar.gz'), { supported: true, format: 'tar.gz' });
    assert.deepEqual(getArchivePreviewKind('//server/a.tgz'), { supported: true, format: 'tar.gz' });
    assert.deepEqual(getArchivePreviewKind('a.gz'), { supported: true, format: 'gzip' });
    assert.deepEqual(getArchivePreviewKind('a.7z'), { supported: false, format: '7z' });
    assert.deepEqual(getArchivePreviewKind('a.tar.bz2'), { supported: false, format: 'bz2' });
    assert.deepEqual(getArchivePreviewKind('a.txz'), { supported: false, format: 'xz' });
    assert.deepEqual(getArchivePreviewKind('a.tbz'), { supported: false, format: 'bz2' });
    assert.deepEqual(getArchivePreviewKind('a.tbz2'), { supported: false, format: 'bz2' });
    for (const name of ['a.txt', 'a.docx', 'a.jar', 'a.epub', 'a.pdf']) assert.equal(getArchivePreviewKind(name), null);
  });

  it('uses magic before extension', () => {
    assert.equal(detect(new Uint8Array([0x1f, 0x8b, 8]), 'wrong.zip').format, 'gzip');
    assert.equal(detect(new Uint8Array([0x50, 0x4b, 3, 4]), 'wrong.gz').format, 'zip');
  });
});

describe('ZIP and text entry preview', () => {
  it('lists stored and deflated ZIP entries and reads nested text', async () => {
    const zip = new JSZip();
    zip.file('docs/', null, { dir: true });
    zip.file('docs/hello.txt', 'Hello archive');
    zip.file('empty.bin', new Uint8Array([0, 1, 2]));
    const input = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    const listed = await listArchive(input, { filename: 'sample.zip' });
    assert.equal(listed.format, 'zip');
    assert.equal(listed.entries.find(e => e.path === 'docs').dir, true);
    const text = await readEntryText(input, listed.entries.find(e => e.path === 'docs/hello.txt'));
    assert.equal(text.text, 'Hello archive');
    const binary = await readEntry(input, listed.entries.find(e => e.path === 'empty.bin'));
    assert.equal(binary.textualHint, 'binary');
  });

  it('bounds text output without permanently consuming later selections', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'a'.repeat(1024));
    zip.file('b.txt', 'second');
    const input = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
    const listed = await listArchive(input);
    for (let i = 0; i < 10; i++) {
      const result = await readEntryText(input, listed.entries[0], { textMaxBytes: 20 });
      assert.equal(result.text.length, 20);
      assert.equal(result.truncated, true);
    }
    assert.equal((await readEntryText(input, listed.entries[1])).text, 'second');
  });
  it('preserves truncated UTF-8 text across character boundaries', async () => {
    const zip = new JSZip();
    const source = '中文'.repeat(100000);
    zip.file('utf8.txt', source);
    const input = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    const listed = await listArchive(input);
    const result = await readEntryText(input, listed.entries[0], { textMaxBytes: 200001 });
    assert.equal(result.encoding, 'utf-8');
    assert.ok(source.startsWith(result.text));
    assert.ok(result.text.length > 60000);
  });

  it('rejects malformed central-directory lengths and marks encrypted entries', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'text');
    const input = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
    const encrypted = input.slice();
    const eocd = encrypted.length - 22;
    const cd = (encrypted[eocd + 16] | (encrypted[eocd + 17] << 8) | (encrypted[eocd + 18] << 16) | (encrypted[eocd + 19] << 24)) >>> 0;
    encrypted[cd + 8] |= 1;
    const listed = await listArchive(encrypted);
    assert.equal(listed.entries[0].encrypted, true);
    await assert.rejects(readEntry(encrypted, listed.entries[0]), error => error.code === 'ENCRYPTED');
    const malformed = input.slice();
    malformed.fill(0xff, cd + 28, cd + 34);
    assert.throws(() => parseZip(malformed), error => error.code === 'BAD_ZIP');
  });

  it('supports signed GNU base-256 mtimes without weakening size validation', () => {
    const archive = tarEntry('old.txt', 'old');
    archive.fill(0xff, 136, 148);
    const encodedMtime = BigInt.asUintN(88, BigInt(-100000000));
    const mtimeHex = encodedMtime.toString(16).padStart(22, '0');
    const mtimeBytes = mtimeHex.match(/.{2}/g).map(byte => parseInt(byte, 16));
    archive.set(mtimeBytes, 136);
    archive[147] = 0x9c;
    archive.fill(0x20, 148, 156);
    const sum = archive.subarray(0, 512).reduce((total, byte) => total + byte, 0);
    archive.set(bytes(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
    const result = parseTar(archive);
    assert.equal(result.entries[0].mtime, null);
  });

  it('bounds compressed deflate and gzip output', async () => {
    const zip = new JSZip();
    zip.file('large.txt', 'a'.repeat(1024 * 1024));
    const input = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    const listed = await listArchive(input);
    const result = await readEntry(input, listed.entries[0], { maxEntryBytes: 100 });
    assert.equal(result.bytes.length, 100);
    assert.equal(result.truncated, true);
    const gz = new Uint8Array(gzipSync(bytes('b'.repeat(1024 * 1024))));
    const gzList = await listArchive(gz, { filename: 'large.gz', maxTotalBytes: 100 });
    assert.equal(gzList.entries[0].size, 100);
    assert.equal(gzList.truncated, true);
  });
});

describe('TAR and GZIP preview', () => {
  it('reads ustar, directories and tar.gz', async () => {
    const input = tar(tarEntry('docs/', '', { type: '5' }), tarEntry('docs/a.txt', 'tar text'));
    const listed = await listArchive(input, { filename: 'a.tar' });
    assert.equal(listed.entries.length, 2);
    assert.equal((await readEntryText(input, listed.entries[1])).text, 'tar text');
    const gz = new Uint8Array(gzipSync(input));
    const compressed = await listArchive(gz, { filename: 'a.tgz' });
    assert.equal(compressed.format, 'tar.gz');
    assert.equal((await readEntryText(gz, compressed.entries[1])).text, 'tar text');
    assert.equal((await readEntryText(gz, compressed.entries[1])).text, 'tar text');
    resetBudget(gz);
  });

  it('supports GNU long names and local PAX paths', async () => {
    const longName = `folder/${'long'.repeat(30)}.txt`;
    const longTar = tar(tarEntry('LongLink', `${longName}\0`, { type: 'L' }), tarEntry('short', 'long'));
    const longList = await listArchive(longTar);
    assert.equal(longList.entries[0].path, longName);
    const record = bytes(`path=pax/name.txt\n`);
    const paxData = bytes(`${record.length + 3} ${new TextDecoder().decode(record)}`);
    const paxTar = tar(tarEntry('PaxHeader', paxData, { type: 'x' }), tarEntry('short', 'pax'));
    const paxList = await listArchive(paxTar);
    assert.equal(paxList.entries[0].path, 'pax/name.txt');
  });

  it('rejects negative TAR sizes without looping', () => {
    const malformed = tarEntry('x', '', { type: 'x' });
    malformed.set(bytes('-1000\0'), 124);
    const checksumBlock = malformed.subarray(0, 512);
    checksumBlock.fill(0x20, 148, 156);
    const checksum = checksumBlock.reduce((sum, byte) => sum + byte, 0);
    checksumBlock.set(bytes(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
    assert.throws(() => parseTar(malformed), error => error.code === 'BAD_TAR_SIZE');
  });

  it('previews a raw gzip payload', async () => {
    const input = new Uint8Array(gzipSync(bytes('gzip text')));
    const listed = await listArchive(input, { filename: 'note.txt.gz' });
    assert.equal(listed.format, 'gzip');
    assert.equal((await readEntryText(input, listed.entries[0])).text, 'gzip text');
  });
});

describe('hostile metadata, decoding and tree bounds', () => {
  it('sanitizes display-only paths and normalizes separators', () => {
    assert.equal(normalizeEntryPath('/absolute\\folder/file.txt').path, 'absolute/folder/file.txt');
    const traversal = normalizeEntryPath('../../secret');
    assert.equal(traversal.path, '../../secret');
    assert.equal(traversal.unsafe, true);
    assert.equal(normalizeEntryPath('a\0b').path, 'ab');
    assert.equal(normalizeEntryPath(`${'a/'.repeat(100)}file`).path.split('/').length, 64);
    assert.ok(normalizeEntryPath('a'.repeat(10000)).path.length <= 4096);
  });

  it('handles file-directory collisions independent of order and sorts iteratively', () => {
    const entries = [{ path: 'a', dir: false }, { path: 'a/b', dir: false }];
    for (const input of [entries, entries.slice().reverse()]) {
      const tree = buildTree(input);
      assert.equal(tree.children[0].dir, true);
      assert.equal(tree.children[0].children[0].path, 'a/b');
    }
    const deep = buildTree([{ path: 'a/'.repeat(100) + 'x', dir: false }]);
    assert.ok(flattenArchiveTree(deep, new Set()).rows.length <= 1);
  });

  it('decodes BOMs, detects binary and raster image magic', () => {
    assert.equal(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x61, 0])).text, 'a');
    assert.equal(decodeTextBytes(new Uint8Array([0xfe, 0xff, 0, 0x61])).text, 'a');
    assert.equal(classifyContent(new Uint8Array([0xff, 0xfe, 0x61, 0])).kind, 'text');
    assert.equal(classifyContent(bytes('BMW maintenance notes')).kind, 'text');
    assert.equal(classifyContent(new Uint8Array([0, 1, 2])).kind, 'binary');
    assert.equal(classifyContent(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).mime, 'image/png');
  });

  it('preserves large GBK text at truncation boundaries', () => {
    const truncated = new Uint8Array(200000);
    for (let i = 0; i < truncated.length; i += 8) truncated.set([0xd6, 0xd0, 0xce, 0xc4, 0xc4, 0xda, 0xc8, 0xdd], i);
    const result = decodeTextBytes(truncated, { truncated: true });
    assert.equal(result.encoding, 'gbk');
    assert.ok(!result.text.includes(String.fromCodePoint(0xfffd)));
    assert.ok(result.text.startsWith('中文内容'));
  });

  // Regression: decodeLegacyText referenced an out-of-scope `truncated` identifier,
  // so any input that was neither valid UTF-8 nor valid GBK threw ReferenceError.
  it('falls back to Latin-1 for non-UTF-8 non-GBK bytes instead of throwing', () => {
    // 0xe9 = 'é' in Latin-1, an invalid standalone UTF-8/GBK byte here.
    const latin1Bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café"
    const decoded = decodeTextBytes(latin1Bytes);
    assert.equal(decoded.encoding, 'latin1');
    assert.equal(decoded.text, 'café');
    const named = decodeFileName(latin1Bytes);
    assert.equal(named.encoding, 'latin1');
    assert.equal(named.name, 'café');
  });

  it('trims a UTF-8 multi-byte character split at the byte cap instead of misreading as GBK', () => {
    // A CJK UTF-8 subtitle cut at an arbitrary byte: the strict decode fails on the
    // partial tail, and without the trim the non-fatal GBK retry would mojibake it.
    const full = bytes('中文字幕内容'.repeat(1000));
    const cutPoint = full.length - (full.length % 3) - 1; // land mid-character
    const cut = full.subarray(0, cutPoint);
    const result = decodeTextBytes(cut, { maxBytes: cut.length, truncated: true });
    assert.equal(result.encoding, 'utf-8');
    assert.ok(result.text.startsWith('中文字幕内容'));
    assert.ok(!result.text.includes('涓')); // the GBK-mojibake tell
  });

  it('does not mislabel Latin-1 bytes as GBK when truncated', () => {
    // True single-byte Latin-1 ("café résumé"): the lossy GBK retry can decode these
    // to CJK, but interior U+FFFDs betray that it is not a truncation artifact.
    const lat1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x72, 0xe9, 0x73, 0x75, 0x6d, 0xe9]);
    assert.equal(decodeTextBytes(lat1, { truncated: true }).encoding, 'latin1');
    assert.equal(decodeTextBytes(lat1, { truncated: false }).encoding, 'latin1');
    // Clean GBK still wins under the truncated flag.
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]); // 中文
    assert.equal(decodeTextBytes(gbk, { truncated: true }).encoding, 'gbk');
  });
});
