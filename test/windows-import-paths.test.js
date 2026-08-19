// Static-analysis regression test for Windows ESM import path safety.
//
// Background: Node's ESM loader on Windows rejects raw absolute paths like
// `C:\Users\...\foo.js` because it interprets `c:` as a URL scheme
// (ERR_UNSUPPORTED_ESM_URL_SCHEME). Any `import(join(...))` / `import(resolve(...))`
// style call must wrap the path in `pathToFileURL(...).href`.
//
// cc-viewer historically accumulated 13 such sites across electron/main.js,
// electron/tab-worker.js, and interceptor.js. They're invisible on macOS/Linux,
// only crash on Windows, and easy to reintroduce. This test scans the source
// files and fails if a dynamic import-expression uses a non-static argument
// without going through pathToFileURL / file:// wrapper.
//
// POSIX note: the test itself is platform-agnostic — it reads source text,
// runs regex, makes assertions. Same behavior on all platforms.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Entry-point JS files (hand-curated — cli.js + root shim + the server/ files
// the shim and electron loaders pull in). cli.js stays at repo root; the
// real server-side modules live under server/ since the 1.6.273 reorg.
const ROOT_FILES = [
  'packages/app/cli.js',
  'packages/app/findcc.js',
  'packages/app/interceptor.js',
  'packages/app/server.js',
  'packages/app/server/server.js',
  'packages/app/server/proxy.js',
  'packages/app/server/interceptor.js',
  'packages/app/server/pty-manager.js',
  'packages/app/server/workspace-registry.js',
];

// Recursively list ESM source files under a directory, excluding node_modules / dist.
// Covers .js/.mjs/.cjs — `.mjs` was missed in the first cut, causing lib/extract-plugin-name.mjs:12
// to slip past 1.6.207 with a broken `file://${filePath}` template concat.
function listJsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (/\.[cm]?js$/.test(entry) && !/\.test\.[cm]?js$/.test(entry)) out.push(full);
  }
  return out;
}

// Match dynamic `import(<expr>)` where <expr> does NOT start with a quote
// (i.e. NOT a static string literal). Static imports like `import('./foo.js')`
// are safe — Node resolves them relative to the containing module's URL.
//
// Pattern: `import(` followed by 0+ whitespace, then a char that is NOT `'`, `"`, `\``.
// We deliberately do NOT match `import.meta` or `new URL(import.meta.url)` etc.
const DYNAMIC_IMPORT_RE = /(?:^|[^.\w])import\s*\(\s*([^'"`\s][^)]*)/g;

// Check if the import expression shows a safe wrapper. ONLY accept `pathToFileURL(` —
// template-string concat like `` `file://${filePath}` `` is UNSAFE on Windows because it
// produces `file://C:\...` (no third /, backslashes) instead of `file:///C:/...`.
// `pathToFileURL` is the only API that normalizes correctly on both POSIX and Windows.
function isSafelyWrapped(exprText) {
  return /pathToFileURL\s*\(/.test(exprText);
}

function scanFile(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split(/\r?\n/);
  const violations = [];
  lines.forEach((line, idx) => {
    // Strip single-line comments to avoid false positives in doc examples.
    const code = line.replace(/\/\/.*$/, '');
    const matches = [...code.matchAll(DYNAMIC_IMPORT_RE)];
    for (const m of matches) {
      const exprStart = m.index + m[0].length - m[1].length;
      // Grab up to 2 following lines in case the expression wraps.
      const context = code.slice(exprStart) + '\n' + (lines[idx + 1] || '') + '\n' + (lines[idx + 2] || '');
      if (!isSafelyWrapped(context)) {
        violations.push({ file: filePath, line: idx + 1, text: line.trim() });
      }
    }
  });
  return violations;
}

describe('windows-import-paths: dynamic import() must use pathToFileURL on absolute paths', () => {
  it('no root-level file has a naked dynamic import()', () => {
    const violations = [];
    for (const rel of ROOT_FILES) {
      const abs = join(repoRoot, rel);
      if (!existsSync(abs)) continue;
      violations.push(...scanFile(abs));
    }
    assert.deepEqual(violations, [],
      'Found dynamic import() without pathToFileURL wrapper — fails on Windows:\n' +
      violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n'));
  });

  it('no file under server/lib/ has a naked dynamic import()', () => {
    const violations = [];
    for (const file of listJsFiles(join(repoRoot, 'packages', 'app', 'server', 'lib'))) {
      violations.push(...scanFile(file));
    }
    assert.deepEqual(violations, [],
      'Found dynamic import() without pathToFileURL wrapper in server/lib/:\n' +
      violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n'));
  });

  it('no file under electron/ has a naked dynamic import()', () => {
    const violations = [];
    const electronDir = join(repoRoot, 'apps', 'electron', 'electron');
    if (existsSync(electronDir)) {
      for (const file of listJsFiles(electronDir)) {
        violations.push(...scanFile(file));
      }
    }
    assert.deepEqual(violations, [],
      'Found dynamic import() without pathToFileURL wrapper in electron/:\n' +
      violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n'));
  });

  // Sanity check: the scanner should NOT false-positive on static string imports.
  it('regression scanner does NOT flag static string imports', () => {
    const samples = [
      `import('./proxy.js')`,
      `await import('node:fs')`,
      `const m = await import("./findcc.js")`,
    ];
    for (const s of samples) {
      const matches = [...s.matchAll(DYNAMIC_IMPORT_RE)];
      assert.equal(matches.length, 0, `scanner incorrectly flagged static import: ${s}`);
    }
  });

  // Sanity check: the scanner DOES flag the unsafe pattern.
  it('regression scanner DOES flag dynamic non-string imports without pathToFileURL', () => {
    const unsafe = `await import(join(rootDir, 'foo.js'))`;
    const matches = [...unsafe.matchAll(DYNAMIC_IMPORT_RE)];
    assert.equal(matches.length, 1, 'scanner failed to flag unsafe dynamic import');
    assert.equal(isSafelyWrapped(unsafe), false, 'isSafelyWrapped incorrectly passed unsafe code');
  });

  it('regression scanner accepts pathToFileURL wrapper', () => {
    const safe = `await import(pathToFileURL(join(rootDir, 'foo.js')).href)`;
    assert.equal(isSafelyWrapped(safe), true, 'isSafelyWrapped rejected correctly-wrapped code');
  });

  // Explicitly regression-lock the pre-1.6.208 footgun: template-string `file://` concat
  // is NOT considered safe because Windows produces malformed `file://C:\...` URLs.
  it('regression scanner REJECTS `file://${path}` template concat as unsafe', () => {
    const unsafeTemplate = 'await import(`file://${filePath}`)';
    assert.equal(
      isSafelyWrapped(unsafeTemplate),
      false,
      'template string file:// concat must be flagged — it produces malformed URL on Windows'
    );
  });
});
