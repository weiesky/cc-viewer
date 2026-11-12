import './_shims/register.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(ROOT, path), 'utf-8');
const component = read('src/components/viewers/SubtitlePreview.jsx');
const css = read('src/components/viewers/SubtitlePreview.module.css');
const i18n = read('src/i18n.js');
const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];

describe('subtitle preview wiring', () => {
  it('loads raw bytes via /api/file-raw with explicit project/instance scoping', () => {
    assert.ok(component.includes('`/api/file-raw?path=${encodeURIComponent(filePath)}`'));
    assert.ok(component.includes('apiUrl(withViewParams('));
    // withViewParams must receive { project, instance } explicitly — it does not
    // fall back to the bound project on its own.
    assert.ok(component.includes('const params = { project, instance }'));
    assert.ok(component.includes('withViewParams(`/api/file-raw?path=${encodeURIComponent(filePath)}`, params)'));
  });

  it('never routes subtitles through /api/file-content (GBK/Latin-1 would 415)', () => {
    // Strip comments before asserting: the component documents the decision in a
    // comment, which legitimately mentions the route name.
    const code = component.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!code.includes('/api/file-content'));
    assert.ok(!code.includes('/api/audio-stream'));
  });

  it('checks res.ok before reading bytes so a JSON 403/413 body is not parsed as cues', () => {
    assert.ok(component.includes('if (!res.ok)'));
    assert.ok(component.includes('res.json()'));
  });

  it('decodes with decodeTextBytes and passes the truncated flag for the byte cap', () => {
    assert.ok(component.includes('decodeTextBytes'));
    assert.ok(component.includes('truncated: byteTruncated'));
    assert.ok(component.includes('parseSubtitle'));
  });

  it('aborts in-flight loads on close and guards every setState', () => {
    assert.ok(component.includes('new AbortController()'));
    assert.ok(component.includes('controller.signal.aborted'));
    assert.ok(component.includes('controller.abort()'));
  });

  it('renders cues as plain text and never injects HTML', () => {
    for (const forbidden of ['dangerouslySetInnerHTML', 'renderMarkdown', 'innerHTML']) {
      assert.ok(!component.includes(forbidden), forbidden);
    }
  });

  it('offers a download fallback on error', () => {
    assert.ok(component.includes('`/api/download-file?path=${encodeURIComponent(filePath)}`'));
    assert.ok(component.includes('download={downloadName}'));
    assert.ok(component.includes("t('ui.filePreview.subtitle.error')"));
  });

  it('has accessible, rule-compliant styles', () => {
    assert.ok(!css.includes('!important'));
    assert.ok(css.includes(':focus-visible'));
  });

  it('defines every subtitle preview message in all 18 locales', () => {
    const keys = new Set();
    for (const m of component.matchAll(/t\('(ui\.filePreview\.subtitle\.[^']+)'/g)) keys.add(m[1]);
    // The component must use the keys the test then verifies.
    assert.ok(keys.size >= 7, `expected subtitle keys in component, found ${[...keys].join(',')}`);
    for (const key of keys) {
      const match = i18n.match(new RegExp(`^  "${key.replace(/\./g, '\\.')}": \\{\\n([\\s\\S]*?)^  \\},`, 'm'));
      assert.ok(match, key);
      for (const locale of LOCALES) assert.ok(match[1].includes(`"${locale}":`), `${key} ${locale}`);
    }
  });
});
