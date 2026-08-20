// 覆盖目标：vite.config.js 的构建期 base 解析（base 的真实来源）。
// 锁定"发布 dist 默认相对路径"这一核心契约（issue #104）：未设 CCV_BASE_PATH 时 base 必须
// 为 ''（vite 据此产出相对 ./assets），CCV_BASE_PATH=/ 才回绝对 '/'，/prefix 归一为带尾斜杠的硬编码前缀。
// 直接 import 真实 vite.config（defineConfig(fn) 返回 fn，config() 在调用时实时读 process.env）。
// 注：只测 config 解析、不耦合 dist 产物——dist 是 .gitignore 的构建产物，npm test 不重建；
// 产物的相对路径由 vite base='' 的契约 + CI 的 build→test + 手动 e2e 共同保证（耦合 dist 会在
// 本地旧产物上假红，与代码无关）。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import config from '../vite.config.js';

// config() 在调用时实时读 process.env.CCV_BASE_PATH → 设/删后取 base，用后还原（避免跨测泄漏）。
function baseFor(v) {
  const saved = process.env.CCV_BASE_PATH;
  if (v === undefined) delete process.env.CCV_BASE_PATH;
  else process.env.CCV_BASE_PATH = v;
  try {
    return config().base;
  } finally {
    if (saved === undefined) delete process.env.CCV_BASE_PATH;
    else process.env.CCV_BASE_PATH = saved;
  }
}

describe('vite.config base（发布默认相对路径）', () => {
  it('未设 CCV_BASE_PATH → "" 相对路径（默认，issue #104）', () => {
    assert.equal(baseFor(undefined), '');
  });

  it('CCV_BASE_PATH="" → "" 相对路径', () => {
    assert.equal(baseFor(''), '');
  });

  it('CCV_BASE_PATH=/ → "/" 绝对路径（旧默认逃生舱）', () => {
    assert.equal(baseFor('/'), '/');
  });

  it('CCV_BASE_PATH=/proxy → "/proxy/"（补尾斜杠，硬编码前缀）', () => {
    assert.equal(baseFor('/proxy'), '/proxy/');
    assert.equal(baseFor('/proxy/'), '/proxy/');
  });

  it('多级前缀 /a/b → "/a/b/"', () => {
    assert.equal(baseFor('/a/b'), '/a/b/');
  });
});
