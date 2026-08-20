// CLIENT-SAFE 跨层 import 边界静态校验（@ccv/core 提炼后的形态）。
//
// 背景：12 个 isomorphic 纯逻辑模块（请求分类 / teammate 检测 / 会话边界 /
// context 规则 / voice-pack 事件 / delta 重建 / v2 规范化 / error-report /
// tools-xml）曾散居 packages/app 的 src/utils/ 与 server/lib/，web 端靠
// `../../../../packages/app/...` 深相对路径跨包引用。它们现在是独立的私有
// workspace 包 @ccv/core（packages/core/src/*），经 npm bundledDependencies
// 随 cc-viewer tarball 发布；web 端一律改用 `@ccv/core/<name>` 裸说明符。
//
// 本测试做静态校验（与 scripts/verify-boundaries.mjs 的 R6/R8 互补）：
//   1. apps/web/src 内任何【相对路径】跨出 apps/web 进入 packages/** 的 import
//      必须为零 —— R6 反转后 web → packages/app 全禁；对 packages/core 也必须走
//      `@ccv/core/<name>` 包名说明符（相对路径绕包缝同禁），无白名单
//   2. apps/web/src 内 `@ccv/core/<name>` 说明符必须映射到 packages/core/src/
//      下的真实文件（防手写错子路径——根导出不存在，子路径即契约）
//   3. packages/core/src 下任何文件不得 import `node:*` / fs / process 等
//      node builtin —— CORE 是纯同构层（浏览器可打包），纯度失守即 CI 红
// 任一失败 → CI 红，比 ESLint plugin-import 更轻（零 devDep、零配置文件）。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const webSrcRoot = join(repoRoot, 'apps', 'web', 'src');
const coreSrcRoot = join(repoRoot, 'packages', 'core', 'src');

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

describe('client-safe-imports: apps/web/src → packages/** 全禁', () => {
  it('web 内不得有任何相对路径 import 跨进 packages/（app/core/content 一律禁止）', () => {
    const violations = [];
    const packagesRoot = join(repoRoot, 'packages');
    const srcFiles = listFiles(webSrcRoot, ['.js', '.jsx', '.mjs']);
    for (const fileAbs of srcFiles) {
      const fileDir = dirname(fileAbs);
      for (const { line, spec } of scanImports(fileAbs)) {
        // 只关心 relative 引用
        if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
        const resolved = join(fileDir, spec);
        // 跨出 apps/web 进入任何 packages/* 即违规（R6 反转：无白名单；
        // core 也必须走 @ccv/core 包名说明符，相对路径绕过包缝同样禁止）
        const rel = relative(packagesRoot, resolved);
        if (rel.startsWith('..')) continue;
        violations.push({ file: relative(repoRoot, fileAbs), line, spec });
      }
    }
    assert.deepEqual(violations, [],
      'web 相对路径 import 跨进 packages/（共享同构模块已迁入 @ccv/core，请改用 `@ccv/core/<name>` 裸说明符）：\n' +
      violations.map(v => `  ${v.file}:${v.line}  '${v.spec}'`).join('\n'));
  });
});

describe('client-safe-imports: @ccv/core 子路径契约', () => {
  it('web 内 @ccv/core/<name> 必须映射到 packages/core/src/ 真实文件', () => {
    const violations = [];
    const srcFiles = listFiles(webSrcRoot, ['.js', '.jsx', '.mjs']);
    for (const fileAbs of srcFiles) {
      for (const { line, spec } of scanImports(fileAbs)) {
        if (spec === '@ccv/core') {
          violations.push({ file: relative(repoRoot, fileAbs), line, spec, detail: '根导出不存在' });
          continue;
        }
        if (!spec.startsWith('@ccv/core/')) continue;
        const sub = spec.slice('@ccv/core/'.length);
        if (sub.includes('..')) {
          violations.push({ file: relative(repoRoot, fileAbs), line, spec, detail: '子路径不得含 ..（穿越逃出 core）' });
          continue;
        }
        if (!existsSync(join(coreSrcRoot, `${sub}.js`))) {
          violations.push({ file: relative(repoRoot, fileAbs), line, spec, detail: `packages/core/src/${sub}.js 不存在` });
        }
      }
    }
    assert.deepEqual(violations, [],
      'web 引用了不存在/非法的 @ccv/core 子路径：\n' +
      violations.map(v => `  ${v.file}:${v.line}  '${v.spec}' — ${v.detail}`).join('\n'));
  });
});

describe('client-safe-imports: packages/core/src 零 node deps', () => {
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

  const coreFiles = listFiles(coreSrcRoot, ['.js']);
  assert.ok(coreFiles.length > 0, 'packages/core/src 为空 —— 目录结构被破坏');

  for (const fileAbs of coreFiles) {
    const rel = relative(coreSrcRoot, fileAbs);
    it(`${rel} 不含 node builtin import`, () => {
      const violations = [];
      for (const { line, spec } of scanImports(fileAbs)) {
        if (spec.startsWith('node:')) {
          violations.push({ line, spec });
        } else if (NODE_BUILTINS.has(spec)) {
          violations.push({ line, spec });
        }
      }
      assert.deepEqual(violations, [],
        `${rel} 含 node builtin import，破坏 CORE 纯同构契约（web 端经 vite 打包必须浏览器可运行）：\n` +
        violations.map(v => `  line ${v.line}: '${v.spec}'`).join('\n'));
    });
  }
});
