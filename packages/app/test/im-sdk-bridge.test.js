/**
 * im-sdk-bridge.test.js — im-bridge-core 的 headless（SDK）deps 路径。
 *
 * 覆盖 SDK worker 的可选 deps（替代 PTY 形状）：
 *   - 入站注入走 sendPrompt（收到 origin 标记文本、无 bracketed-paste 转义帧）；
 *   - 出站回复优先 transcript，无 transcript 时回退 getReplyText()（interceptor 实时文本 / SDK result）；
 *   - /stop 走 interrupt() 而非 writeToPty('\x1b')；
 *   - 可用性门禁走 isSessionAvailable()（false → noSession），getPtyBootState 缺失时跳过启动门禁；
 *   - sendPrompt 回调 false → injectFailed + 释放单飞槽。
 *
 * 约定同 im-bridge-core.test.js：node:test + assert/strict；CCV_LOG_DIR 重定向（import 前）。
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-imsdk-test-'));
process.env.CCV_LOG_DIR = tmpDir;
// 回复文案经 tr() 按运行机 locale 选语言；钉死英文，避免 zh locale 下断言中文文案而假失败。
process.env.LANG = 'en_US.UTF-8';

const core = await import('../server/lib/im/im-bridge-core.js');

function makeFake(id) {
  const rec = { onInbound: null, sends: [] };
  const adapter = {
    id,
    i18nNs: 'server.dingtalk',
    allowListField: 'allowStaffIds',
    capabilities: { inboundAck: false, sdkManagesToken: true },
    rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: () => true,
    statusFields: () => ({}),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; return { id }; },
    async disconnect() {},
    async sendOne(_cfg, target, content) { rec.sends.push({ target, content }); },
    async testConnection() { return { ok: true }; },
  };
  core.registerAdapter(adapter);
  return rec;
}

const rec = makeFake('imSdk');
const tick = () => new Promise((r) => setTimeout(r, 5));

let sent, interrupted, available, streaming, replyText, liveText, sendOk, cfg;
function sdkDeps() {
  return {
    sendPrompt: (text, cb) => { sent.push(text); if (cb) cb(sendOk); },
    interrupt: () => { interrupted++; },
    isSessionAvailable: () => available,
    isStreaming: () => streaming,
    // 出站文本源：liveText 由 resetLiveText 清零（arm 时），replyText 是 SDK result 兜底。
    getReplyText: () => liveText || replyText,
    getConfig: () => cfg,
    // 无 getPtyState/getPtyKind/getPtyBootState/getPtySkipPermissions —— SDK 形状
    getLiveText: () => liveText,
    resetLiveText: () => { liveText = ''; },
  };
}

function inbound(over = {}) {
  const conversationId = over.conversationId ?? 'c1';
  const senderId = over.senderId ?? 'u1';
  return rec.onInbound({
    text: over.content ?? 'hi', conversationId, isGroup: false, senderId,
    msgId: over.msgId ?? 'm' + Math.random(), target: { conversationId, senderId },
  }, null);
}

beforeEach(async () => {
  core.__resetForTests('imSdk');
  sent = []; interrupted = 0; available = true; streaming = false; replyText = ''; liveText = ''; sendOk = true;
  cfg = { enabled: true, appKey: 'k', appSecret: 's', allowStaffIds: [], maxChunkChars: 3800, ackCard: false };
  rec.sends = [];
  await core.startBridge('imSdk', sdkDeps()); // __resetForTests 清空 bridgeDeps + 停 bridge，需重连
});
after(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('im-bridge-core headless (SDK) deps', () => {
  it('入站经 sendPrompt 注入 origin 标记文本（无 bracketed-paste 帧）', async () => {
    await inbound({ content: 'hello' });
    await tick();
    assert.equal(sent.length, 1, 'sendPrompt 应被调用一次');
    assert.ok(sent[0].startsWith('⟦im:imSdk:u1⟧'), '携带 IM 来源标记');
    assert.ok(sent[0].endsWith('hello'));
    assert.ok(!sent[0].includes('\x1b[200~'), 'SDK 路径不含 bracketed-paste 转义帧');
  });

  it('无 transcript 时出站回退 getReplyText()', async () => {
    replyText = 'SDK 答复';
    await inbound({ content: 'q' });
    await tick();
    await core.notifyTurnEnd('sess', Date.now(), null); // SDK 无 transcriptPath
    await tick();
    const out = rec.sends.find((s) => s.content.includes('SDK 答复'));
    assert.ok(out, '应发送 getReplyText 的文本');
  });

  it('竞态回归：error 回合 + 排队消息时，turn_end 仍能取到本轮 liveText（drainAll 不清空）', async () => {
    // 场景（P1）：turn_end 触发时队列已有第二条消息。若 notifyTurnEnd 先 drainAll（其
    // armActiveInjection 会 resetLiveText）再取 getReplyText，本轮实时文本会被清空 → 回退到
    // error result 的空 lastResultText → 误回「无文本」。修复后应先取文本再 drainAll。
    replyText = ''; // 模拟 error result：SDK result 兜底为空
    await inbound({ content: '第一条', conversationId: 'c1' });
    await tick();
    // 模拟本轮已产生部分实时文本（turn 结束前就写入 liveText）
    liveText = '本轮的部分正文';
    // 第二条消息入队（此刻第一条仍占槽 → busyQueued，排队）
    streaming = true; // 让第二条入队时判忙，进入队列而非立即注入
    await inbound({ content: '第二条', conversationId: 'c2', msgId: 'm-second' });
    streaming = false;
    await tick();
    // 第一条回合结束（error result：transcriptPath=null，replyText 兜底为空，但 liveText 有正文）
    await core.notifyTurnEnd('sess', Date.now(), null);
    await tick();
    const out = rec.sends.find((s) => s.content.includes('本轮的部分正文'));
    assert.ok(out, 'turn_end 应先取本轮 liveText 再 drainAll，不应被排队消息的 arm reset 清空');
  });

  it('/stop 走 interrupt() 而非 PTY ESC', async () => {
    replyText = 'working';
    await inbound({ content: 'go' });
    await tick();
    await inbound({ content: '/stop' });
    await tick();
    assert.equal(interrupted, 1, 'interrupt() 应被调用');
  });

  it('isSessionAvailable() === false → noSession，不调用 sendPrompt', async () => {
    available = false;
    await inbound({ content: 'hi' });
    await tick();
    assert.equal(sent.length, 0, '不可用时不得注入');
    const out = rec.sends.find((s) => /未|no|not/i.test(s.content));
    assert.ok(out, '应回复 noSession');
  });

  it('sendPrompt 回调 false → injectFailed 回复', async () => {
    sendOk = false;
    await inbound({ content: 'hi' });
    await tick();
    await tick();
    const out = rec.sends.find((s) => s.content.length > 0);
    assert.ok(out, '注入失败应回复 injectFailed');
  });
});
