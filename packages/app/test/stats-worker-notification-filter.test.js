/**
 * server/lib/stats-worker.js —— 跨会话/teammate 协议通知不得泄漏进 project-stats 预览。
 *
 * 背景：stats-worker 有一份独立的 isSystemText（服务端子集，前后端分属两个 bundle 无法共享同一模块）。
 * 此前它不认识未包裹的跨会话通知（"Another Claude session sent a message:" + 裸协议 JSON + caveat），
 * 导致队友通知作为「用户 prompt」混进 preview。这里锁定修复后的行为。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSystemText, extractUserTexts } from '../server/lib/stats-worker.js';

describe('stats-worker isSystemText —— 跨会话队友通知过滤', () => {
  it('未包裹通知（lead / caveat / 裸协议 JSON / <teammate-message> 包裹）→ true', () => {
    assert.equal(isSystemText(
      'Another Claude session sent a message:\n\n{"type":"idle_notification","from":"x"}\n\nThis came from another Claude session — not typed by your user.'
    ), true);
    assert.equal(isSystemText('This came from another Claude session — not typed by your user.'), true);
    assert.equal(isSystemText('{"type":"shutdown_approved","from":"rev"}'), true);
    assert.equal(isSystemText('<teammate-message teammate_id="a">{"type":"idle_notification"}</teammate-message>'), true);
  });

  it('正常用户 prompt / 非白名单 JSON → false', () => {
    assert.equal(isSystemText('帮我修复登录页的 bug'), false);
    assert.equal(isSystemText('How do I center a div?'), false);
    assert.equal(isSystemText('{"type":"object","properties":{}}'), false); // 非白名单 type
  });
});

describe('stats-worker extractUserTexts —— 通知轮被跳过、真实 prompt 保留', () => {
  it('array content 通知块跳过；string content 真实 prompt 收集', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'text', text:
        'Another Claude session sent a message:\n{"type":"idle_notification","from":"x"}\n\nThis came from another Claude session — not typed by your user.' }] },
      { role: 'user', content: '正常的问题：如何居中一个 div?' },
    ];
    const texts = extractUserTexts(msgs);
    assert.equal(texts.length, 1);
    assert.equal(texts[0], '正常的问题：如何居中一个 div?');
  });

  it('string content 内：通知 chrome 被剥离后回收用户混入正文', () => {
    const msgs = [
      { role: 'user', content:
        'Another Claude session sent a message:\n{"type":"shutdown_approved","from":"x"}\n\n顺手帮我看下这个报错' },
    ];
    const texts = extractUserTexts(msgs);
    assert.equal(texts.length, 1);
    assert.match(texts[0], /顺手帮我看下这个报错/);
  });

  // 回归：旧的扁平正则 `\{[^{}]*TYPE[^{}]*\}` 无法跨嵌套花括号，含嵌套字段的协议体（如 plan_approval_*）
  // 在「正文中段」时漏剥并泄漏进预览。stripProtocolJson 的 brace 配对扫描修复之。
  it('嵌套协议 JSON（plan_approval_response 含嵌套 meta）正文中段 → 被剔除、不泄漏', () => {
    const nested = '{"type":"plan_approval_response","request_id":"r","meta":{"a":{"b":1}},"from":"planner"}';
    const msgs = [{ role: 'user', content: '看下这条通知 ' + nested + ' 然后继续' }];
    const texts = extractUserTexts(msgs);
    assert.equal(texts.length, 1);
    assert.equal(texts[0].includes('plan_approval_response'), false); // 协议 JSON 已剔除
    assert.match(texts[0], /看下这条通知[\s\S]*然后继续/);
  });

  it('嵌套协议 JSON 起头 → isSystemText true（含 type 白名单），不漏当用户 prompt', () => {
    const nested = '{"type":"plan_approval_request","meta":{"x":{"y":1}},"from":"planner"}';
    assert.equal(isSystemText(nested), true);
    assert.equal(extractUserTexts([{ role: 'user', content: nested }]).length, 0);
  });
});

describe('stats-worker INTER_SESSION_TYPES —— 前后端同步守卫', () => {
  it('server INTER_SESSION_TYPES 与 frontend INTER_SESSION_NOTIFICATION_TYPES 完全一致', async () => {
    const { INTER_SESSION_TYPES } = await import('../server/lib/stats-worker.js');
    await import('./_shims/register.mjs');
    const { INTER_SESSION_NOTIFICATION_TYPES } = await import('@ccv/core/contentFilter');
    assert.deepEqual(
      [...INTER_SESSION_TYPES].sort(),
      [...INTER_SESSION_NOTIFICATION_TYPES].sort(),
      '前端 Set 与服务端数组类型白名单不同步（新增 type 时两处都要加）'
    );
  });
});
