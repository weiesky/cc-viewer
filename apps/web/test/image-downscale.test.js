// 覆盖目标：src/utils/imageDownscale.js —— downscaleForRetina()
// Retina(2x)截图上传前按 devicePixelRatio 缩小到 1x。
// 在 globalThis 上手写最小 mock：window.devicePixelRatio / Image / URL.createObjectURL /
// document.createElement('canvas')(getContext + toBlob)。after() 里恢复，避免污染同进程。

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { downscaleForRetina } from '../src/utils/imageDownscale.js';

// ── 全局 mock 状态（每个 it 通过下面的 config* 字段调整行为）──
let imgConfig;      // { width, height, fail }
let canvasConfig;   // { noCtx, nullBlob }
const revoked = []; // 记录 revokeObjectURL 调用

// 可被测试用例篡改的 window.devicePixelRatio
function setDpr(v) { globalThis.window.devicePixelRatio = v; }

const saved = {};

before(() => {
  saved.window = globalThis.window;
  saved.Image = globalThis.Image;
  saved.URL = globalThis.URL;
  saved.document = globalThis.document;

  globalThis.window = { devicePixelRatio: 1 };

  globalThis.Image = class {
    constructor() {
      this._src = '';
      this.onload = null;
      this.onerror = null;
    }
    set src(v) {
      this._src = v;
      // 异步触发，模拟真实解码
      queueMicrotask(() => {
        if (imgConfig.fail) {
          this.onerror && this.onerror(new Error('decode'));
        } else {
          this.width = imgConfig.width;
          this.height = imgConfig.height;
          this.onload && this.onload();
        }
      });
    }
    get src() { return this._src; }
  };

  // 复用 Node 原生 URL（构造能力），仅补上 createObjectURL/revokeObjectURL
  const NativeURL = saved.URL;
  globalThis.URL = NativeURL;
  globalThis.URL.createObjectURL = () => 'blob:mock-url';
  globalThis.URL.revokeObjectURL = (u) => { revoked.push(u); };

  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 };
      canvas.getContext = (kind) => {
        assert.equal(kind, '2d');
        if (canvasConfig.noCtx) return null;
        return {
          drawImage(...args) { canvas._drawCall = args; },
        };
      };
      canvas.toBlob = (cb, type) => {
        canvas._toBlobType = type;
        queueMicrotask(() => {
          if (canvasConfig.nullBlob) { cb(null); return; }
          cb(new Blob(['x'], { type: type || 'image/png' }));
        });
      };
      return canvas;
    },
  };
});

after(() => {
  globalThis.window = saved.window;
  globalThis.Image = saved.Image;
  if (saved.URL) {
    delete globalThis.URL.createObjectURL;
    delete globalThis.URL.revokeObjectURL;
    globalThis.URL = saved.URL;
  }
  globalThis.document = saved.document;
});

beforeEach(() => {
  imgConfig = { width: 400, height: 300, fail: false };
  canvasConfig = { noCtx: false, nullBlob: false };
  revoked.length = 0;
});

describe('downscaleForRetina', () => {
  it('非 Retina 屏 (dpr=1) 直接返回原文件，不触碰 canvas', async () => {
    setDpr(1);
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const out = await downscaleForRetina(file);
    assert.equal(out, file); // 同一引用
    assert.equal(revoked.length, 0);
  });

  it('dpr<1 (异常值) 也走 fallback 返回原文件', async () => {
    setDpr(0.5);
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const out = await downscaleForRetina(file);
    assert.equal(out, file);
  });

  it('window.devicePixelRatio 为 undefined 时按 1 处理 → 原文件', async () => {
    delete globalThis.window.devicePixelRatio;
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const out = await downscaleForRetina(file);
    assert.equal(out, file);
    setDpr(1);
  });

  it('Retina (dpr=2) 缩放成功：返回新 File，尺寸按 dpr 缩小，名字/type 沿用', async () => {
    setDpr(2);
    imgConfig = { width: 800, height: 600, fail: false };
    const file = new File(['data'], 'shot.png', { type: 'image/png' });
    const out = await downscaleForRetina(file);
    assert.ok(out instanceof File);
    assert.notEqual(out, file);          // 新对象
    assert.equal(out.name, 'shot.png');  // 名字保留
    assert.equal(out.type, 'image/png'); // type 保留
    assert.equal(revoked[0], 'blob:mock-url'); // objectURL 被回收
  });

  it('Retina：canvas 宽高 = round(img/dpr)，drawImage 用缩小尺寸', async () => {
    setDpr(2);
    imgConfig = { width: 801, height: 599, fail: false }; // 测 round
    let captured;
    const origCreate = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => {
      const c = origCreate(tag);
      const origGetCtx = c.getContext;
      c.getContext = (k) => {
        const ctx = origGetCtx(k);
        const origDraw = ctx.drawImage;
        ctx.drawImage = (...a) => { captured = { w: c.width, h: c.height, args: a }; origDraw(...a); };
        return ctx;
      };
      return c;
    };
    try {
      await downscaleForRetina(new File(['d'], 'b.png', { type: 'image/png' }));
    } finally {
      globalThis.document.createElement = origCreate;
    }
    assert.equal(captured.w, Math.round(801 / 2)); // 401
    assert.equal(captured.h, Math.round(599 / 2)); // 300
    // drawImage(img, 0, 0, w, h)
    assert.equal(captured.args[1], 0);
    assert.equal(captured.args[2], 0);
    assert.equal(captured.args[3], 401);
    assert.equal(captured.args[4], 300);
  });

  it('缺省文件名时退回 clipboard.png', async () => {
    setDpr(2);
    const blob = new Blob(['data'], { type: 'image/png' }); // 无 name
    const out = await downscaleForRetina(blob);
    assert.ok(out instanceof File);
    assert.equal(out.name, 'clipboard.png');
  });

  it('getContext 返回 null (canvas 不可用) → graceful 返回原文件', async () => {
    setDpr(2);
    canvasConfig.noCtx = true;
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const out = await downscaleForRetina(file);
    assert.equal(out, file);
    assert.equal(revoked[0], 'blob:mock-url'); // 仍回收 url
  });

  it('toBlob 返回 null → graceful 返回原文件', async () => {
    setDpr(2);
    canvasConfig.nullBlob = true;
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const out = await downscaleForRetina(file);
    assert.equal(out, file);
  });

  it('img.onerror (解码失败) → 回收 url 并返回原文件', async () => {
    setDpr(2);
    imgConfig.fail = true;
    const file = new File(['data'], 'a.png', { type: 'image/png' });
    const out = await downscaleForRetina(file);
    assert.equal(out, file);
    assert.equal(revoked[0], 'blob:mock-url');
  });
});
