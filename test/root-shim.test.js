// 根 shim 文件（server.js / interceptor.js）re-export 完整性。
//
// 为什么需要：
//   - 根 interceptor.js shim 是「老用户 @anthropic-ai/claude-code/cli.js 已注入
//     `import '../../cc-viewer/interceptor.js'` legacy marker」的兜底；shim 误删
//     或改 export 形式会让所有未升级用户启动 claude 即崩。
//   - 根 server.js shim 是 package.json `"."` 入口 + `main` 字段的 publish 表面。
// 上述场景全部不在 unit test 路径上，回归后单元测试仍全绿。本测试做静态兜底。
//
// 静态分析（grep `export` 语句）而非 import 真模块：server/server.js + server/
// interceptor.js top-level 会启动 viewer / 安装 fetch 拦截，让 test process 不退。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The published-package root shims live in packages/app (repo layout == tarball layout).
const repoRoot = join(__dirname, '..', 'packages', 'app');

// 静态扫源码里的 ES module export 语句，拿到对外暴露的命名导出集合。
// 覆盖 `export const X` / `export function X` / `export async function X` /
// `export class X` / `export { X, Y }` / `export { X as Y }`。
// 不解析 `export default`。
function extractNamedExports(src) {
  const names = new Set();
  // export {x, y as z} from '...'
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const tok = part.trim();
      if (!tok) continue;
      // 支持 `x as y` → 真 export 名是 y
      const asMatch = tok.match(/\bas\s+(\w+)/);
      const name = asMatch ? asMatch[1] : tok.match(/^\w+/)?.[0];
      if (name && name !== 'default') names.add(name);
    }
  }
  // export const / let / var X
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) names.add(m[1]);
  // export function / async function / class X
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+(\w+)/g)) names.add(m[1]);
  return names;
}

// `export * from '<spec>'` — 必须 follow the spec 取它的 named exports 也加进去。
// 简单递归：限制最大深度防意外环。
function extractStarReexports(src, basePath, depth = 0) {
  if (depth > 3) return new Set();
  const names = extractNamedExports(src);
  for (const m of src.matchAll(/export\s*\*\s*from\s*(['"])([^'"]+)\1/g)) {
    const spec = m[2];
    // 仅支持 relative spec（shim 用法）
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    const targetAbs = join(dirname(basePath), spec);
    let targetSrc;
    try { targetSrc = readFileSync(targetAbs, 'utf-8'); } catch { continue; }
    for (const n of extractStarReexports(targetSrc, targetAbs, depth + 1)) names.add(n);
  }
  return names;
}

function exportSetOf(absPath) {
  const src = readFileSync(absPath, 'utf-8');
  return extractStarReexports(src, absPath);
}

describe('root-shim: interceptor.js', () => {
  it('re-exports 所有 server/interceptor.js 的命名导出', () => {
    const rootSet = exportSetOf(join(repoRoot, 'interceptor.js'));
    const realSet = exportSetOf(join(repoRoot, 'server/interceptor.js'));
    const rootArr = [...rootSet].sort();
    const realArr = [...realSet].sort();
    assert.deepEqual(rootArr, realArr,
      `root interceptor.js 必须 re-export server/interceptor.js 全部命名导出\n  root: ${rootArr.join(',')}\n  real: ${realArr.join(',')}`);
  });

  it('关键 named export setupInterceptor 存在', () => {
    const rootSet = exportSetOf(join(repoRoot, 'interceptor.js'));
    assert.ok(rootSet.has('setupInterceptor'),
      'setupInterceptor 必须从根 shim 暴露（INJECT_IMPORT 注入后会 call 它）');
  });
});

describe('root-shim: server.js', () => {
  it('re-exports 所有 server/server.js 的命名导出', () => {
    const rootSet = exportSetOf(join(repoRoot, 'server.js'));
    const realSet = exportSetOf(join(repoRoot, 'server/server.js'));
    const rootArr = [...rootSet].sort();
    const realArr = [...realSet].sort();
    assert.deepEqual(rootArr, realArr,
      `root server.js 必须 re-export server/server.js 全部命名导出\n  root: ${rootArr.join(',')}\n  real: ${realArr.join(',')}`);
  });

  it('关键 named exports startViewer / getPort 存在', () => {
    const rootSet = exportSetOf(join(repoRoot, 'server.js'));
    assert.ok(rootSet.has('startViewer'), 'startViewer 必须从根 shim 暴露');
    assert.ok(rootSet.has('getPort'), 'getPort 必须从根 shim 暴露');
  });
});
