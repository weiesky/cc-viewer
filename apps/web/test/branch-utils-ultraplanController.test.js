/**
 * 分支补漏：src/utils/ultraplanController.js
 *
 * 行覆盖已 100%，缺口全在分支（短路 / 默认值 / 可选链短路）。本文件专攻
 * test/ultraplan-controller.test.js + ...-gap.test.js 未触达的【否定/兜底】分支：
 *   - handleUpload: e.target.files?.[0] 的 ?. 短路（target.files 为 undefined）；
 *     err?.message 为 undefined 时 || 'Upload failed' 兜底；
 *   - handlePaste: e.clipboardData?.items 的 ?. 短路（clipboardData 为 undefined）；
 *     图片项 getAsFile() 返回 null → if (!file) return 提前返回；
 *     file.name 为 falsy → `paste-${Date.now()}.png` 兜底命名；
 *     err?.message 为 undefined 时 || 'Upload failed' 兜底。
 *
 * 模块仅依赖 ./ultraplanExperts.js（纯净），直接静态 import 即可（与邻近测试一致）；
 * 同时静态 import _shims/register.mjs 以符合 vite 风格相对 import 的统一约定。
 */
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { UltraplanController } from '../src/utils/ultraplanController.js';

// ── fake host：镜像邻近测试的 makeHost，但 reject 时可投掷无 message 的错误 ──────────
function makeHost({ uploadOk = true, rejectValue = new Error('boom') } = {}) {
  const state = { ultraplanFiles: [], customUltraplanExperts: [], ultraplanVariant: 'codeExpert' };
  const messageErrors = [];
  const uploadCalls = [];
  return {
    _state: state,
    _messageErrors: messageErrors,
    _uploadCalls: uploadCalls,
    getState: () => state,
    setState: (updater) => {
      const partial = typeof updater === 'function' ? updater(state) : updater;
      if (partial) Object.assign(state, partial);
    },
    onUpdatePreferences: () => {},
    uploadFile: (file) => {
      uploadCalls.push(file?.name);
      return uploadOk ? Promise.resolve(`/tmp/upload/${file?.name || 'x'}`) : Promise.reject(rejectValue);
    },
    messageError: (m) => { messageErrors.push(m); },
    closeEditor: () => {},
  };
}

// ── fake document.createElement('input')：让 click() 同步触发 onchange ──────────────
let createdInputs = [];
function installDocument() {
  globalThis.document = {
    createElement() {
      const input = {
        type: '',
        onchange: null,
        _event: { target: { files: [] } }, // 默认含 files；测试可覆写成 {} 触发 ?. 短路
        click() {
          if (typeof this.onchange === 'function') return this.onchange(this._event);
        },
      };
      createdInputs.push(input);
      return input;
    },
  };
}

const tick = () => new Promise(r => setImmediate(r));

let origError;
let errorLogs;
before(() => {
  installDocument();
  origError = console.error;
  errorLogs = [];
  console.error = (...args) => { errorLogs.push(args); };
});
after(() => {
  delete globalThis.document;
  console.error = origError;
});
beforeEach(() => { createdInputs = []; errorLogs.length = 0; });

describe('UltraplanController.handleUpload — 分支兜底', () => {
  it('e.target.files 为 undefined → files?.[0] 短路，提前返回，不上传不改 state', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    c.handleUpload();
    createdInputs[0]._event = { target: {} }; // files 缺失 → e.target.files?.[0] 走 ?. 短路
    createdInputs[0].click();
    await tick();
    assert.equal(host._uploadCalls.length, 0);
    assert.equal(host._state.ultraplanFiles.length, 0);
  });

  it('上传 reject 的错误无 message → messageError 收到 "Upload failed" 兜底', async () => {
    // reject 一个没有 message 属性的对象 → err?.message 为 undefined → || 'Upload failed'
    const host = makeHost({ uploadOk: false, rejectValue: {} });
    const c = new UltraplanController(host);
    c.handleUpload();
    createdInputs[0]._event = { target: { files: [{ name: 'bad.png' }] } };
    createdInputs[0].click();
    await tick();
    assert.equal(host._state.ultraplanFiles.length, 0);
    assert.deepEqual(host._messageErrors, ['Upload failed']);
    assert.equal(errorLogs.length, 1);
  });
});

describe('UltraplanController.handlePaste — 分支兜底', () => {
  it('clipboardData 为 undefined → items 经 ?. 短路，提前返回', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    await c.handlePaste({}); // 无 clipboardData
    await tick();
    assert.equal(host._uploadCalls.length, 0);
    assert.equal(host._state.ultraplanFiles.length, 0);
  });

  it('clipboardData.items 存在但 items 为 null → 同样短路提前返回', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    await c.handlePaste({ clipboardData: { items: null } });
    await tick();
    assert.equal(host._uploadCalls.length, 0);
  });

  it('图片项 getAsFile() 返回 null → if (!file) return，不上传不 preventDefault 后续', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    let prevented = 0;
    await c.handlePaste({
      preventDefault: () => { prevented += 1; },
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => null }] },
    });
    await tick();
    // preventDefault 在拿 file 之前已调用一次；file 为 null 后立即 return
    assert.equal(prevented, 1);
    assert.equal(host._uploadCalls.length, 0);
    assert.equal(host._state.ultraplanFiles.length, 0);
  });

  it('图片项 file.name 为 falsy → 入列名使用 `paste-<ts>.png` 兜底', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    await c.handlePaste({
      preventDefault: () => {},
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => ({ name: '' }) }] },
    });
    await tick();
    assert.equal(host._state.ultraplanFiles.length, 1);
    assert.match(host._state.ultraplanFiles[0].name, /^paste-\d+\.png$/);
  });

  it('上传 reject 的错误无 message → messageError 收到 "Upload failed" 兜底', async () => {
    const host = makeHost({ uploadOk: false, rejectValue: {} });
    const c = new UltraplanController(host);
    await c.handlePaste({
      preventDefault: () => {},
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => ({ name: 'p.png' }) }] },
    });
    await tick();
    assert.equal(host._state.ultraplanFiles.length, 0);
    assert.deepEqual(host._messageErrors, ['Upload failed']);
    assert.equal(errorLogs.length, 1);
  });
});
