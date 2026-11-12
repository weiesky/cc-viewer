import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './_shims/register.mjs';

const { t } = await import('../src/i18n.js');
const i18nSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/i18n.js'), 'utf-8');
const i18n = Object.fromEntries([...i18nSource.matchAll(/^  "(ui\.archive\.[^"]+)": \{\n([\s\S]*?)^  \},/gm)].map(match => [match[1], Object.fromEntries([...match[2].matchAll(/"([a-zA-Z-]+)":\s*"(?:[^"\\]|\\.)*"/g)].map(entry => [entry[1], entry[0]]))]));
const { archiveErrorText, archiveNoteText, archiveEntryStatus, getArchivePreviewKind } = await import('../src/utils/archivePreview.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'src/components/viewers/ArchivePreview.jsx'), 'utf-8');
const wrapper = readFileSync(join(ROOT, 'src/components/files/FileContentView.jsx'), 'utf-8');
const css = readFileSync(join(ROOT, 'src/components/viewers/ArchivePreview.module.css'), 'utf-8');
const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];

describe('archive preview wiring and accessibility', () => {
  it('routes through a hook-free lazy wrapper shared by all existing file viewers', () => {
    const wrapperSource = wrapper.slice(wrapper.lastIndexOf('export default function FileContentView'));
    assert.ok(wrapperSource.includes("const kind = getPreviewKind(props.filePath)"));
    assert.ok(wrapperSource.includes("if (kind === 'archive')"));
    assert.ok(!wrapperSource.includes('useState'));
    assert.ok(wrapper.includes("import('../viewers/ArchivePreview')"));
    assert.ok(wrapper.includes('function FileContentViewImpl({'));
    assert.ok(wrapperSource.includes('key={props.filePath}'));
    for (const host of ['components/chat/ChatView.jsx', 'components/files/FileBrowserModal.jsx', 'components/mobile/MobileFileExplorer.jsx']) {
      assert.ok(readFileSync(join(ROOT, 'src', host), 'utf-8').includes('<FileContentView'));
    }
  });

  it('uses scoped bytes/download, aborts fetches and revokes image URLs', () => {
    assert.ok(source.includes('`/api/archive-raw?path=${encodeURIComponent(filePath)}`'));
    assert.ok(source.includes('`/api/download-file?path=${encodeURIComponent(filePath)}`'));
    assert.ok(source.includes('apiUrl(withViewParams('));
    assert.ok(source.includes('new AbortController()'));
    assert.ok(source.includes('URL.revokeObjectURL'));
    assert.ok(source.includes('resetBudget'));
    assert.ok(!source.includes('dangerouslySetInnerHTML'));
    assert.ok(!source.includes('sanitizeSvg'));
    assert.ok(!source.includes('!important') && !css.includes('!important'));
    assert.ok(source.includes('role="button"'));
    assert.ok(source.includes("reportSwallowed('archivePreview.errorBody'"));
    assert.ok(source.includes('aria-expanded'));
  });

  it('uses only known raster images and read-only entries', () => {
    assert.ok(source.includes('png|jpe?g|gif|bmp|webp|apng|jfif'));
    assert.ok(!source.includes('image/svg+xml'));
    assert.ok(source.includes('readEntryText'));
  });
});

describe('archive preview localization', () => {
  const keys = Object.keys(i18n).filter(key => key.startsWith('ui.archive.'));
  it('defines every static viewer key in all 18 locales', () => {
    assert.ok(keys.length >= 25);
    for (const match of source.matchAll(/t\('(ui\.archive\.[^']+)'/g)) assert.ok(keys.includes(match[1]), match[1]);
    for (const key of keys) {
      for (const locale of LOCALES) assert.equal(typeof i18n[key]?.[locale], 'string', `${key} ${locale}`);
    }
  });

  it('maps every emitted structured note/error to a translation', () => {
    const vendor = readdirSync(join(ROOT, 'src/vendor/archive')).filter(name => name.endsWith('.js')).map(name => readFileSync(join(ROOT, 'src/vendor/archive', name), 'utf-8')).join('\n');
    for (const match of vendor.matchAll(/code:\s*'([A-Z0-9_]+)'/g)) {
      const code = match[1];
      if (['ENTRY_LIMIT', 'TOTAL_SIZE_LIMIT', 'NAME_ENCODING', 'GZIP_TRUNCATED', 'GZIP_NOT_TAR', 'ENTRY_TRUNCATED', 'CRC_MISMATCH', 'LINK_ENTRY', 'SPARSE_ENTRY', 'UNSUPPORTED_FORMAT', 'ZIP64_MISSING', 'CENTRAL_DIR_TRUNCATED', 'CENTRAL_DIR_EARLY_END', 'CENTRAL_DIR_BAD_ENTRY', 'TAR_CHECKSUM', 'TAR_ENTRY_TRUNCATED', 'TAR_TAIL_MISSING', 'DEVICE_ENTRY', 'SIZE_MISMATCH'].includes(code)) {
        assert.ok(keys.includes(`ui.archive.note.${code}`), code);
        assert.ok(!archiveNoteText({ code, params: {} }, t, String).startsWith('ui.archive.'));
      }
    }
    for (const code of ['ENCRYPTED', 'UNSUPPORTED_METHOD', 'NO_DECOMPRESSION', 'CORRUPT']) {
      assert.ok(keys.includes(`ui.archive.error.${code}`));
      assert.ok(!archiveErrorText({ code }, t).startsWith('ui.archive.'));
    }
  });

  it('covers every dynamic entry status and unsupported format', () => {
    const statuses = new Set(['empty', 'text', 'binary', 'link', 'device', 'image']);
    for (const result of [
      { textualHint: 'empty' }, { textualHint: 'text' }, { textualHint: 'binary' },
      { textualHint: 'image', truncated: false }, { textualHint: 'image', truncated: true },
      { textualHint: 'empty', notes: [{ code: 'LINK_ENTRY' }] },
      { textualHint: 'empty', notes: [{ code: 'DEVICE_ENTRY' }] },
      { textualHint: 'future' },
    ]) {
      const status = archiveEntryStatus(result);
      assert.ok(statuses.has(status));
      if (status !== 'text' && status !== 'image') assert.ok(keys.includes(`ui.archive.entry.${status}`), status);
    }
    for (const name of ['a.7z', 'a.rar', 'a.xz', 'a.bz2', 'a.txz', 'a.tbz', 'a.tbz2']) {
      const kind = getArchivePreviewKind(name);
      assert.ok(keys.includes(`ui.archive.unsupported.${kind.format}`), kind.format);
    }
  });

  it('keeps the vendored core platform-neutral and English-only', () => {
    for (const name of readdirSync(join(ROOT, 'src/vendor/archive')).filter(name => name.endsWith('.js'))) {
      const text = readFileSync(join(ROOT, 'src/vendor/archive', name), 'utf-8');
      assert.ok(!/node:|process\.|window\.|document\.|powershell|win32/i.test(text), name);
      assert.ok(!/[㐀-鿿]/u.test(text), name);
    }
  });
});
