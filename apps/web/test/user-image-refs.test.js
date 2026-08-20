import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findUserImageRefs } from '../src/utils/userImageRefs.js';

describe('findUserImageRefs', () => {
  it('returns [] for empty / non-string input', () => {
    assert.deepEqual(findUserImageRefs(''), []);
    assert.deepEqual(findUserImageRefs(null), []);
    assert.deepEqual(findUserImageRefs(undefined), []);
    assert.deepEqual(findUserImageRefs(42), []);
  });

  it('returns [] for plain text with no image refs', () => {
    assert.deepEqual(findUserImageRefs('这是一条普通消息,没有图片'), []);
  });

  // ── 核心回归：终端粘贴的「裸路径」(无引号),正是本次修复的缺口 ──
  it('matches a bare upload path glued onto preceding text (the bug)', () => {
    const text = '在这个位置不展示用周/tmp/cc-viewer-uploads/image-1780155819036.png';
    const refs = findUserImageRefs(text);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/image-1780155819036.png');
    assert.equal(refs[0].raw, '/tmp/cc-viewer-uploads/image-1780155819036.png');
    assert.equal(text.slice(refs[0].index), refs[0].raw); // index 指向路径起点
  });

  it('matches a bare upload path delimited by surrounding whitespace', () => {
    const refs = findUserImageRefs('看图 /tmp/cc-viewer-uploads/a.jpeg 谢谢');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/a.jpeg');
    assert.equal(refs[0].raw, '/tmp/cc-viewer-uploads/a.jpeg'); // 不吞掉后面的空格与文字
  });

  it('still matches the double-quoted upload path and consumes the quotes', () => {
    const refs = findUserImageRefs('"/tmp/cc-viewer-uploads/b.png"');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/b.png');
    assert.equal(refs[0].raw, '"/tmp/cc-viewer-uploads/b.png"'); // raw 含引号 → 文本里不残留 "
  });

  it('matches a single-quoted upload path and consumes the quotes (no stray quotes)', () => {
    const refs = findUserImageRefs("'/tmp/cc-viewer-uploads/image-1780160202730.png'");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/image-1780160202730.png');
    // raw 必须把成对的单引号一起吃掉,否则渲染后 ' ' 会残留在图片两侧
    assert.equal(refs[0].raw, "'/tmp/cc-viewer-uploads/image-1780160202730.png'");
  });

  it('matches the [Image: source: …] placeholder form', () => {
    const refs = findUserImageRefs('before [Image: source: /tmp/cc-viewer-uploads/c.png] after');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/c.png');
    assert.equal(refs[0].raw, '[Image: source: /tmp/cc-viewer-uploads/c.png]');
  });

  it('matches the macOS /private realpath variant', () => {
    const refs = findUserImageRefs('/private/tmp/cc-viewer-uploads/d.webp');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/private/tmp/cc-viewer-uploads/d.webp');
  });

  it('finds multiple refs in order', () => {
    const text = '一 /tmp/cc-viewer-uploads/a.png 二 "/tmp/cc-viewer-uploads/b.gif" 三';
    const refs = findUserImageRefs(text);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/a.png');
    assert.equal(refs[1].path, '/tmp/cc-viewer-uploads/b.gif');
    assert.ok(refs[0].index < refs[1].index);
  });

  it('ignores non-image extensions in the upload dir', () => {
    assert.deepEqual(findUserImageRefs('/tmp/cc-viewer-uploads/notes.txt'), []);
    assert.deepEqual(findUserImageRefs('"/tmp/cc-viewer-uploads/data.json"'), []);
  });

  it('does not match arbitrary paths outside the upload dir (avoid false positives)', () => {
    assert.deepEqual(findUserImageRefs('参见 /home/user/pic.png 这张'), []);
    assert.deepEqual(findUserImageRefs('/var/tmp/cc-viewer-uploads-fake/x.png'), []);
  });

  it('stops a bare path at a closing paren (markdown image syntax)', () => {
    const refs = findUserImageRefs('![alt](/tmp/cc-viewer-uploads/e.png)');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, '/tmp/cc-viewer-uploads/e.png');
    assert.equal(refs[0].raw, '/tmp/cc-viewer-uploads/e.png'); // 不含右括号
  });
});
