// 端到端测试 cli-inject.js — 模拟 @anthropic-ai/claude-code/cli.js 注入 + 升级 + 卸载。
//
// 重点覆盖 round-1 已修但零测试的升级路径：
//   1. 老 INJECT_IMPORT marker 被识别为 stale 后能被 rewrite 成新 INJECT_BLOCK
//   2. 卸载能清除新 + 老两种形式 marker
//   3. EOL 保留（CRLF 不被静默转 LF）

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  injectCliJsAt,
  removeCliJsInjectionAt,
  buildInjectBlock,
  buildInjectBlockRegex,
  INJECT_START,
  INJECT_END,
} from '../server/lib/cli-inject.js';

const CURRENT = "import 'cc-viewer/interceptor.js';";
const LEGACY = ["import '../../cc-viewer/interceptor.js';"];

let tmpDir;
let fakeCli;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-cli-inject-'));
  fakeCli = join(tmpDir, 'cli.js');
});

after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('cli-inject: injectCliJsAt — 三种返回值', () => {
  it('fresh file → injected', () => {
    writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("claude");\n');
    const r = injectCliJsAt(fakeCli, CURRENT, LEGACY);
    assert.equal(r, 'injected');
    const after = readFileSync(fakeCli, 'utf-8');
    assert.ok(after.includes(buildInjectBlock(CURRENT)), 'INJECT_BLOCK 必须被插入');
  });

  it('已注入当前 INJECT_BLOCK → exists（幂等）', () => {
    writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("claude");\n');
    injectCliJsAt(fakeCli, CURRENT, LEGACY);
    const before = readFileSync(fakeCli, 'utf-8');
    const r = injectCliJsAt(fakeCli, CURRENT, LEGACY);
    assert.equal(r, 'exists');
    assert.equal(readFileSync(fakeCli, 'utf-8'), before, 'exists 路径不能改文件内容');
  });

  it('已注入老 marker (legacy form) → updated 重写为新 INJECT_BLOCK', () => {
    // 模拟老用户：cli.js 顶部已经有老 INJECT marker `import '../../cc-viewer/interceptor.js'`
    const legacyBlock = buildInjectBlock(LEGACY[0]);
    writeFileSync(fakeCli, `#!/usr/bin/env node\n${legacyBlock}\nconsole.log("claude");\n`);

    const r = injectCliJsAt(fakeCli, CURRENT, LEGACY);
    assert.equal(r, 'updated', '老 marker 必须被识别并 rewrite');

    const after = readFileSync(fakeCli, 'utf-8');
    assert.ok(after.includes(buildInjectBlock(CURRENT)), '新 INJECT_BLOCK 必须存在');
    assert.ok(!after.includes(LEGACY[0]), '老 INJECT_IMPORT 字符串必须被清除');
  });

  it('多次重复注入字节级稳定（强幂等：N 次 inject = 1 次 inject）', () => {
    // `ccv -logger` 在实际使用中会被反复触发（升级、重装、卸载重装）；
    // 每次 inject 都必须是字节级幂等：连续 N 次后文件不应累积 drift。
    writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("claude");\n');
    injectCliJsAt(fakeCli, CURRENT, LEGACY);
    const afterFirst = readFileSync(fakeCli, 'utf-8');
    for (let i = 0; i < 5; i++) {
      const r = injectCliJsAt(fakeCli, CURRENT, LEGACY);
      assert.equal(r, 'exists', `第 ${i + 2} 次必须返回 exists`);
    }
    assert.equal(readFileSync(fakeCli, 'utf-8'), afterFirst,
      'N 次重复 inject 后文件内容必须与首次一致（无 INJECT_BLOCK 累积/drift）');
  });

  it('updated 路径也是幂等的（legacy → current rewrite 后再 inject = exists）', () => {
    // 升级路径：用户从 pre-1.6.273 升级，首次 inject 走 updated 分支。
    // 此后任何 inject 都应是 exists（绝不应再次返回 updated）。
    const legacyBlock = buildInjectBlock(LEGACY[0]);
    writeFileSync(fakeCli, `#!/usr/bin/env node\n${legacyBlock}\nconsole.log("claude");\n`);
    assert.equal(injectCliJsAt(fakeCli, CURRENT, LEGACY), 'updated');
    const afterUpdated = readFileSync(fakeCli, 'utf-8');
    for (let i = 0; i < 3; i++) {
      assert.equal(injectCliJsAt(fakeCli, CURRENT, LEGACY), 'exists',
        `rewrite 后第 ${i + 2} 次 inject 必须是 exists（不应再 updated）`);
    }
    assert.equal(readFileSync(fakeCli, 'utf-8'), afterUpdated,
      'rewrite 后多次 inject 应字节稳定');
  });

  it('inject → remove → inject round-trip 字节级稳定', () => {
    // 卸载重装是常见路径（用户切换 logger / 升级）；
    // 必须保证 round-trip 后文件回到首次 inject 形态。
    writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("claude");\n');
    injectCliJsAt(fakeCli, CURRENT, LEGACY);
    const afterFirstInject = readFileSync(fakeCli, 'utf-8');
    removeCliJsInjectionAt(fakeCli, CURRENT, LEGACY);
    injectCliJsAt(fakeCli, CURRENT, LEGACY);
    assert.equal(readFileSync(fakeCli, 'utf-8'), afterFirstInject,
      'remove + re-inject 后内容应与首次 inject 完全一致');
  });

  it('CRLF 文件注入后原 CRLF 部分被保留（不被一次性转 LF）', () => {
    // 注：INJECT_BLOCK 内部目前用 `\n` 硬编码（pre-existing 行为），所以注入后文件
    // 含混合 EOL。回归目标是确保**原 CRLF 部分**仍是 CRLF —— round-1 提取实现时
    // 保留主导 EOL 的逻辑只对 lines.join 生效，不对 INJECT_BLOCK 内部生效。
    writeFileSync(fakeCli, '#!/usr/bin/env node\r\nconsole.log("claude");\r\n');
    injectCliJsAt(fakeCli, CURRENT, LEGACY);
    const after = readFileSync(fakeCli, 'utf-8');
    assert.ok(after.includes('#!/usr/bin/env node\r\n'),
      '原文件首行 CRLF 必须保留');
    assert.ok(after.includes('console.log("claude");\r\n'),
      '原代码行 CRLF 必须保留');
  });
});

describe('cli-inject: removeCliJsInjectionAt', () => {
  it('clean cli.js → clean', () => {
    writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("claude");\n');
    const r = removeCliJsInjectionAt(fakeCli, CURRENT, LEGACY);
    assert.equal(r, 'clean');
  });

  it('已注入当前 marker → removed', () => {
    writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("claude");\n');
    injectCliJsAt(fakeCli, CURRENT, LEGACY);
    const r = removeCliJsInjectionAt(fakeCli, CURRENT, LEGACY);
    assert.equal(r, 'removed');
    const after = readFileSync(fakeCli, 'utf-8');
    assert.ok(!after.includes(INJECT_START), 'INJECT_START 必须被清除');
  });

  it('已注入老 marker → removed（清除老形式）', () => {
    const legacyBlock = buildInjectBlock(LEGACY[0]);
    writeFileSync(fakeCli, `#!/usr/bin/env node\n${legacyBlock}\nconsole.log("claude");\n`);
    const r = removeCliJsInjectionAt(fakeCli, CURRENT, LEGACY);
    assert.equal(r, 'removed');
    const after = readFileSync(fakeCli, 'utf-8');
    assert.ok(!after.includes(INJECT_START), '老 INJECT_START 必须被清除');
    assert.ok(!after.includes(LEGACY[0]), '老 INJECT_IMPORT 字符串必须被清除');
  });

  it('文件不存在 → not_found', () => {
    const r = removeCliJsInjectionAt(join(tmpDir, 'nonexistent.js'), CURRENT, LEGACY);
    assert.equal(r, 'not_found');
  });
});

describe('cli-inject: buildInjectBlockRegex 覆盖当前 + 全部 LEGACY', () => {
  it('current INJECT_BLOCK 能 match', () => {
    const block = buildInjectBlock(CURRENT) + '\n';
    // 每个 test() 都要 new regex —— buildInjectBlockRegex 返回带 `g` flag 的 regex,
    // lastIndex 在调用间残留会让连续 test() 失败
    assert.ok(buildInjectBlockRegex(CURRENT, LEGACY).test(block), 'current 形式必须被 match');
  });

  it('每条 LEGACY 形式都能 match（升级路径核心保证）', () => {
    for (const legacy of LEGACY) {
      const block = buildInjectBlock(legacy) + '\n';
      assert.ok(buildInjectBlockRegex(CURRENT, LEGACY).test(block), `LEGACY 形式必须被 match: ${legacy}`);
    }
  });

  it('与已发布的真实 LEGACY_INJECT_IMPORTS 数组一致', async () => {
    const { INJECT_IMPORT, LEGACY_INJECT_IMPORTS } = await import('../findcc.js');
    for (const form of [INJECT_IMPORT, ...LEGACY_INJECT_IMPORTS]) {
      const block = buildInjectBlock(form) + '\n';
      assert.ok(buildInjectBlockRegex(INJECT_IMPORT, LEGACY_INJECT_IMPORTS).test(block),
        `已发布形式必须被 match: ${form}`);
    }
  });
});
