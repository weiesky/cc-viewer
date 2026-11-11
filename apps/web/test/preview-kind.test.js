import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreviewKind, isDownloadOnlyPreview, isBinaryContentError } from '../src/utils/previewKind.js';
import { isImageFile } from '../src/utils/commandValidator.js';

describe('shared preview kinds', () => {
  it('classifies every supported family', () => {
    const cases = {
      'a.zip': 'archive', 'a.TAR.GZ': 'archive', 'a.tar.bz2': 'archive',
      'a.PNG': 'image', 'a.html': 'html', 'a.HTM': 'html', 'a.xml': 'text',
      'a.md': 'markdown', 'a.markdown': 'markdown', 'a.MP3': 'audio',
      'a.webm': 'video', 'a.WOFF2': 'font', 'a.PDF': 'pdf',
      'a.js': 'text', 'README': 'text', '.env': 'text', 'a.unknown': 'text',
      'a.docx': 'binary', 'a.wasm': 'binary', 'a.zip.txt': 'text',
    };
    for (const [path, expected] of Object.entries(cases)) assert.equal(getPreviewKind(path), expected, path);
  });

  it('uses the basename across POSIX, Windows, mixed and UNC paths', () => {
    for (const path of ['a.PDF', 'C:\\dir.with.dot\\a.PDF', 'C:/dir\\a.PDF', '//server/share/a.pdf']) {
      assert.equal(getPreviewKind(path), 'pdf', path);
    }
    assert.equal(getPreviewKind('C:\\'), 'text');
    assert.equal(getPreviewKind('C:\\dir.with.dot\\README'), 'text');
    assert.equal(getPreviewKind('C:\\dir\\Makefile'), 'text');
    assert.equal(getPreviewKind('.png'), 'text');
    assert.equal(getPreviewKind('src', 'directory'), null);
    assert.equal(getPreviewKind('', 'directory'), null);
  });

  it('routes only download-only kinds away from the text editor', () => {
    for (const kind of ['audio', 'video', 'font', 'pdf', 'binary']) assert.equal(isDownloadOnlyPreview(kind), true);
    for (const kind of ['archive', 'image', 'html', 'markdown', 'text', null]) assert.equal(isDownloadOnlyPreview(kind), false);
  });

  it('keeps image classification aligned with preview routing', () => {
    assert.equal(isImageFile('C:\\images\\A.PNG'), true);
    assert.equal(isImageFile('.png'), false);
    assert.equal(isImageFile('image.png.txt'), false);
    assert.equal(isImageFile(null), false);
  });

  it('recognizes only the structured binary response', () => {
    assert.equal(isBinaryContentError(415, { reason: 'binary' }), true);
    assert.equal(isBinaryContentError(415, { reason: 'other' }), false);
    assert.equal(isBinaryContentError(403, { reason: 'binary' }), false);
    assert.equal(isBinaryContentError(415), false);
  });
});
