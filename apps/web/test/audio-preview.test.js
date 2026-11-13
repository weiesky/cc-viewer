import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(ROOT, path), 'utf-8');
const component = read('src/components/viewers/AudioPreview.jsx');
const css = read('src/components/viewers/AudioPreview.module.css');
const i18n = read('src/i18n.js');
const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];

describe('audio preview wiring', () => {
  it('streams inline via /api/audio-stream without autoplay or Blob', () => {
    assert.ok(component.includes('`/api/audio-stream?path=${encodeURIComponent(filePath)}`'));
    assert.ok(component.includes('apiUrl(withViewParams('));
    assert.ok(component.includes('<audio'));
    assert.ok(component.includes('controls'));
    assert.ok(component.includes('preload="none"'));
    // Must not appear as a JSX attribute (the "No autoplay" comment does not count).
    for (const forbidden of ['autoPlay={', 'autoPlay ', ' autoplay ', 'createObjectURL(', 'fetch(']) {
      assert.ok(!component.includes(forbidden), forbidden);
    }
  });

  it('falls back to the download route on playback error', () => {
    assert.ok(component.includes('`/api/download-file?path=${encodeURIComponent(filePath)}`'));
    assert.ok(component.includes('onError'));
    assert.ok(component.includes('setFailed(true)'));
    assert.ok(component.includes("t('ui.filePreview.audio.error')"));
    assert.ok(component.includes('download={downloadName}'));
  });

  it('has accessible, rule-compliant styles', () => {
    assert.ok(!css.includes('!important'));
    assert.ok(css.includes(':focus-visible'));
  });

  it('routes GitChanges single-click to the viewer via opensInFileViewer', () => {
    const chatView = read('src/components/chat/ChatView.jsx');
    assert.ok(chatView.includes('opensInFileViewer'));
    assert.ok(chatView.includes('opensInFileViewer(getPreviewKind(resolvedPath))'));
    assert.ok(!chatView.includes('isDownloadOnlyPreview(getPreviewKind(resolvedPath))'));
  });

  it('defines the audio preview messages in all 18 locales', () => {
    for (const key of ['audio.hint', 'audio.error']) {
      const match = i18n.match(new RegExp(`^  "ui\\.filePreview\\.${key.replace('.', '\\.')}": \\{\\n([\\s\\S]*?)^  \\},`, 'm'));
      assert.ok(match, key);
      for (const locale of LOCALES) assert.ok(match[1].includes(`"${locale}":`), `${key} ${locale}`);
    }
  });
});
