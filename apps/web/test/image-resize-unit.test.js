// Target module: src/utils/imageResize.js — resizeImageIfNeeded() / loadImageBitmap / canvasToBlob etc.
// (pickOutputType / renameForType are already covered by existing test/image-resize.test.js;
//  this file focuses on the browser code path.)
// Mocks: createImageBitmap, URL.createObjectURL/revokeObjectURL, Image, document.createElement('canvas').
// after() restores originals; beforeEach() resets the config to default.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resizeImageIfNeeded } from '../src/utils/imageResize.js';

// ── Global mock state (tunable per test) ──
let bitmapConfig;  // { enabled, fail, width, height, hasClose, closeThrows }
let imgConfig;     // { fail, naturalWidth, naturalHeight }
let canvasConfig;  // { noCtx, drawThrows, blob, nullBlob, toBlobThrows }
const revoked = [];
let closeCalled;

const saved = {};

before(() => {
  saved.createImageBitmap = globalThis.createImageBitmap;
  saved.URL = globalThis.URL;
  saved.Image = globalThis.Image;
  saved.document = globalThis.document;

  // createImageBitmap：根据 bitmapConfig.enabled 决定是否存在
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    get() {
      if (!bitmapConfig.enabled) return undefined;
      return (_file) => bitmapConfig.fail
        ? Promise.reject(new Error('bitmap fail'))
        : Promise.resolve(makeBitmap());
    },
  });

  function makeBitmap() {
    const bm = { width: bitmapConfig.width, height: bitmapConfig.height };
    if (bitmapConfig.hasClose) {
      bm.close = () => {
        closeCalled = true;
        if (bitmapConfig.closeThrows) throw new Error('close fail');
      };
    }
    return bm;
  }

  globalThis.URL = saved.URL;
  globalThis.URL.createObjectURL = () => 'blob:mock';
  globalThis.URL.revokeObjectURL = (u) => { revoked.push(u); };

  globalThis.Image = class {
    constructor() { this._src = ''; this.onload = null; this.onerror = null; }
    set src(v) {
      this._src = v;
      queueMicrotask(() => {
        if (imgConfig.fail) { this.onerror && this.onerror(new Error('img fail')); return; }
        this.naturalWidth = imgConfig.naturalWidth;
        this.naturalHeight = imgConfig.naturalHeight;
        // img 元素路径里源码用 source.width||source.naturalWidth，img 没 width 故用 naturalWidth
        this.onload && this.onload();
      });
    }
    get src() { return this._src; }
  };

  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 };
      canvas.getContext = (kind) => {
        assert.equal(kind, '2d');
        if (canvasConfig.noCtx) return null;
        return {
          imageSmoothingEnabled: false,
          imageSmoothingQuality: '',
          drawImage(...a) {
            canvas._draw = a;
            if (canvasConfig.drawThrows) throw new Error('draw fail');
          },
        };
      };
      canvas.toBlob = (cb, type, quality) => {
        canvas._toBlobArgs = [type, quality];
        queueMicrotask(() => {
          if (canvasConfig.toBlobThrows) { cb(null); return; } // 触发 reject 路径
          if (canvasConfig.nullBlob) { cb(null); return; }
          cb(canvasConfig.blob || new Blob(['out'], { type: type || 'image/jpeg' }));
        });
      };
      return canvas;
    },
  };
});

after(() => {
  if (saved.createImageBitmap === undefined) delete globalThis.createImageBitmap;
  else Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: saved.createImageBitmap });
  delete globalThis.URL.createObjectURL;
  delete globalThis.URL.revokeObjectURL;
  globalThis.URL = saved.URL;
  globalThis.Image = saved.Image;
  globalThis.document = saved.document;
});

beforeEach(() => {
  bitmapConfig = { enabled: true, fail: false, width: 4000, height: 3000, hasClose: true, closeThrows: false };
  imgConfig = { fail: false, naturalWidth: 4000, naturalHeight: 3000 };
  canvasConfig = { noCtx: false, drawThrows: false, blob: null, nullBlob: false, toBlobThrows: false };
  revoked.length = 0;
  closeCalled = false;
});

function makeFile(type, name = 'photo.heic') {
  return new File([new Uint8Array(4)], name, { type });
}

describe('resizeImageIfNeeded — 早返回守卫', () => {
  it('falsy 输入原样返回', async () => {
    assert.equal(await resizeImageIfNeeded(null), null);
    assert.equal(await resizeImageIfNeeded(undefined), undefined);
  });

  it('非对象输入原样返回', async () => {
    assert.equal(await resizeImageIfNeeded('not-a-file'), 'not-a-file');
    assert.equal(await resizeImageIfNeeded(123), 123);
  });

  it('非 image/* type 原样返回', async () => {
    const f = makeFile('application/pdf', 'x.pdf');
    assert.equal(await resizeImageIfNeeded(f), f);
  });

  it('空 type 原样返回', async () => {
    const f = new File([new Uint8Array(2)], 'x'); // type ''
    assert.equal(await resizeImageIfNeeded(f), f);
  });

  it('image/gif 直通原文件（保留动图）', async () => {
    const f = makeFile('image/gif', 'anim.gif');
    assert.equal(await resizeImageIfNeeded(f), f);
  });

  it('type 大小写不敏感：IMAGE/GIF 也直通', async () => {
    const f = makeFile('IMAGE/GIF', 'anim.GIF');
    assert.equal(await resizeImageIfNeeded(f), f);
  });
});

describe('resizeImageIfNeeded — 解码与尺寸读取', () => {
  it('loadImageBitmap 失败(且无 createImageBitmap fallback 也失败) → 返回原文件', async () => {
    bitmapConfig.fail = true;     // createImageBitmap reject
    imgConfig.fail = true;        // img 元素 fallback 也失败
    const f = makeFile('image/jpeg', 'p.jpg');
    assert.equal(await resizeImageIfNeeded(f), f);
  });

  it('createImageBitmap 不存在时走 img 元素路径（成功缩放）', async () => {
    bitmapConfig.enabled = false; // 强制 fallback 到 loadViaImgElement
    imgConfig = { fail: false, naturalWidth: 4000, naturalHeight: 2000 };
    const out = await resizeImageIfNeeded(makeFile('image/jpeg', 'p.jpg'));
    assert.ok(out instanceof File);
    assert.equal(out.type, 'image/jpeg');
    assert.ok(revoked.includes('blob:mock')); // img 路径回收 objectURL
  });

  it('createImageBitmap reject 后 fallback 到 img 元素成功', async () => {
    bitmapConfig.fail = true;     // createImageBitmap reject
    imgConfig = { fail: false, naturalWidth: 5000, naturalHeight: 5000 };
    const out = await resizeImageIfNeeded(makeFile('image/jpeg', 'p.jpg'));
    assert.ok(out instanceof File);
  });

  it('源尺寸为 0 → 关闭并返回原文件', async () => {
    bitmapConfig.width = 0;
    bitmapConfig.height = 0;
    const f = makeFile('image/jpeg', 'p.jpg');
    assert.equal(await resizeImageIfNeeded(f), f);
    assert.equal(closeCalled, true);
  });

  it('maxSide <= maxDim：无需缩放，关闭并返回原文件', async () => {
    bitmapConfig.width = 1000;
    bitmapConfig.height = 800;
    const f = makeFile('image/jpeg', 'small.jpg');
    assert.equal(await resizeImageIfNeeded(f, 2000), f);
    assert.equal(closeCalled, true);
  });

  it('边界：maxSide == maxDim 不缩放', async () => {
    bitmapConfig.width = 2000;
    bitmapConfig.height = 1000;
    const f = makeFile('image/jpeg', 'edge.jpg');
    assert.equal(await resizeImageIfNeeded(f, 2000), f);
  });
});

describe('resizeImageIfNeeded — 缩放计算与输出', () => {
  it('JPEG 超限：等比缩放 dstW/H 用 round，输出 File 改名为 .jpg，质量 0.92', async () => {
    bitmapConfig.width = 4000;
    bitmapConfig.height = 3001; // 测 round：3001*0.5=1500.5→1501
    let canvasRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => { canvasRef = orig(tag); return canvasRef; };
    try {
      const out = await resizeImageIfNeeded(makeFile('image/jpeg', 'big.jpeg'), 2000);
      assert.ok(out instanceof File);
      assert.equal(out.type, 'image/jpeg');
      assert.equal(out.name, 'big.jpg');
      assert.equal(canvasRef.width, 2000);
      assert.equal(canvasRef.height, 1501);
      assert.deepEqual(canvasRef._toBlobArgs, ['image/jpeg', 0.92]);
      assert.equal(closeCalled, true);
    } finally {
      globalThis.document.createElement = orig;
    }
  });

  it('PNG 超限：保留 image/png，质量为 undefined（无损）', async () => {
    bitmapConfig.width = 5000;
    bitmapConfig.height = 4000;
    let canvasRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => { canvasRef = orig(tag); return canvasRef; };
    try {
      const out = await resizeImageIfNeeded(makeFile('image/png', 'shot.png'), 2000);
      assert.equal(out.type, 'image/png');
      assert.equal(out.name, 'shot.png');
      assert.deepEqual(canvasRef._toBlobArgs, ['image/png', undefined]);
    } finally {
      globalThis.document.createElement = orig;
    }
  });

  it('WebP 超限：保留 image/webp，质量 0.92', async () => {
    bitmapConfig.width = 3000;
    bitmapConfig.height = 100;
    let canvasRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => { canvasRef = orig(tag); return canvasRef; };
    try {
      const out = await resizeImageIfNeeded(makeFile('image/webp', 'a.webp'), 2000);
      assert.equal(out.type, 'image/webp');
      assert.equal(canvasRef._toBlobArgs[1], 0.92);
      // dstH = round(100 * 2000/3000) = round(66.66) = 67
      assert.equal(canvasRef.width, 2000);
      assert.equal(canvasRef.height, 67);
    } finally {
      globalThis.document.createElement = orig;
    }
  });

  it('HEIC 超限：转 JPEG，drawImage 用 high 质量平滑', async () => {
    bitmapConfig.width = 4000;
    bitmapConfig.height = 3000;
    let ctxRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => {
      const c = orig(tag);
      const og = c.getContext;
      c.getContext = (k) => { ctxRef = og(k); return ctxRef; };
      return c;
    };
    try {
      const out = await resizeImageIfNeeded(makeFile('image/heic', 'IMG_001.heic'), 2000);
      assert.equal(out.type, 'image/jpeg');
      assert.equal(out.name, 'IMG_001.jpg');
      assert.equal(ctxRef.imageSmoothingEnabled, true);
      assert.equal(ctxRef.imageSmoothingQuality, 'high');
    } finally {
      globalThis.document.createElement = orig;
    }
  });

  it('输出 File 设置了 lastModified', async () => {
    const before = Date.now();
    const out = await resizeImageIfNeeded(makeFile('image/jpeg', 'p.jpg'), 2000);
    assert.ok(out.lastModified >= before);
  });
});

describe('resizeImageIfNeeded — canvas/编码失败回退', () => {
  it('getContext 返回 null → 关闭并返回原文件', async () => {
    canvasConfig.noCtx = true;
    const f = makeFile('image/jpeg', 'p.jpg');
    assert.equal(await resizeImageIfNeeded(f, 2000), f);
    assert.equal(closeCalled, true);
  });

  it('drawImage 抛错 → 关闭并返回原文件', async () => {
    canvasConfig.drawThrows = true;
    const f = makeFile('image/jpeg', 'p.jpg');
    assert.equal(await resizeImageIfNeeded(f, 2000), f);
    assert.equal(closeCalled, true);
  });

  it('toBlob 返回 null(canvasToBlob reject) → 返回原文件', async () => {
    canvasConfig.nullBlob = true;
    const f = makeFile('image/jpeg', 'p.jpg');
    assert.equal(await resizeImageIfNeeded(f, 2000), f);
  });

  it('source.close() 抛错被吞掉，不影响缩放结果', async () => {
    bitmapConfig.closeThrows = true;
    const out = await resizeImageIfNeeded(makeFile('image/jpeg', 'p.jpg'), 2000);
    assert.ok(out instanceof File); // close 抛错被 try/catch 吞，仍正常产出
    assert.equal(closeCalled, true);
  });

  it('source 无 close 方法时不报错（hasClose=false）', async () => {
    bitmapConfig.hasClose = false;
    const out = await resizeImageIfNeeded(makeFile('image/jpeg', 'p.jpg'), 2000);
    assert.ok(out instanceof File);
  });
});
