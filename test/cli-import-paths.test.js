// Resolution-regression test: every static-string dynamic `import('./xxx.js')`
// — including the `pathToFileURL(join(rootDir, '...').href)` wrapper form used
// in electron entrypoints — in entry-point files must point to an existing file.
//
// Background: 1.6.273 reorg moved root-level server modules to `server/` but
// missed cli.js's 13 dynamic imports and one literal string in INJECT_IMPORT —
// `ccv run` / `ccv` / `ccv -SDK` all crashed at first dynamic import with
// ERR_MODULE_NOT_FOUND. The 2223-test suite stayed green because no unit
// test entered runCliMode / runProxyCommand / runSdkMode. Round-2 added
// electron-form scanning to catch the same regression on the electron path.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// 直接形式：`import('<lit>')` / `import("<lit>")`. Captures the literal.
const STATIC_IMPORT_RE = /(?:^|[^.\w])import\s*\(\s*(['"])([^'"`]+)\1\s*\)/g;

// electron 包装形式：`import(pathToFileURL(join(<base>, '<lit>', '<lit>', ...)).href)`.
// 捕获 join() 内的全部字符串字面量，按 path.join 语义拼回 segments。
//   base 表达式（如 rootDir 变量）不在静态扫描范围内 — 由测试调用方提供 baseHint
//   并 assert 解析后的 absolute path 命中真实文件。
const PATH_TO_FILE_URL_RE = /import\s*\(\s*pathToFileURL\s*\(\s*join\s*\(\s*([^)]*)\)\s*\)\s*\.href\s*\)/g;

function isBuiltin(spec) { return spec.startsWith('node:'); }
function isRelative(spec) { return spec.startsWith('./') || spec.startsWith('../'); }

// 抽取 join() 表达式里的字符串字面量序列。第一个 token 通常是变量（base）—— 用 null 占位。
// 例：`rootDir, 'server', 'findcc.js'` → [null, 'server', 'findcc.js']
function parseJoinArgs(exprText) {
  const segs = [];
  // 简单 split by `,`；不处理嵌套（join 内不会嵌套 join 这种情况）
  for (const raw of exprText.split(',')) {
    const tok = raw.trim();
    const m = tok.match(/^(['"])([^'"`]+)\1$/);
    segs.push(m ? m[2] : null);
  }
  return segs;
}

function scanFileForStaticImports(fileAbs) {
  const src = readFileSync(fileAbs, 'utf8');
  const lines = src.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, idx) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(STATIC_IMPORT_RE)) {
      hits.push({ line: idx + 1, kind: 'direct', spec: m[2] });
    }
    for (const m of code.matchAll(PATH_TO_FILE_URL_RE)) {
      const segs = parseJoinArgs(m[1]);
      // 第一个 segment 是变量（如 rootDir）→ 假定 = repoRoot；剩余 segments 为字面量
      const literalSegs = segs.slice(1);
      if (literalSegs.every(s => typeof s === 'string')) {
        hits.push({ line: idx + 1, kind: 'wrapped', segs: literalSegs });
      }
    }
  });
  return hits;
}

const ENTRY_FILES = [
  'packages/app/cli.js',
  'packages/app/findcc.js',                  // log-dir change notification is a listener registry (onLogDirChange), no self dynamic import
  'apps/electron/electron/main.js',
  'apps/electron/electron/tab-worker.js',
];
// Published-package content lives under packages/app in the monorepo — that dir
// is what "package root" (and electron's rootDir probe) resolve to in the repo.
const appRoot = join(repoRoot, 'packages', 'app');

describe('cli-import-paths: static-string dynamic imports must resolve on disk', () => {
  it('Electron uses the same preferred Claude selection as CLI launch modes', () => {
    const source = readFileSync(join(repoRoot, 'apps/electron/electron/main.js'), 'utf8');
    assert.match(source, /resolvePreferredClaudeSelection/);
    assert.doesNotMatch(source, /let claudePath = resolveNpmClaudePath\(\)/);
  });

  it('every relative direct import() target in entry files exists', () => {
    const missing = [];
    for (const rel of ENTRY_FILES) {
      const fileAbs = join(repoRoot, rel);
      if (!existsSync(fileAbs)) continue;
      const fileDir = dirname(fileAbs);
      for (const h of scanFileForStaticImports(fileAbs)) {
        if (h.kind !== 'direct') continue;
        if (isBuiltin(h.spec)) continue;
        if (!isRelative(h.spec)) continue;
        const target = resolve(fileDir, h.spec);
        if (!existsSync(target)) missing.push({ file: rel, line: h.line, spec: h.spec, target });
      }
    }
    assert.deepEqual(missing, [],
      'Dynamic import() targets pointing at non-existent files:\n' +
      missing.map(m => `  ${m.file}:${m.line}  import('${m.spec}')  → ${m.target}`).join('\n'));
  });

  it('every pathToFileURL(join(rootDir, ...)) wrapped import resolves under repoRoot', () => {
    const missing = [];
    for (const rel of ENTRY_FILES) {
      const fileAbs = join(repoRoot, rel);
      if (!existsSync(fileAbs)) continue;
      for (const h of scanFileForStaticImports(fileAbs)) {
        if (h.kind !== 'wrapped') continue;
        const target = resolve(appRoot, ...h.segs);
        if (!existsSync(target)) missing.push({ file: rel, line: h.line, segs: h.segs, target });
      }
    }
    assert.deepEqual(missing, [],
      'pathToFileURL(join(rootDir, ...)) targets pointing at non-existent files:\n' +
      missing.map(m => `  ${m.file}:${m.line}  join(rootDir, ${m.segs.map(s => `'${s}'`).join(', ')})  → ${m.target}`).join('\n'));
  });

  it('INJECT_IMPORT specifier resolves via package.json exports', async () => {
    // INJECT_IMPORT is injected verbatim into @anthropic-ai/claude-code/cli.js.
    // After the bare-specifier migration it goes through package exports;
    // verify the resolved physical file exists.
    const { INJECT_IMPORT } = await import('../packages/app/findcc.js');
    const m = INJECT_IMPORT.match(/^import\s+(['"])([^'"]+)\1\s*;?\s*$/);
    assert.ok(m, `INJECT_IMPORT shape unexpected: ${INJECT_IMPORT}`);
    const spec = m[2];

    if (isRelative(spec)) {
      // Legacy form — resolve relative to claude-code's cli.js
      // (`<gnm>/@anthropic-ai/claude-code/cli.js`). Smoke: file at expected
      // physical path exists in this repo's server/ tree.
      const cleaned = spec.replace(/^(\.\.\/)+/, '').replace(/^cc-viewer\//, '');
      const physical = join(appRoot, cleaned);
      assert.ok(existsSync(physical),
        `INJECT_IMPORT relative target missing: ${spec} → ${physical}`);
      return;
    }

    // Bare specifier: must be `cc-viewer/<sub>` and the sub-path must be in
    // package.json exports.
    assert.ok(spec.startsWith('cc-viewer/'),
      `INJECT_IMPORT bare specifier must start with 'cc-viewer/': ${spec}`);
    const subPath = './' + spec.slice('cc-viewer/'.length);
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
    const mapped = pkg.exports?.[subPath];
    assert.ok(mapped,
      `package.json exports missing entry for ${subPath} (required by INJECT_IMPORT '${spec}')`);
    const target = resolve(appRoot, mapped);
    assert.ok(existsSync(target),
      `package.json exports['${subPath}'] = '${mapped}' but file missing: ${target}`);
  });

  it('every LEGACY_INJECT_IMPORTS entry resolves under repoRoot (legacy markers must still upgrade)', async () => {
    // For each historical INJECT_IMPORT form, parse the spec and verify the
    // physical file under cc-viewer/ still exists. This guarantees that older
    // already-injected `@anthropic-ai/claude-code/cli.js` files won't crash
    // when they execute the legacy `import '../../cc-viewer/<path>'` line —
    // even before the user re-runs `ccv -logger` to upgrade the marker.
    const { LEGACY_INJECT_IMPORTS } = await import('../packages/app/findcc.js');
    const broken = [];
    for (const legacy of LEGACY_INJECT_IMPORTS) {
      const m = legacy.match(/^import\s+(['"])([^'"]+)\1\s*;?\s*$/);
      if (!m) { broken.push({ legacy, reason: 'unparseable' }); continue; }
      const spec = m[2];
      const cleaned = spec.replace(/^(\.\.\/)+/, '').replace(/^cc-viewer\//, '');
      const physical = join(appRoot, cleaned);
      if (!existsSync(physical)) broken.push({ legacy, spec, physical, reason: 'missing' });
    }
    assert.deepEqual(broken, [],
      'LEGACY_INJECT_IMPORTS entries point at files that no longer exist:\n' +
      broken.map(b => `  ${b.legacy}  → ${b.physical || b.reason}`).join('\n'));
  });
});
