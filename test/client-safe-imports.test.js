// CLIENT-SAFE 跨层 import 边界静态校验。
//
// 背景：8 个 server/lib/*.js 模块是 isomorphic 纯逻辑（零 node deps），被前端代码引用：
// voice-pack-events.js / approval-modal-prefs.js / delta-reconstructor.js /
// tools-xml-formatter.js / context-rules.js / session-boundary.js / error-report.js /
// v2-transcript-normalizer.js。这些文件首行已加 `// CLIENT-SAFE: no node deps...`
// 注释，但纯注释约束未来容易失守。
//
// Monorepo（A2 拆分）后边界变为：apps/web/src/** → packages/app/** 的相对 import
// 必须只命中白名单 —— 含 8 个 CLIENT-SAFE server/lib 模块 + 4 个共享缝文件
// （packages/app/src/utils/{requestType,contentFilter,teammateDetector,clearCheckpoint}.js，
// server 端运行时也需要它们，因此物理上留在发布包内）。
//
// 本测试做静态校验：
//   1. apps/web/src 内任何跨出 apps/web 进入 packages/app 的 import 必须只命中白名单
//   2. 白名单文件本身不能 import `node:*` / `fs` / `process` / `child_process`
// 任一失败 → CI 红，比 ESLint plugin-import 更轻（零 devDep、零配置文件）。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const webSrcRoot = join(repoRoot, 'apps', 'web', 'src');
const appRoot = join(repoRoot, 'packages', 'app');

// Paths relative to packages/app (the published package root).
const CLIENT_SAFE_ALLOWLIST = new Set([
  'server/lib/voice-pack-events.js',
  'server/lib/approval-modal-prefs.js',
  'server/lib/delta-reconstructor.js',
  'server/lib/tools-xml-formatter.js',
  'server/lib/context-rules.js',
  'server/lib/session-boundary.js', // wire-v2 S1: shared boundary/reverse-anchor module
  'server/lib/error-report.js', // wire-v2 S2: reportSwallowed convention, shared both sides
  'server/lib/v2-transcript-normalizer.js', // Claude Code 2.x JSONL → legacy entry normalizer
  'src/utils/requestType.js', // A2 seam: imported by server/lib/v2/* at runtime
  'src/utils/contentFilter.js',
  'src/utils/teammateDetector.js',
  'src/utils/clearCheckpoint.js',
]);

function listFiles(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some(ext => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

// 匹配 `import ... from '<spec>'` / `import('<spec>')` / `export ... from '<spec>'`。
// 只关心 spec 字符串内容，不解析具体导入项。
const IMPORT_SPEC_RE = /(?:^|[^.\w])(?:import|export)\s*[^'"`]*?from\s*(['"])([^'"`]+)\1|import\s*\(\s*(['"])([^'"`]+)\3\s*\)/g;

function scanImports(fileAbs) {
  const src = readFileSync(fileAbs, 'utf-8');
  const lines = src.split(/\r?\n/);
  const out = [];
  lines.forEach((line, idx) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const m of code.matchAll(IMPORT_SPEC_RE)) {
      const spec = m[2] || m[4];
      if (spec) out.push({ line: idx + 1, spec });
    }
  });
  return out;
}

describe('client-safe-imports: apps/web/src → packages/app/** 边界', () => {
  it('web 内对 app 包的 import 必须只命中 CLIENT-SAFE 白名单', () => {
    const violations = [];
    const srcFiles = listFiles(webSrcRoot, ['.js', '.jsx', '.mjs']);
    for (const fileAbs of srcFiles) {
      const fileDir = dirname(fileAbs);
      for (const { line, spec } of scanImports(fileAbs)) {
        // 只关心 relative 引用
        if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
        const resolved = join(fileDir, spec);
        // 只关心跨出 apps/web 进入 packages/app 的引用
        const rel = relative(appRoot, resolved);
        if (rel.startsWith('..')) continue;
        // Posix path normalization
        const relPosix = rel.replace(/\\/g, '/');
        // Vite/Node 允许无扩展名 import；补 .js / .mjs 探测白名单命中
        const candidates = /\.[cm]?js$/.test(relPosix)
          ? [relPosix]
          : [`${relPosix}.js`, `${relPosix}.mjs`, relPosix];
        if (!candidates.some(c => CLIENT_SAFE_ALLOWLIST.has(c))) {
          violations.push({ file: relative(repoRoot, fileAbs), line, spec, resolved: relPosix });
        }
      }
    }
    assert.deepEqual(violations, [],
      'web 跨层 import 命中非 CLIENT-SAFE 文件（要么加进白名单并确保零 node deps，要么改用其它途径）：\n' +
      violations.map(v => `  ${v.file}:${v.line}  '${v.spec}'  → ${v.resolved}`).join('\n'));
  });
});

describe('client-safe-imports: 白名单文件零 node deps', () => {
  // 任何 node builtin 都不可 import；含 `node:*` scheme 和裸 module 名（fs/path/os/...）
  // 与 process/child_process 等运行时 API
  const NODE_BUILTINS = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
    'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
    'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
    'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
    'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
    'stream/promises', 'string_decoder', 'sys', 'timers', 'timers/promises',
    'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
    'worker_threads', 'zlib',
  ]);

  for (const rel of CLIENT_SAFE_ALLOWLIST) {
    it(`${rel} 不含 node builtin import`, () => {
      const fileAbs = join(appRoot, rel);
      const violations = [];
      for (const { line, spec } of scanImports(fileAbs)) {
        if (spec.startsWith('node:')) {
          violations.push({ line, spec });
        } else if (NODE_BUILTINS.has(spec)) {
          violations.push({ line, spec });
        }
      }
      assert.deepEqual(violations, [],
        `${rel} 含 node builtin import，破坏 CLIENT-SAFE 契约：\n` +
        violations.map(v => `  line ${v.line}: '${v.spec}'`).join('\n'));
    });
  }
});
