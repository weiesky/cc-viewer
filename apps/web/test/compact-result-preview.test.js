/**
 * compactResultPreview 纯函数测试。
 *
 * 行为:从 toolResultMap entry 生成 3 行 / 200 字截断的字符串预览,供紧凑模式
 * Popover 浮窗在原有 tool_use 信息下方追加 result 预览块使用。
 *
 * 直接 import src/utils/toolResultCore.js(无 helpers.js / i18n.js / SVG 依赖,
 * node --test 可加载)。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compactResultPreview, extractToolResultImages, buildSingleToolResultCore } from '../src/utils/toolResultCore.js';

describe('compactResultPreview', () => {
  it('空 entry / null / undefined → null', () => {
    assert.equal(compactResultPreview(null), null);
    assert.equal(compactResultPreview(undefined), null);
    assert.equal(compactResultPreview({}), null);
    assert.equal(compactResultPreview({ resultText: '' }), null);
    assert.equal(compactResultPreview({ resultText: null }), null);
  });

  it('isPermissionDenied: true → null (外部已有红 badge,避免双显示)', () => {
    const entry = { resultText: 'denied content', isPermissionDenied: true };
    assert.equal(compactResultPreview(entry), null);
  });

  it('isInputValidationError: true → null', () => {
    const entry = { resultText: 'validation failed', isInputValidationError: true };
    assert.equal(compactResultPreview(entry), null);
  });

  it('普通 Bash 超长输出(60 行,> default maxLines=50) → 截断 + 末尾"…"', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
    const entry = { resultText: lines, toolName: 'Bash' };
    const r = compactResultPreview(entry);
    assert.ok(r);
    const out = r.text.split('\n');
    assert.equal(out.length, 51); // 50 行 + 末尾 "…"
    assert.equal(out[0], 'line 1');
    assert.equal(out[49], 'line 50');
    assert.equal(out[50], '…');
  });

  it('Bash 短输出(5 行,< maxLines)→ 不截断,无末尾"…"', () => {
    const entry = { resultText: 'a\nb\nc\nd\ne', toolName: 'Bash' };
    const r = compactResultPreview(entry);
    assert.ok(r);
    assert.equal(r.text, 'a\nb\nc\nd\ne');
  });

  it('Read 行号 strip(`   123→content` → `content`)', () => {
    const entry = {
      resultText: '   123→first line\n   124→second\n   125→third',
      toolName: 'Read',
    };
    const r = compactResultPreview(entry);
    assert.ok(r);
    assert.equal(r.text, 'first line\nsecond\nthird');
  });

  it('Bash ANSI strip(`\\x1b[31mERROR\\x1b[0m` → `ERROR`)', () => {
    const entry = {
      resultText: '\x1b[31mERROR\x1b[0m: something failed\nrest of output',
      toolName: 'Bash',
    };
    const r = compactResultPreview(entry);
    assert.ok(r);
    assert.equal(r.text, 'ERROR: something failed\nrest of output');
  });

  it('超长单行 (>500 字,default maxChars=500) → 截断 + "…"', () => {
    const longLine = 'x'.repeat(700);
    const entry = { resultText: longLine, toolName: 'Bash' };
    const r = compactResultPreview(entry);
    assert.ok(r);
    assert.equal(r.text.length, 501); // 500 + ellipsis
    assert.ok(r.text.endsWith('…'));
  });

  it('自定义 maxLines / maxChars 参数生效', () => {
    const entry = { resultText: 'a\nb\nc\nd\ne', toolName: 'Bash' };
    const r = compactResultPreview(entry, { maxLines: 2, maxChars: 50 });
    assert.ok(r);
    assert.equal(r.text, 'a\nb\n…');
  });

  it('非 Read / 非 Bash 工具:不做 strip(ANSI / 行号原样保留)', () => {
    const entry = {
      resultText: '\x1b[31mraw\x1b[0m\n   42→prefix\nthird',
      toolName: 'Grep',
    };
    const r = compactResultPreview(entry, { maxLines: 3 });
    assert.ok(r);
    assert.equal(r.text, '\x1b[31mraw\x1b[0m\n   42→prefix\nthird');
  });

  it('正好 maxLines 行的内容不加末尾"…"', () => {
    const entry = { resultText: 'a\nb\nc', toolName: 'Bash' };
    const r = compactResultPreview(entry, { maxLines: 3 });
    assert.ok(r);
    assert.equal(r.text, 'a\nb\nc');
  });

  it('全空白 resultText(strip 后为空) → null', () => {
    const entry = { resultText: '\x1b[31m\x1b[0m', toolName: 'Bash' };
    const r = compactResultPreview(entry);
    assert.equal(r, null);
  });
});

describe('extractToolResultImages', () => {
  it('提取 base64 image source → data URL', () => {
    const block = {
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo' } },
      ],
    };
    const r = extractToolResultImages(block);
    assert.equal(r.length, 1);
    assert.equal(r[0].src, 'data:image/png;base64,iVBORw0KGgo');
    assert.equal(r[0].mediaType, 'image/png');
  });

  it('提取 url image source', () => {
    const block = {
      content: [
        { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
      ],
    };
    const r = extractToolResultImages(block);
    assert.equal(r[0].src, 'https://example.com/a.png');
  });

  it('混合 text + image → 仅返回 image', () => {
    const block = {
      content: [
        { type: 'text', text: '[image content]' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      ],
    };
    const r = extractToolResultImages(block);
    assert.equal(r.length, 1);
    assert.equal(r[0].mediaType, 'image/jpeg');
  });

  it('无 image → 空数组', () => {
    const block = { content: [{ type: 'text', text: 'hello' }] };
    assert.deepEqual(extractToolResultImages(block), []);
  });

  it('content 为 string / undefined / null → 空数组', () => {
    assert.deepEqual(extractToolResultImages({ content: 'plain' }), []);
    assert.deepEqual(extractToolResultImages({}), []);
    assert.deepEqual(extractToolResultImages(null), []);
  });

  it('image 块字段缺失或损坏 → 跳过', () => {
    const block = {
      content: [
        { type: 'image' }, // 无 source
        { type: 'image', source: {} }, // source 无 data/url
        { type: 'image', source: { type: 'base64', data: 'X' } }, // 无 media_type
      ],
    };
    assert.deepEqual(extractToolResultImages(block), []);
  });
});

describe('compactResultPreview: 图片场景', () => {
  it('Read 图片文件:返回 images 数组,text 为 null', () => {
    const entry = buildSingleToolResultCore(
      {
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
      },
      { name: 'Read', input: { file_path: '/x.png' } }
    );
    const r = compactResultPreview(entry);
    assert.ok(r);
    assert.equal(r.images.length, 1);
    assert.ok(r.images[0].src.startsWith('data:image/png;base64,'));
    assert.equal(r.text, null);
  });

  it('图片 + 文本混合:images + text 都存在', () => {
    const entry = {
      images: [{ src: 'data:image/png;base64,X', mediaType: 'image/png' }],
      resultText: 'some accompanying text',
      toolName: 'Read',
    };
    const r = compactResultPreview(entry);
    assert.ok(r);
    assert.equal(r.images.length, 1);
    assert.equal(r.text, 'some accompanying text');
  });

  it('只有 images、无 text 时:permissionDenied 仍返回 null', () => {
    const entry = {
      images: [{ src: 'data:image/png;base64,X', mediaType: 'image/png' }],
      isPermissionDenied: true,
    };
    assert.equal(compactResultPreview(entry), null);
  });
});
