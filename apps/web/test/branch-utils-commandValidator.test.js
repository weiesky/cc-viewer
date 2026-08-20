/**
 * 分支覆盖补充测试 — src/utils/commandValidator.js
 *
 * 邻近文件 test/commandValidator.test.js 已覆盖 isMutatingCommand 的大量
 * 正则命中/不命中场景与 isImageFile 的真值路径。本文件专补 BRANCH 缺口:
 *   - isImageFile 中 `(path || '')` 的 falsy 短路臂(path 为 null/undefined/'')。
 *
 * src/utils 模块是 Vite 风格(无扩展名相对 import),纯 Node 直接 import 会挂,
 * 故先静态 import ./_shims/register.mjs 注册 loader hooks,再【动态】import 目标。
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let isImageFile;
let isMutatingCommand;

before(async () => {
  const mod = await import('../src/utils/commandValidator.js');
  isImageFile = mod.isImageFile;
  isMutatingCommand = mod.isMutatingCommand;
});

describe('isImageFile — `path || \'\'` 短路分支', () => {
  it('path 为 undefined(不传参)时走默认空串臂并返回 false', () => {
    // ext = (''.split('.').pop()) = '' ; IMAGE_EXTS.has('') === false
    assert.equal(isImageFile(undefined), false);
    assert.equal(isImageFile(), false);
  });

  it('path 为 null 时走默认空串臂并返回 false', () => {
    assert.equal(isImageFile(null), false);
  });

  it('path 为空串时走默认空串臂并返回 false', () => {
    assert.equal(isImageFile(''), false);
  });

  it('path 为真值(命中左臂)仍正常工作', () => {
    // 显式覆盖 `||` 左臂为真的情况,确保两臂都被记账
    assert.equal(isImageFile('a.png'), true);
    assert.equal(isImageFile('a.txt'), false);
  });

  it('无扩展名(无点)真值路径: pop 返回整名,非图片扩展', () => {
    assert.equal(isImageFile('Makefile'), false);
  });

  it('大小写归一化: 大写扩展名命中', () => {
    assert.equal(isImageFile('X.JPG'), true);
  });
});

describe('isMutatingCommand — 正则真/假两臂', () => {
  it('命中返回 true(真臂)', () => {
    assert.equal(isMutatingCommand('rm -rf x'), true);
  });

  it('不命中返回 false(假臂)', () => {
    assert.equal(isMutatingCommand('echo hello'), false);
    assert.equal(isMutatingCommand(''), false);
  });
});
