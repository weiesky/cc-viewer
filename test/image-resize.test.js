import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickOutputType, renameForType } from '../src/utils/imageResize.js';

// resizeImageIfNeeded 依赖浏览器 canvas/createImageBitmap，不在 node 单测覆盖范围。
// 这里覆盖纯决策逻辑，保证 HEIC/AVIF/GIF 等会被归一到 JPEG 输出。

describe('pickOutputType', () => {
  it('keeps PNG as PNG', () => {
    assert.equal(pickOutputType('image/png'), 'image/png');
  });

  it('keeps WebP as WebP', () => {
    assert.equal(pickOutputType('image/webp'), 'image/webp');
  });

  it('normalizes JPEG to JPEG', () => {
    assert.equal(pickOutputType('image/jpeg'), 'image/jpeg');
  });

  it('converts HEIC/HEIF to JPEG (覆盖 iPhone 截图)', () => {
    assert.equal(pickOutputType('image/heic'), 'image/jpeg');
    assert.equal(pickOutputType('image/heif'), 'image/jpeg');
  });

  it('converts AVIF/GIF/BMP/TIFF to JPEG', () => {
    assert.equal(pickOutputType('image/avif'), 'image/jpeg');
    assert.equal(pickOutputType('image/gif'), 'image/jpeg');
    assert.equal(pickOutputType('image/bmp'), 'image/jpeg');
    assert.equal(pickOutputType('image/tiff'), 'image/jpeg');
  });

  it('handles legacy image/jpg alias (非标准 MIME)', () => {
    assert.equal(pickOutputType('image/jpg'), 'image/jpeg');
  });
});

describe('renameForType', () => {
  it('rewrites extension based on output type', () => {
    assert.equal(renameForType('photo.heic', 'image/jpeg'), 'photo.jpg');
    assert.equal(renameForType('shot.png', 'image/jpeg'), 'shot.jpg');
    assert.equal(renameForType('pic.webp', 'image/png'), 'pic.png');
  });

  it('handles filename without extension', () => {
    assert.equal(renameForType('clipboard', 'image/jpeg'), 'clipboard.jpg');
  });

  it('handles empty stem gracefully (.hidden 情况)', () => {
    // lastIndexOf 返回 0 时走 else 分支，整体被当作 stem
    assert.equal(renameForType('.hidden', 'image/jpeg'), '.hidden.jpg');
  });

  it('preserves stem, only swaps extension', () => {
    assert.equal(renameForType('screenshot-2026-04-22.png', 'image/jpeg'),
      'screenshot-2026-04-22.jpg');
  });
});
