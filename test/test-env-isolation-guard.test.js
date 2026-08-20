/**
 * L2 静态守卫 — 测试文件 spawn 子进程的 env 隔离回归扫描器。
 *
 * 背景(2026-06-06 事故):测试 spawn 子进程时手搓 env 字面量、漏掉 CCV_LOG_DIR,
 * 子进程里的模块把真实 ~/.claude/cc-viewer 当 LOG_DIR,测试清理逻辑删除了用户数据。
 * findcc.js 的 NODE_TEST_CONTEXT 铁闸(L1)防得住「spread process.env 的子进程」,
 * 但手搓 env 的子进程拿不到 NODE_TEST_CONTEXT——必须靠本扫描器在静态层面拦截。
 *
 * 规则:全部测试目录(根 test/ + 各包 test/)里凡是 node 类子进程(上下文出现 execPath / node / cli.js /
 * server.js / findcc / interceptor)的 `env: { ... }` 字面量,必须满足其一:
 *   a) spread 继承:`...process.env`(NODE_TEST_CONTEXT 随之继承,L1 铁闸接管)
 *   b) 显式 `CCV_LOG_DIR` 键(重定向数据根)
 *   c) 显式 `HOME` 键(整个家目录已被指向假目录,默认解析落假 home 下,安全)
 * 仿照 windows-hide / windows-import-paths 的静态回归扫描器惯例。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
// Tests live in per-package test/ dirs since 2026-08-19 — the guard must sweep all of them.
const TEST_ROOTS = [
  __dirname,
  join(REPO_ROOT, 'packages', 'app', 'test'),
  join(REPO_ROOT, 'apps', 'web', 'test'),
  join(REPO_ROOT, 'apps', 'electron', 'test'),
  join(REPO_ROOT, 'packages', 'core', 'test'),
  join(REPO_ROOT, 'packages', 'content', 'test'),
];
const SELF = 'test-env-isolation-guard.test.js';

function listTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestFiles(p));
    else if (entry.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

/** 从 src 提取所有 `env:` 后跟对象字面量的块(简易花括号配平),返回 {line, literal, before}。 */
export function extractEnvLiterals(src) {
  const out = [];
  const re = /env\s*:\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length - 1; // 指向 '{'
    let depth = 0, end = start;
    for (let i = start; i < src.length && i < start + 4000; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const literal = src.slice(start, end + 1);
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, literal, before });
  }
  return out;
}

/** 判定单个 env 字面量是否违规(true=违规)。 */
export function isViolation({ literal, before }) {
  // 只关心 node 类子进程:上下文(env 前 400 字符)出现这些标记才纳入管辖
  const nodeChild = /execPath|\bnode\b|cli\.js|server\.js|findcc|interceptor/.test(before + literal);
  if (!nodeChild) return false;
  if (/\.\.\.\s*process\.env/.test(literal)) return false;  // a) spread 继承
  if (/CCV_LOG_DIR/.test(literal)) return false;             // b) 显式数据根
  if (/\bHOME\s*:/.test(literal)) return false;              // c) 假 home 整体重定向
  return true;
}

describe('测试 env 隔离静态守卫(子进程不得逃逸到真实 LOG_DIR)', () => {
  it('扫描器自检:漏配的 node 子进程 env 被标违规', () => {
    const bad = `const r = spawnSync(process.execPath, ['cli.js'], { env: { PATH: process.env.PATH }, encoding: 'utf-8' });`;
    const hits = extractEnvLiterals(bad);
    assert.equal(hits.length, 1);
    assert.equal(isViolation(hits[0]), true);
  });

  it('扫描器自检:spread / CCV_LOG_DIR / HOME 三种安全形态放行;非 node 子进程不管辖', () => {
    const okSpread = `spawn(process.execPath, [f], { env: { ...process.env, X: '1' } })`;
    const okLogDir = `spawn(process.execPath, [f], { env: { PATH: p, CCV_LOG_DIR: tmp } })`;
    const okHome = `spawn(process.execPath, [f], { env: { PATH: p, HOME: fakeHome } })`;
    const okGit = `spawnSync('git', ['status'], { env: { PATH: p, GIT_DIR: d } })`;
    for (const [src, expect] of [[okSpread, false], [okLogDir, false], [okHome, false], [okGit, false]]) {
      const hits = extractEnvLiterals(src);
      assert.equal(hits.length, 1, src);
      assert.equal(isViolation(hits[0]), expect, src);
    }
  });

  it('全量测试目录(根 test/ + 各包 test/):node 类子进程 env 字面量必须 spread process.env 或显式 CCV_LOG_DIR/HOME', () => {
    const files = TEST_ROOTS.flatMap(listTestFiles).filter(f => !f.endsWith(SELF));
    const violations = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const hit of extractEnvLiterals(src)) {
        if (isViolation(hit)) violations.push(`${relative(REPO_ROOT, f)}:${hit.line}`);
      }
    }
    assert.deepEqual(violations, [],
      `以下 env 字面量可能让子进程逃逸到真实 ~/.claude/cc-viewer(需 ...process.env 或 CCV_LOG_DIR/HOME):\n  ${violations.join('\n  ')}`);
  });
});
