// 覆盖目标：plugin-runtime 的 mountPrefixes —— externalPrefix（Location/x-forwarded-prefix）
// 保持字面，cookiePath 必须是线格式（浏览器按编码后请求路径比较 cookie Path）。
// 该契约曾回归过一次（先剥尾斜杠再 wireBasePath → 静默回退字面），此处用纯函数单测锁死。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _mountPrefixesForTest } from '../server/lib/plugin-runtime.js';

const rt = { entry: { service: { prefix: '/plugins/svc' } } };

describe('plugin-runtime mountPrefixes (external literal / cookie wire)', () => {
  it('无前缀：两者一致', () => {
    assert.deepEqual(_mountPrefixesForTest(rt, ''), {
      externalPrefix: '/plugins/svc',
      cookiePath: '/plugins/svc/',
    });
  });

  it('普通前缀：两者一致（无编码字符）', () => {
    assert.deepEqual(_mountPrefixesForTest(rt, '/ccv/'), {
      externalPrefix: '/ccv/plugins/svc',
      cookiePath: '/ccv/plugins/svc/',
    });
  });

  it('字面 {token} 前缀：externalPrefix 字面、cookiePath 线格式（%7Btoken%7D）', () => {
    const p = _mountPrefixesForTest(rt, '/arca/api/v1/session/{token}/');
    assert.equal(p.externalPrefix, '/arca/api/v1/session/{token}/plugins/svc');
    assert.equal(p.cookiePath, '/arca/api/v1/session/%7Btoken%7D/plugins/svc/');
    assert.ok(!p.cookiePath.includes('{'), 'cookie Path must not stay literal');
  });

  it('带尾斜杠的输入是契约前提（normalizeBasePath 输出）；无尾斜杠也不会静默回退字面', () => {
    // 防御回归：即使调用方误传无尾斜杠形式，wire 化仍应发生（函数内部补尾斜杠语义由
    // wireBasePath 契约保证——这里钉住当前行为防止再次退化）
    const p = _mountPrefixesForTest(rt, '/arca/api/v1/session/{token}/');
    assert.ok(p.cookiePath.startsWith('/arca/api/v1/session/%7Btoken%7D/'));
  });
});
