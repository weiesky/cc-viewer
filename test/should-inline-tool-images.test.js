import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldInlineToolImages, formatOversizedImagePlaceholder } from '../apps/web/src/utils/toolResultCore.js';

// ============================================================================
// shouldInlineToolImages — 简化模式内联 tool_result 图片的判定
// ============================================================================

describe('shouldInlineToolImages', () => {
  it('undefined / null → false（SubAgent 末轮 / WebSearch / 计数缺口窗口）', () => {
    assert.equal(shouldInlineToolImages(undefined), false);
    assert.equal(shouldInlineToolImages(null), false);
    assert.equal(shouldInlineToolImages('not-an-entry'), false);
  });

  it('isPermissionDenied → false（红 badge 已有，不双显示）', () => {
    assert.equal(shouldInlineToolImages({ isPermissionDenied: true, images: [{ src: 'data:image/png;base64,AAA' }] }), false);
  });

  it('isInputValidationError → false', () => {
    assert.equal(shouldInlineToolImages({ isInputValidationError: true, images: [{ src: 'data:image/png;base64,AAA' }] }), false);
  });

  it('无 images / 空 images → false', () => {
    assert.equal(shouldInlineToolImages({}), false);
    assert.equal(shouldInlineToolImages({ images: [] }), false);
    assert.equal(shouldInlineToolImages({ images: null }), false);
  });

  it('全 oversized → false（纯占位噪音不内联）', () => {
    assert.equal(shouldInlineToolImages({ images: [{ oversized: true, mediaType: 'image/png', sizeBytes: 2621440 }] }), false);
  });

  it('混合 oversized + 正常 → true', () => {
    assert.equal(shouldInlineToolImages({
      images: [
        { oversized: true, mediaType: 'image/png', sizeBytes: 2621440 },
        { src: 'data:image/png;base64,BBB' },
      ],
    }), true);
  });

  it('有可渲染图 → true', () => {
    assert.equal(shouldInlineToolImages({ images: [{ src: 'data:image/png;base64,AAA', mediaType: 'image/png' }] }), true);
  });
});

// ============================================================================
// formatOversizedImagePlaceholder — 占位文案统一格式
// ============================================================================

describe('formatOversizedImagePlaceholder', () => {
  it('标准格式：image png · N KB · too large to preview', () => {
    assert.equal(
      formatOversizedImagePlaceholder({ mediaType: 'image/png', sizeBytes: 2621440 }),
      '[image png · 2560 KB · too large to preview]',
    );
  });

  it('mediaType 缺失 → 回退 image', () => {
    assert.equal(formatOversizedImagePlaceholder({ sizeBytes: 1024 }), '[image image · 1 KB · too large to preview]');
  });

  it('sizeBytes 缺失 → 0 KB', () => {
    assert.equal(formatOversizedImagePlaceholder({ mediaType: 'image/jpeg' }), '[image jpeg · 0 KB · too large to preview]');
  });
});
