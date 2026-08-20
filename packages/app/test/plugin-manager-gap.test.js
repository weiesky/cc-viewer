/**
 * plugin-manager-gap.test.js — covers server/lib/plugin-manager.js directly.
 *
 * The HTTP route tests (server-plugins.test.js) only reach the early validation /
 * fetch-failure branches; the download-success path (name extraction via subprocess,
 * URL/timestamp fallbacks, dedup, dir creation) is untested. Here we call the two
 * exported functions directly with a stubbed global fetch:
 *
 *   uploadPlugins:
 *     - rejects empty / non-array list (400)
 *     - creates pluginsDir if missing, writes .js/.mjs, returns count
 *     - strips directory components from name, rejects path-traversal names (400)
 *     - rejects non-.js/.mjs extensions (400)
 *     - skips entries with missing name / non-string content (counted as not written)
 *
 *   installPluginFromUrl (fetch + extract-plugin-name.mjs subprocess, both real-ish):
 *     - rejects missing url / invalid url / non-http(s) protocol (400)
 *     - 500 wrapping when fetch rejects, and when response is !ok, and when too large
 *     - uses the plugin's exported `name` (via the real subprocess extractor)
 *     - falls back to URL basename when name extraction yields nothing
 *     - falls back to plugin-<ts> for generic index.js / unnamed plugins
 *     - dedups same-name files by appending a timestamp suffix
 *
 * Stubs globalThis.fetch and restores it in after(); uses mkdtemp dirs cleaned up after.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { uploadPlugins, installPluginFromUrl } from '../server/lib/plugin-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use the REAL extractor script — it import()s the temp plugin in a subprocess.
const EXTRACT_SCRIPT = join(__dirname, '..', 'server', 'lib', 'extract-plugin-name.mjs');

let work;
const realFetch = globalThis.fetch;

before(() => { work = mkdtempSync(join(tmpdir(), 'ccv-plugin-mgr-')); });
after(() => {
  globalThis.fetch = realFetch;
  rmSync(work, { recursive: true, force: true });
});

/** Build a Response-ish stub with .ok / .status / .text(). */
function fakeResponse(text, { ok = true, status = 200 } = {}) {
  return { ok, status, async text() { return text; } };
}

describe('uploadPlugins', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(work, 'up-')); });

  it('throws 400 when fileList is not an array', () => {
    assert.throws(() => uploadPlugins(dir, null), (e) => e.statusCode === 400 && /No files/.test(e.message));
    assert.throws(() => uploadPlugins(dir, 'nope'), (e) => e.statusCode === 400);
  });

  it('throws 400 when fileList is empty', () => {
    assert.throws(() => uploadPlugins(dir, []), (e) => e.statusCode === 400);
  });

  it('creates the plugins dir when missing and writes a .js file', () => {
    const fresh = join(dir, 'nested', 'plugins');
    assert.equal(existsSync(fresh), false);
    const n = uploadPlugins(fresh, [{ name: 'p1.js', content: 'export default {}' }]);
    assert.equal(n, 1);
    assert.ok(existsSync(join(fresh, 'p1.js')));
    assert.equal(readFileSync(join(fresh, 'p1.js'), 'utf-8'), 'export default {}');
  });

  it('writes multiple .js / .mjs files and returns the written count', () => {
    const n = uploadPlugins(dir, [
      { name: 'a.js', content: '//a' },
      { name: 'b.mjs', content: '//b' },
    ]);
    assert.equal(n, 2);
    assert.ok(existsSync(join(dir, 'a.js')));
    assert.ok(existsSync(join(dir, 'b.mjs')));
  });

  it('strips leading directory components from the name before writing', () => {
    // name.replace(/.*[/\\]/, '') → basename; result has no slash so it is accepted
    const n = uploadPlugins(dir, [{ name: 'some/dir/clean.js', content: '//c' }]);
    assert.equal(n, 1);
    assert.ok(existsSync(join(dir, 'clean.js')));
    assert.equal(existsSync(join(dir, 'some')), false, 'no subdir created');
  });

  it('throws 400 for a non-.js/.mjs extension', () => {
    assert.throws(() => uploadPlugins(dir, [{ name: 'evil.txt', content: 'x' }]),
      (e) => e.statusCode === 400 && /\.js or \.mjs/.test(e.message));
  });

  it('skips entries with missing name or non-string content (not counted)', () => {
    const n = uploadPlugins(dir, [
      { name: '', content: 'x' },           // no name → skip
      { name: 'ok.js', content: 'good' },   // written
      { name: 'nostr.js', content: 123 },   // non-string content → skip
    ]);
    assert.equal(n, 1);
    assert.ok(existsSync(join(dir, 'ok.js')));
    assert.equal(existsSync(join(dir, 'nostr.js')), false);
  });

  it('throws 400 for a name that still contains ".." after basename strip', () => {
    // '..foo.js'.replace(/.*[/\\]/,'') === '..foo.js' which includes('..') → rejected
    assert.throws(() => uploadPlugins(dir, [{ name: '..foo.js', content: 'x' }]),
      (e) => e.statusCode === 400 && /Invalid file name/.test(e.message));
  });
});

describe('installPluginFromUrl — validation & fetch failures', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(work, 'inst-')); });

  it('rejects a missing URL (400)', async () => {
    await assert.rejects(() => installPluginFromUrl(dir, '', EXTRACT_SCRIPT),
      (e) => e.statusCode === 400 && /URL is required/.test(e.message));
  });

  it('rejects a malformed URL (400)', async () => {
    await assert.rejects(() => installPluginFromUrl(dir, 'not a url', EXTRACT_SCRIPT),
      (e) => e.statusCode === 400 && /Invalid URL/.test(e.message));
  });

  it('rejects a non-http(s) protocol (400)', async () => {
    await assert.rejects(() => installPluginFromUrl(dir, 'ftp://h/x.js', EXTRACT_SCRIPT),
      (e) => e.statusCode === 400 && /Invalid URL/.test(e.message));
  });

  it('wraps a fetch rejection as 500 Failed to fetch', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    await assert.rejects(() => installPluginFromUrl(dir, 'https://h/x.js', EXTRACT_SCRIPT),
      (e) => e.statusCode === 500 && /Failed to fetch: network down/.test(e.message));
  });

  it('wraps a non-ok response as 500', async () => {
    globalThis.fetch = async () => fakeResponse('', { ok: false, status: 404 });
    await assert.rejects(() => installPluginFromUrl(dir, 'https://h/x.js', EXTRACT_SCRIPT),
      (e) => e.statusCode === 500 && /HTTP 404/.test(e.message));
  });

  it('wraps an over-5MB body as 500 (File too large)', async () => {
    const huge = 'x'.repeat(5 * 1024 * 1024 + 1);
    globalThis.fetch = async () => fakeResponse(huge);
    await assert.rejects(() => installPluginFromUrl(dir, 'https://h/big.js', EXTRACT_SCRIPT),
      (e) => e.statusCode === 500 && /too large/i.test(e.message));
  });
});

describe('installPluginFromUrl — success paths (real subprocess extractor)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(work, 'ok-')); });

  it('uses the plugin exported name when extraction succeeds', async () => {
    globalThis.fetch = async () =>
      fakeResponse('export default { name: "cool-plugin", hooks: {} };');
    const { filename } = await installPluginFromUrl(dir, 'https://h/whatever.js', EXTRACT_SCRIPT);
    assert.equal(filename, 'cool-plugin.js');
    assert.ok(existsSync(join(dir, 'cool-plugin.js')));
    assert.match(readFileSync(join(dir, 'cool-plugin.js'), 'utf-8'), /cool-plugin/);
  });

  it('keeps an explicit .mjs extension exported in the name', async () => {
    globalThis.fetch = async () =>
      fakeResponse('export default { name: "thing.mjs", hooks: {} };');
    const { filename } = await installPluginFromUrl(dir, 'https://h/x.js', EXTRACT_SCRIPT);
    assert.equal(filename, 'thing.mjs');
  });

  it('falls back to the URL basename when the plugin has no name', async () => {
    globalThis.fetch = async () => fakeResponse('export default { hooks: {} };');
    const { filename } = await installPluginFromUrl(dir, 'https://h/path/my-widget.js', EXTRACT_SCRIPT);
    assert.equal(filename, 'my-widget.js');
  });

  it('ignores a generic index.js URL basename and falls back to plugin-<ts>', async () => {
    globalThis.fetch = async () => fakeResponse('export default { hooks: {} };');
    const { filename } = await installPluginFromUrl(dir, 'https://h/dir/index.js', EXTRACT_SCRIPT);
    assert.match(filename, /^plugin-\d+\.js$/);
  });

  it('falls back to plugin-<ts> when there is no usable name anywhere', async () => {
    globalThis.fetch = async () => fakeResponse('export default { hooks: {} };');
    // URL path ends with a slash → basename '' → no extension match → final fallback
    const { filename } = await installPluginFromUrl(dir, 'https://h/no-file-here/', EXTRACT_SCRIPT);
    assert.match(filename, /^plugin-\d+\.js$/);
  });

  it('dedups a same-name file by appending a timestamp suffix', async () => {
    globalThis.fetch = async () =>
      fakeResponse('export default { name: "dup", hooks: {} };');
    const first = await installPluginFromUrl(dir, 'https://h/dup.js', EXTRACT_SCRIPT);
    assert.equal(first.filename, 'dup.js');
    const second = await installPluginFromUrl(dir, 'https://h/dup.js', EXTRACT_SCRIPT);
    assert.notEqual(second.filename, 'dup.js');
    assert.match(second.filename, /^dup-\d+\.js$/);
    // both files exist on disk
    assert.equal(readdirSync(dir).filter((f) => f.startsWith('dup')).length, 2);
  });

  it('sanitizes a malicious extracted name into plugin-<ts>.js', async () => {
    // Plugin name contains a path separator → safety check rewrites to plugin-<ts>.js
    globalThis.fetch = async () =>
      fakeResponse('export default { name: "../../etc/passwd", hooks: {} };');
    const { filename } = await installPluginFromUrl(dir, 'https://h/x.js', EXTRACT_SCRIPT);
    assert.match(filename, /^plugin-\d+\.js$/);
    assert.equal(filename.includes('/'), false);
    assert.equal(filename.includes('..'), false);
  });

  it('creates the plugins dir if it does not exist yet', async () => {
    const fresh = join(dir, 'will', 'be', 'made');
    globalThis.fetch = async () =>
      fakeResponse('export default { name: "freshp", hooks: {} };');
    assert.equal(existsSync(fresh), false);
    const { filename } = await installPluginFromUrl(fresh, 'https://h/x.js', EXTRACT_SCRIPT);
    assert.equal(filename, 'freshp.js');
    assert.ok(existsSync(join(fresh, 'freshp.js')));
  });

  it('falls back gracefully when the extractor subprocess fails (bad script path)', async () => {
    // execFile a non-existent extractor → the try/catch swallows it, name stays '',
    // then URL-basename fallback kicks in.
    globalThis.fetch = async () => fakeResponse('export default { name: "ignored" };');
    const { filename } = await installPluginFromUrl(
      dir, 'https://h/from-url.js', join(work, 'no-such-extractor.mjs'),
    );
    // extraction failed → URL basename used
    assert.equal(filename, 'from-url.js');
  });
});

// Sanity: ensure we restored fetch correctly mid-suite isn't relied on; each test sets its own.
void writeFileSync;
