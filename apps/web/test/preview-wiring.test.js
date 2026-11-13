import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(ROOT, path), 'utf-8');
const wrapper = read('src/components/files/FileContentView.jsx');
const viewer = read('src/components/viewers/UnsupportedFilePreview.jsx');
const css = read('src/components/viewers/UnsupportedFilePreview.module.css');
const i18n = read('src/i18n.js');
const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];

describe('download-only preview wiring', () => {
  it('routes known binary and pending preview types before the text editor', () => {
    const dispatcher = wrapper.slice(wrapper.lastIndexOf('export default function FileContentView'));
    assert.ok(dispatcher.includes("const kind = getPreviewKind(props.filePath)"));
    assert.ok(dispatcher.includes("if (kind === 'archive')"));
    assert.ok(dispatcher.includes("if (kind === 'audio')"));
    assert.ok(dispatcher.includes('<AudioPreview'));
    assert.ok(dispatcher.includes("kind === 'subtitle'"));
    assert.ok(dispatcher.includes('<SubtitlePreview'));
    // Subtitle preview is read-only; an $EDITOR session must keep the editable editor.
    assert.ok(dispatcher.includes("kind === 'subtitle' && !props.editorSession"));
    assert.ok(dispatcher.includes('isDownloadOnlyPreview(kind)'));
    assert.ok(dispatcher.includes('<UnsupportedFilePreview'));
    assert.ok(!dispatcher.includes('useState'));
    assert.ok(wrapper.includes("getPreviewKind(filePath) === 'markdown'"));
    assert.ok(wrapper.includes('binaryFallback?.path === filePath'));
    assert.ok(wrapper.includes('isBinaryContentError(r.status, err)'));
    assert.ok(wrapper.includes('readOnly || binaryFallback || !isDirty'));
    assert.ok(wrapper.includes('new AbortController()'));
    assert.ok(wrapper.includes('controller.signal.aborted'));
    assert.ok(wrapper.includes('readOnlyProp || readOnlyEncoding?.path === filePath'));
    assert.ok(wrapper.includes('setReadOnlyEncoding(data.encoding || data.readOnly ? { path: filePath, encoding: data.encoding } : null)'));
  });

  it('provides scoped download without loading, editing, or injecting content', () => {
    assert.ok(viewer.includes('`/api/download-file?path=${encodeURIComponent(filePath)}`'));
    assert.ok(viewer.includes('apiUrl(withViewParams('));
    assert.ok(viewer.includes('download={downloadName}'));
    assert.ok(viewer.includes('role="status"'));
    assert.ok(viewer.includes('aria-label'));
    for (const forbidden of ['fetch(', 'useState', 'CodeMirror', 'dangerouslySetInnerHTML', '!important']) assert.ok(!viewer.includes(forbidden), forbidden);
    assert.ok(!css.includes('!important'));
    assert.ok(css.includes(':focus-visible'));
  });

  it('shares HTML classification without changing the modal order', () => {
    const browser = read('src/components/files/FileBrowserModal.jsx');
    const explorer = read('src/components/files/FileExplorer.jsx');
    assert.ok(browser.includes("getPreviewKind(item.name) === 'html'"));
    assert.ok(explorer.includes("getPreviewKind(childPath) === 'html'"));
    assert.ok(read('src/utils/commandValidator.js').includes("getPreviewKind(path) === 'image'"));
    assert.ok(read('src/utils/commandValidator.js').includes('NON_DECODABLE_IMAGE_EXTS'),
      'isImageFile must keep browser-undecodable image exts (tiff/heic/icns) off the <img> route');
  });

  it('defines every preview message in all 18 locales', () => {
    for (const key of ['title', 'download', 'contentBinary', 'utf16ReadOnly', 'kind.audio', 'kind.video', 'kind.font', 'kind.pdf', 'kind.binary', 'kind.unknown', 'audio.hint', 'audio.error', 'subtitle.listView', 'subtitle.rawView', 'subtitle.hint', 'subtitle.error', 'subtitle.cueLimit', 'subtitle.byteLimit', 'subtitle.empty', 'subtitle.encoding']) {
      const match = i18n.match(new RegExp(`^  "ui\\.filePreview\\.${key.replace('.', '\\.')}": \\{\\n([\\s\\S]*?)^  \\},`, 'm'));
      assert.ok(match, key);
      for (const locale of LOCALES) assert.ok(match[1].includes(`"${locale}":`), `${key} ${locale}`);
    }
  });
});
