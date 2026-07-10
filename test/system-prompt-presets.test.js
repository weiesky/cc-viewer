// Unit + route tests for the built-in system-prompt presets:
//   - server/lib/system-prompt-presets.js (listSystemPromptPresets / groupPresetsByCategory)
//   - GET /api/expert/system-prompt-presets (direct handler invocation, fast tier)
// English comments only (CLAUDE.md).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listSystemPromptPresets, groupPresetsByCategory, getSystemPromptVariablesDoc } from '../server/lib/system-prompt-presets.js';
import { expertRoutes } from '../server/routes/expert.js';

const EXPECTED_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'GLM-5.2', 'Qwen-3.7-Max', 'kimi-k2.7-code'];

describe('listSystemPromptPresets', () => {
  const presets = listSystemPromptPresets();

  it('returns the five [Global] presets with the expected shape', () => {
    assert.equal(presets.length, 5);
    for (const p of presets) {
      assert.equal(typeof p.id, 'string');
      assert.equal(typeof p.title, 'string');
      assert.equal(p.category, 'Global');
      assert.ok(['append', 'override'].includes(p.defaultMode));
      assert.ok(p.text.length > 0);
    }
    assert.deepEqual(presets.map(p => p.id).sort(), [...EXPECTED_IDS].sort());
  });

  it('each preset text is raw editor text: preamble + OS env + verbatim memory, no boundary, no git', () => {
    for (const p of presets) {
      assert.ok(p.text.includes('${os.platform}'), `${p.id}: OS placeholders literal`);
      assert.ok(p.text.includes('You are'), `${p.id}: preamble present`);
      assert.match(p.text, /^# Environment$/m, `${p.id}: environment (OS) section present`);
      assert.match(p.text, /^# Memory$/m, `${p.id}: memory section present`);
      assert.ok(p.text.includes('${memory.dir}'), `${p.id}: memory section copied verbatim`);
      assert.doesNotMatch(p.text, /^# Git$/m, `${p.id}: git section omitted`);
      assert.ok(!p.text.includes('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'), `${p.id}: no boundary marker`);
      assert.doesNotMatch(p.text, /\n\n\n/, `${p.id}: no stray blank lines`);
    }
  });

  it('presets default to override mode (full base template replaces, not appends)', () => {
    for (const p of presets) assert.equal(p.defaultMode, 'override');
  });

  it('groupPresetsByCategory groups under Global', () => {
    const grouped = groupPresetsByCategory(presets);
    assert.deepEqual(Object.keys(grouped), ['Global']);
    assert.equal(grouped.Global.length, 5);
  });
});

describe('GET /api/expert/system-prompt-presets', () => {
  function routeFor() {
    const r = expertRoutes.find(
      x => x.method === 'GET' && x.path === '/api/expert/system-prompt-presets',
    );
    assert.ok(r, 'route GET /api/expert/system-prompt-presets must exist');
    return r.handler;
  }
  function makeRes() {
    return {
      code: null, body: null, headers: null,
      writeHead(code, headers) { this.code = code; this.headers = headers; },
      end(s) { this.body = s; },
      json() { return JSON.parse(this.body); },
    };
  }

  it('returns 200 with presets + categories + variablesDoc', async () => {
    const res = makeRes();
    await routeFor()({}, res, null, true, { MAX_POST_BODY: 1024, isWorkspaceMode: false });
    assert.equal(res.code, 200);
    const j = res.json();
    assert.equal(j.presets.length, 5);
    assert.equal(j.categories.Global.length, 5);
    assert.ok(j.presets[0].text.includes('${'));
    assert.ok(typeof j.variablesDoc === 'string' && j.variablesDoc.length > 0, 'variablesDoc served');
    assert.ok(j.variablesDoc.includes('${memory.dir}'), 'variablesDoc is the parameter reference');
  });

  it('?lang=zh serves the localized variablesDoc; no param serves the English base', async () => {
    const zhRes = makeRes();
    const zhUrl = new URL('http://localhost/api/expert/system-prompt-presets?lang=zh');
    await routeFor()({}, zhRes, zhUrl, true, { MAX_POST_BODY: 1024, isWorkspaceMode: false });
    assert.equal(zhRes.code, 200);
    const zhDoc = zhRes.json().variablesDoc;
    assert.ok(zhDoc.includes('${memory.dir}'), 'localized doc keeps placeholders literal');

    const enRes = makeRes();
    await routeFor()({}, enRes, null, true, { MAX_POST_BODY: 1024, isWorkspaceMode: false });
    assert.notEqual(zhDoc, enRes.json().variablesDoc, 'zh doc differs from the default English doc');
  });
});

describe('getSystemPromptVariablesDoc', () => {
  it('returns the parameter reference markdown', () => {
    const doc = getSystemPromptVariablesDoc();
    assert.ok(doc.length > 0);
    assert.ok(doc.includes('## Memory'), 'documents the Memory variables');
    assert.ok(doc.includes('${scratchpad.dir}'), 'documents the Scratchpad variable');
  });

  it('serves the localized doc for a known lang, keeping placeholders literal', () => {
    const zh = getSystemPromptVariablesDoc('zh');
    assert.ok(zh.length > 0);
    assert.ok(zh.includes('${memory.dir}'), 'placeholders survive translation');
    assert.ok(zh.includes('${scratchpad.dir}'), 'placeholders survive translation');
    assert.notEqual(zh, getSystemPromptVariablesDoc(), 'zh doc differs from the English base');
  });

  it('falls back to the English base for en, unknown, and undefined lang', () => {
    const base = getSystemPromptVariablesDoc();
    assert.equal(getSystemPromptVariablesDoc('en'), base);
    assert.equal(getSystemPromptVariablesDoc('xx'), base);
    assert.equal(getSystemPromptVariablesDoc('../systemPromptModel'), base, 'traversal-shaped lang is ignored');
    assert.equal(getSystemPromptVariablesDoc(undefined), base);
  });
});
