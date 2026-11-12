import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreviewKind, isDownloadOnlyPreview, opensInFileViewer, isBinaryContentError } from '../src/utils/previewKind.js';
import { isImageFile } from '../src/utils/commandValidator.js';

describe('shared preview kinds', () => {
  it('classifies every supported family', () => {
    const cases = {
      'a.zip': 'archive', 'a.TAR.GZ': 'archive', 'a.tar.bz2': 'archive',
      'a.PNG': 'image', 'a.html': 'html', 'a.HTM': 'html', 'a.xml': 'text',
      'a.md': 'markdown', 'a.markdown': 'markdown', 'a.MP3': 'audio',
      'a.oga': 'audio', 'a.AAC': 'audio', 'a.opus': 'audio',
      'a.webm': 'video', 'a.WOFF2': 'font', 'a.PDF': 'pdf',
      'a.srt': 'subtitle', 'a.VTT': 'subtitle', 'a.ass': 'subtitle', 'a.SSA': 'subtitle',
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
    for (const kind of ['video', 'font', 'pdf', 'binary']) assert.equal(isDownloadOnlyPreview(kind), true);
    for (const kind of ['audio', 'archive', 'image', 'html', 'markdown', 'text', 'subtitle', null]) assert.equal(isDownloadOnlyPreview(kind), false);
  });

  it('opens audio and download-only kinds in the file viewer, not the diff', () => {
    for (const kind of ['audio', 'video', 'font', 'pdf', 'binary']) assert.equal(opensInFileViewer(kind), true);
    // Subtitles are a normal preview: a GitChanges single-click still shows the text diff.
    for (const kind of ['archive', 'image', 'html', 'markdown', 'text', 'subtitle', null]) assert.equal(opensInFileViewer(kind), false);
  });

  it('keeps image classification aligned with preview routing', () => {
    assert.equal(isImageFile('C:\\images\\A.PNG'), true);
    assert.equal(isImageFile('anim.apng'), true);
    assert.equal(isImageFile('photo.jfif'), true);
    // Browser-undecodable image formats classify as 'image' but stay off the <img> route.
    assert.equal(isImageFile('photo.heic'), false);
    assert.equal(isImageFile('photo.tiff'), false);
    assert.equal(isImageFile('icon.icns'), false);
    assert.equal(isImageFile('.png'), false);
    assert.equal(isImageFile('image.png.txt'), false);
    assert.equal(isImageFile(null), false);
  });

  it('splits preview routing from icon classification for undecodable images', () => {
    // The whole point of NON_DECODABLE_IMAGE_EXTS: the file still gets the image
    // icon (getPreviewKind) but is never routed into an <img> viewer (isImageFile).
    for (const ext of ['heic', 'heif', 'tif', 'tiff', 'icns']) {
      assert.equal(getPreviewKind(`photo.${ext}`), 'image', `${ext} keeps the image icon`);
      assert.equal(isImageFile(`photo.${ext}`), false, `${ext} stays off the <img> route`);
    }
    for (const ext of ['apng', 'jfif']) {
      assert.equal(getPreviewKind(`photo.${ext}`), 'image', ext);
      assert.equal(isImageFile(`photo.${ext}`), true, ext);
    }
  });

  it('recognizes only the structured binary response', () => {
    assert.equal(isBinaryContentError(415, { reason: 'binary' }), true);
    assert.equal(isBinaryContentError(415, { reason: 'other' }), false);
    assert.equal(isBinaryContentError(403, { reason: 'binary' }), false);
    assert.equal(isBinaryContentError(415), false);
  });
});
