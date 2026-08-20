// 覆盖目标：src/utils/imageCompress.js —— compressImageToDataURL()
// 浏览器端图片压缩 → base64 dataURL，用于 MDXEditor 粘贴/拖入图片内联到 markdown。
// mock：FileReader(readAsDataURL→onload/onerror)、Image(src→onload/onerror, naturalWidth/Height)、
//        document.createElement('canvas')(getContext('2d')→{drawImage}、toDataURL)。
// after() 还原全局，beforeEach 重置配置。

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { compressImageToDataURL } from '../src/utils/imageCompress.js';

// ── 全局 mock 可调状态 ──
let readerConfig; // { result, fail }
let imgConfig;    // { naturalWidth, naturalHeight, fail }
let canvasConfig; // { noCtx, toDataURL, throwToDataURL }

const saved = {};

before(() => {
  saved.FileReader = globalThis.FileReader;
  saved.Image = globalThis.Image;
  saved.document = globalThis.document;

  globalThis.FileReader = class {
    constructor() { this.onload = null; this.onerror = null; this.result = null; }
    readAsDataURL(_file) {
      queueMicrotask(() => {
        if (readerConfig.fail) { this.onerror && this.onerror(); return; }
        this.result = readerConfig.result;
        this.onload && this.onload();
      });
    }
  };

  globalThis.Image = class {
    constructor() { this._src = ''; this.onload = null; this.onerror = null; }
    set src(v) {
      this._src = v;
      queueMicrotask(() => {
        if (imgConfig.fail) { this.onerror && this.onerror(new Error('decode')); return; }
        this.naturalWidth = imgConfig.naturalWidth;
        this.naturalHeight = imgConfig.naturalHeight;
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
        return { drawImage(...a) { canvas._draw = a; } };
      };
      canvas.toDataURL = (type, quality) => {
        canvas._toDataURLArgs = [type, quality];
        if (canvasConfig.throwToDataURL) throw new Error('tainted canvas');
        return canvasConfig.toDataURL;
      };
      return canvas;
    },
  };
});

after(() => {
  globalThis.FileReader = saved.FileReader;
  globalThis.Image = saved.Image;
  globalThis.document = saved.document;
});

beforeEach(() => {
  readerConfig = { result: 'data:image/jpeg;base64,AAAA', fail: false };
  imgConfig = { naturalWidth: 100, naturalHeight: 80, fail: false };
  canvasConfig = { noCtx: false, toDataURL: 'data:image/jpeg;base64,XX', throwToDataURL: false };
});

// 构造一个带 type / size 的 blob-like（继承 Blob 以通过 instanceof）
function makeFile(type, size = 1000, name = 'a.bin') {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  // 覆写 size 以便测试上限分支（不实际分配大内存）
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  return f;
}

describe('compressImageToDataURL — 输入守卫', () => {
  it('非 Blob 输入抛错', async () => {
    await assert.rejects(
      () => compressImageToDataURL({ type: 'image/jpeg' }),
      /input must be a File or Blob/,
    );
  });

  it('无 type 抛 Unsupported file type', async () => {
    const f = new Blob([new Uint8Array(4)]); // type 默认 ''
    await assert.rejects(() => compressImageToDataURL(f), /Unsupported file type: unknown/);
  });

  it('非 image/* type 抛 Unsupported file type 并带原 type', async () => {
    const f = makeFile('application/pdf');
    await assert.rejects(() => compressImageToDataURL(f), /Unsupported file type: application\/pdf/);
  });

  it('超过 10MB 上限抛 Image too large', async () => {
    const f = makeFile('image/jpeg', 11 * 1024 * 1024);
    await assert.rejects(() => compressImageToDataURL(f), /Image too large: 11\.0MB > 10MB limit/);
  });
});

describe('compressImageToDataURL — 直通类型 (PASSTHROUGH)', () => {
  for (const t of ['image/png', 'image/gif', 'image/webp', 'image/svg+xml']) {
    it(`${t} 直接返回原始 dataURL，不走 canvas`, async () => {
      readerConfig.result = `data:${t};base64,ORIGINAL`;
      const f = makeFile(t, 2000);
      const out = await compressImageToDataURL(f);
      assert.equal(out, `data:${t};base64,ORIGINAL`);
    });
  }

  it('FileReader 失败时直通路径 reject', async () => {
    readerConfig.fail = true;
    const f = makeFile('image/png');
    await assert.rejects(() => compressImageToDataURL(f), /FileReader failed/);
  });
});

describe('compressImageToDataURL — JPEG 压缩主流程', () => {
  it('不超 maxEdge 时 scale=1，canvas 尺寸=原图，返回更短的压缩结果', async () => {
    readerConfig.result = 'data:image/jpeg;base64,' + 'A'.repeat(100); // 长原图
    canvasConfig.toDataURL = 'data:image/jpeg;base64,SHORT';          // 短压缩
    imgConfig = { naturalWidth: 100, naturalHeight: 80, fail: false };
    let canvasRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => { canvasRef = orig(tag); return canvasRef; };
    try {
      const out = await compressImageToDataURL(makeFile('image/jpeg'));
      assert.equal(out, 'data:image/jpeg;base64,SHORT');
      assert.equal(canvasRef.width, 100);
      assert.equal(canvasRef.height, 80);
      // 默认质量 0.85
      assert.deepEqual(canvasRef._toDataURLArgs, ['image/jpeg', 0.85]);
    } finally {
      globalThis.document.createElement = orig;
    }
  });

  it('超 maxEdge：按最长边等比缩放，targetW/H 用 round', async () => {
    imgConfig = { naturalWidth: 4000, naturalHeight: 3000, fail: false };
    canvasConfig.toDataURL = 'data:image/jpeg;base64,Z'; // 短，确保被采用
    readerConfig.result = 'data:image/jpeg;base64,' + 'A'.repeat(50);
    let canvasRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => { canvasRef = orig(tag); return canvasRef; };
    try {
      await compressImageToDataURL(makeFile('image/jpeg'), { maxEdge: 2000 });
      // scale = 2000/4000 = 0.5 → 2000 x 1500
      assert.equal(canvasRef.width, 2000);
      assert.equal(canvasRef.height, 1500);
    } finally {
      globalThis.document.createElement = orig;
    }
  });

  it('自定义 opts.maxEdge / opts.quality 透传到 toDataURL', async () => {
    imgConfig = { naturalWidth: 10, naturalHeight: 10, fail: false };
    canvasConfig.toDataURL = 'data:image/jpeg;base64,Q';
    readerConfig.result = 'data:image/jpeg;base64,' + 'A'.repeat(40);
    let canvasRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => { canvasRef = orig(tag); return canvasRef; };
    try {
      await compressImageToDataURL(makeFile('image/jpeg'), { quality: 0.5 });
      assert.equal(canvasRef._toDataURLArgs[1], 0.5);
    } finally {
      globalThis.document.createElement = orig;
    }
  });

  it('零尺寸图：targetW/H 至少为 1', async () => {
    imgConfig = { naturalWidth: 0, naturalHeight: 0, fail: false };
    canvasConfig.toDataURL = 'data:image/jpeg;base64,Z';
    readerConfig.result = 'data:image/jpeg;base64,' + 'A'.repeat(40);
    let canvasRef;
    const orig = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => { canvasRef = orig(tag); return canvasRef; };
    try {
      await compressImageToDataURL(makeFile('image/jpeg'));
      assert.equal(canvasRef.width, 1);
      assert.equal(canvasRef.height, 1);
    } finally {
      globalThis.document.createElement = orig;
    }
  });
});

describe('compressImageToDataURL — 回退到原图的各分支', () => {
  it('getContext 返回 null → 返回原始 dataURL', async () => {
    canvasConfig.noCtx = true;
    readerConfig.result = 'data:image/jpeg;base64,ORIG';
    const out = await compressImageToDataURL(makeFile('image/jpeg'));
    assert.equal(out, 'data:image/jpeg;base64,ORIG');
  });

  it('toDataURL 抛错(tainted canvas) → 返回原始 dataURL', async () => {
    canvasConfig.throwToDataURL = true;
    readerConfig.result = 'data:image/jpeg;base64,ORIG2';
    const out = await compressImageToDataURL(makeFile('image/jpeg'));
    assert.equal(out, 'data:image/jpeg;base64,ORIG2');
  });

  it('压缩结果为空字符串 → 返回原图', async () => {
    canvasConfig.toDataURL = '';
    readerConfig.result = 'data:image/jpeg;base64,ORIG3';
    const out = await compressImageToDataURL(makeFile('image/jpeg'));
    assert.equal(out, 'data:image/jpeg;base64,ORIG3');
  });

  it('压缩结果为 data:, (空画布) → 返回原图', async () => {
    canvasConfig.toDataURL = 'data:,';
    readerConfig.result = 'data:image/jpeg;base64,ORIG4';
    const out = await compressImageToDataURL(makeFile('image/jpeg'));
    assert.equal(out, 'data:image/jpeg;base64,ORIG4');
  });

  it('压缩后反而更大(>= 原图长度) → 返回原图', async () => {
    readerConfig.result = 'data:image/jpeg;base64,SHORT';            // 原图短
    canvasConfig.toDataURL = 'data:image/jpeg;base64,' + 'A'.repeat(200); // 压缩更长
    const out = await compressImageToDataURL(makeFile('image/jpeg'));
    assert.equal(out, 'data:image/jpeg;base64,SHORT');
  });

  it('Image 解码失败 → reject', async () => {
    imgConfig.fail = true;
    const out = compressImageToDataURL(makeFile('image/jpeg'));
    await assert.rejects(() => out, /Image decode failed/);
  });
});
