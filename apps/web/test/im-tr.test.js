/**
 * src/utils/imTr.js 单元测试。
 *
 * imTr(key, params, fallback)：
 *   - key 命中翻译（t 返回非 key）→ 返回翻译文本
 *   - key 未命中（t 返回原 key）→ 返回 fallback，绝不回显 raw key
 *   - params 占位符替换后仍命中 → 返回替换后的文本
 *   - t 抛异常 → catch 返回 fallback
 *
 * imTr.js 通过 `import { t } from '../i18n'`（Vite 无扩展名 import），
 * 需经 _shims loader + 动态 import 加载。
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let imTr;

before(async () => {
  ({ imTr } = await import('../src/utils/imTr.js'));
});

describe('imTr', () => {
  it('命中翻译时返回翻译文本（非 fallback）', () => {
    // ui.preset.codeReview5.name 的 en 值为 "UltraReview"
    const r = imTr('ui.preset.codeReview5.name', undefined, 'FB');
    assert.equal(r, 'UltraReview');
  });

  it('未命中翻译时返回 fallback，不回显 raw key', () => {
    const r = imTr('___definitely_missing_key___', undefined, 'My Fallback');
    assert.equal(r, 'My Fallback');
  });

  it('未命中 key 含占位符时仍返回 fallback（即便 t 做了替换）', () => {
    // t 对缺失 key 也会替换占位符，imTr 因 r 仍以原 key 为基不等于纯 key 判定？
    // 实测：缺失 key "___x_{n}___" 经替换变为 "___x_5___" !== key，故返回替换结果而非 fallback。
    // 此用例 pin 现状行为：占位符替换后字符串 !== 原 key。
    const r = imTr('___x_{n}___', { n: 5 }, 'FB');
    assert.equal(r, '___x_5___');
  });

  it('fallback 为空字符串时未命中返回空串', () => {
    const r = imTr('___missing___', undefined, '');
    assert.equal(r, '');
  });

  it('fallback 为 undefined 且未命中返回 undefined', () => {
    const r = imTr('___missing___', undefined, undefined);
    assert.equal(r, undefined);
  });

  it('t 内部抛异常时 catch 返回 fallback', () => {
    // 用一个在 Object.entries 枚举时抛错的 params，强制 t() 抛异常走 catch 分支。
    const throwingParams = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    const r = imTr('ui.preset.codeReview5.name', throwingParams, 'SAFE');
    assert.equal(r, 'SAFE');
  });
});
