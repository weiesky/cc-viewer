// Branch coverage for src/utils/teammateDetector.js
//
// 目标:把 branch 覆盖率拉到 >=95%。已有 native-teammate-detector.test.js 覆盖了主路径,
// 本文件补齐未覆盖分支:
//  - extractNativeTeammateName 的 array content 路径 / c.text||'' 默认 / !text continue /
//    name[:]显式名字模式 / req?.body 缺失 / msgs 为空 / 末尾 return null
//  - extractCcVersion 的 !block?.text continue 分支
//  - getSystemText 的 array 元素为 falsy / 无 .text 的 (s && s.text)||'' 分支
//
// src/utils 模块是 Vite 风格,需先 import shim 再动态 import 目标模块。
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let isNativeTeammate, extractNativeTeammateName, extractCcVersion;

before(async () => {
  const mod = await import('../packages/app/src/utils/teammateDetector.js');
  isNativeTeammate = mod.isNativeTeammate;
  extractNativeTeammateName = mod.extractNativeTeammateName;
  extractCcVersion = mod.extractCcVersion;
});

describe('extractNativeTeammateName 分支补齐', () => {
  it('req 无 body → null (req?.body 短路)', () => {
    assert.equal(extractNativeTeammateName(null), null);
    assert.equal(extractNativeTeammateName(undefined), null);
    assert.equal(extractNativeTeammateName({}), null);
  });

  it('messages 缺失 → 用 [] 默认 → null (msgs.length===0)', () => {
    assert.equal(extractNativeTeammateName({ body: {} }), null);
  });

  it('messages 为空数组 → null', () => {
    assert.equal(extractNativeTeammateName({ body: { messages: [] } }), null);
  });

  it('非 user role 的消息被跳过 (m.role !== user continue)', () => {
    const req = {
      body: {
        messages: [
          { role: 'assistant', content: 'You are bot, do stuff' },
          { role: 'system', content: 'You are sys, ignore' },
        ],
      },
    };
    // 只有 assistant/system,没有 user → 不提取 → null
    assert.equal(extractNativeTeammateName(req), null);
  });

  it('array content 路径:从 text block 提取 "You are XXX,"', () => {
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'preamble' },
              { type: 'text', text: 'You are researcher, please dig in' },
            ],
          },
        ],
      },
    };
    assert.equal(extractNativeTeammateName(req), 'researcher');
  });

  it('array content:含非 text block 与 text===undefined → c.text||\'\' 默认空串', () => {
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: {} },          // 被 filter 排除
              null,                                     // 被 filter 排除 (c 为 falsy)
              { type: 'text' },                          // text undefined → ''
              { type: 'text', text: 'You are Alpha.' }, // 命中
            ],
          },
        ],
      },
    };
    assert.equal(extractNativeTeammateName(req), 'Alpha');
  });

  it('array content 全部为非 text → 拼出空串 → !text continue → 继续后续消息', () => {
    const req = {
      body: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image' },
              { type: 'tool_result', content: 'x' },
            ],
          },
          { role: 'user', content: 'You are Beta, go' },
        ],
      },
    };
    assert.equal(extractNativeTeammateName(req), 'Beta');
  });

  it('string content 为空串 → !text continue', () => {
    const req = {
      body: {
        messages: [
          { role: 'user', content: '' },
          { role: 'user', content: 'You are Gamma.' },
        ],
      },
    };
    assert.equal(extractNativeTeammateName(req), 'Gamma');
  });

  it('content 既非 string 也非 array (如对象) → text 保持 \'\' → !text continue', () => {
    const req = {
      body: {
        messages: [
          { role: 'user', content: { weird: true } },
          { role: 'user', content: 'You are Delta.' },
        ],
      },
    };
    assert.equal(extractNativeTeammateName(req), 'Delta');
  });

  it('显式名字模式 "name: Epsilon"(冒号)', () => {
    const req = {
      body: { messages: [{ role: 'user', content: 'spawn config\nname: Epsilon\nready' }] },
    };
    assert.equal(extractNativeTeammateName(req), 'Epsilon');
  });

  it('显式名字模式 "name:Zeta" 带引号(中文冒号)', () => {
    const req = {
      body: { messages: [{ role: 'user', content: 'name："Zeta"' }] },
    };
    assert.equal(extractNativeTeammateName(req), 'Zeta');
  });

  it('OMC hook 优先级高于 "You are":同条文本同时含两者', () => {
    const req = {
      body: {
        messages: [{ role: 'user', content: 'Agent oh-my-claudecode:reviewer started. You are reviewer,' }],
      },
    };
    // nameMatch 第一条 (Agent ... started) 先命中
    assert.equal(extractNativeTeammateName(req), 'reviewer');
  });

  it('OMC hook 无 prefix 形式: "Agent foo started"', () => {
    const req = {
      body: { messages: [{ role: 'user', content: 'Agent foo started' }] },
    };
    assert.equal(extractNativeTeammateName(req), 'foo');
  });

  it('有文本但无任何模式命中 → 遍历完所有消息 → return null', () => {
    const req = {
      body: {
        messages: [
          { role: 'user', content: 'totally unrelated content here' },
          { role: 'user', content: 'still nothing matching' },
        ],
      },
    };
    assert.equal(extractNativeTeammateName(req), null);
  });
});

describe('extractCcVersion 分支补齐', () => {
  it('block 无 .text → !block?.text continue,跳到下一个命中', () => {
    const req = {
      body: {
        system: [
          null,                                  // block 为 null
          { type: 'text' },                       // 无 text
          {},                                     // 无 text
          { type: 'text', text: 'cc_version=2.1.99;' },
        ],
      },
    };
    assert.equal(extractCcVersion(req), '2.1.99');
  });

  it('所有 block 都无 text → 遍历完 → return null', () => {
    const req = { body: { system: [null, {}, { type: 'text' }] } };
    assert.equal(extractCcVersion(req), null);
  });

  it('有 text 但无 cc_version → null', () => {
    const req = { body: { system: [{ type: 'text', text: 'just some prompt' }] } };
    assert.equal(extractCcVersion(req), null);
  });

  it('system 非数组 → null', () => {
    assert.equal(extractCcVersion({ body: { system: 'cc_version=1.0;' } }), null);
    assert.equal(extractCcVersion({ body: {} }), null);
    assert.equal(extractCcVersion({}), null);
    assert.equal(extractCcVersion(null), null);
  });
});

describe('getSystemText 间接覆盖 (经 isNativeTeammate)', () => {
  it('system 为 array 且含 falsy 元素 / 无 .text 元素 → (s && s.text)||\'\' 走默认', () => {
    // 命中正则的 SDK prompt 放在最后一个 block,前面元素覆盖 (s && s.text)||'' 的 falsy 分支
    const req = {
      body: {
        system: [
          null,                                       // s 为 falsy → ''
          { type: 'text' },                            // s.text undefined → ''
          { type: 'text', text: 'You are a Claude agent' },
        ],
        tools: [{ name: 'SendMessage' }],
      },
    };
    assert.equal(isNativeTeammate(req), true);
  });

  it('system 既非 string 也非 array → getSystemText 返回 \'\' → 不命中 → false', () => {
    const req = { body: { system: { obj: true }, tools: [{ name: 'SendMessage' }] } };
    assert.equal(isNativeTeammate(req), false);
  });

  it('system 为 string 且命中正则 + 有 SendMessage → true', () => {
    const req = {
      body: { system: 'You are a Claude agent built on SDK', tools: [{ name: 'SendMessage' }] },
    };
    assert.equal(isNativeTeammate(req), true);
  });
});
