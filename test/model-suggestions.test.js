// Unit tests for src/utils/modelSuggestions.js — the pure collector behind the
// "+ Add model" dialog's name type-ahead (merges hot-reload proxy profiles and
// settings.json model fields into a sanitized, deduped suggestion list).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectModelSuggestions } from '../apps/web/src/utils/modelSuggestions.js';

describe('collectModelSuggestions', () => {
  it('extracts all model fields from every profile plus defaultConfig', () => {
    const profiles = {
      profiles: [
        {
          ANTHROPIC_MODEL: 'claude-opus-4-8',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus-big',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-mid',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-small',
          activeModel: 'legacy-model',
        },
        { ANTHROPIC_MODEL: 'kimi-k3' },
      ],
      defaultConfig: { origin: 'max', authType: 'oauth', model: 'claude-sonnet-4-8' },
    };
    assert.deepEqual(collectModelSuggestions(profiles, null), [
      'claude-opus-4-8',
      'opus-big',
      'sonnet-mid',
      'haiku-small',
      'legacy-model',
      'kimi-k3',
      'claude-sonnet-4-8',
    ]);
  });

  it('extracts settings.json model and env.ANTHROPIC_MODEL', () => {
    const cs = { model: 'GLM-5.2', env: { ANTHROPIC_MODEL: 'deepseek-v4-pro' } };
    assert.deepEqual(collectModelSuggestions(null, cs), ['GLM-5.2', 'deepseek-v4-pro']);
  });

  it('trims whitespace and drops empty/non-string values', () => {
    const cs = { model: '  padded-name  ', env: { ANTHROPIC_MODEL: '' } };
    const profiles = { profiles: [{ ANTHROPIC_MODEL: 42, activeModel: null }] };
    assert.deepEqual(collectModelSuggestions(profiles, cs), ['padded-name']);
  });

  it('drops the reserved "default" name case-insensitively', () => {
    const cs = { model: 'default', env: { ANTHROPIC_MODEL: 'DEFAULT' } };
    assert.deepEqual(collectModelSuggestions(null, cs), []);
  });

  it('drops names with the reserved _APPEND suffix (either casing)', () => {
    const profiles = { profiles: [{ ANTHROPIC_MODEL: 'FOO_APPEND', activeModel: 'foo_append' }] };
    assert.deepEqual(collectModelSuggestions(profiles, null), []);
  });

  it('strips the [1m] suffix instead of dropping the id', () => {
    const profiles = { profiles: [{ ANTHROPIC_MODEL: 'claude-opus-4-8[1m]' }] };
    assert.deepEqual(collectModelSuggestions(profiles, null), ['claude-opus-4-8']);
  });

  it('dedupes [1m]-stripped values against plain ones case-insensitively', () => {
    const profiles = { profiles: [{ ANTHROPIC_MODEL: 'k3[1m]', activeModel: 'K3' }] };
    assert.deepEqual(collectModelSuggestions(profiles, null), ['k3']);
  });

  it('dedupes case-insensitively and keeps the first occurrence casing', () => {
    const profiles = { profiles: [{ ANTHROPIC_MODEL: 'Opus' }, { ANTHROPIC_MODEL: 'opus' }] };
    assert.deepEqual(collectModelSuggestions(profiles, null), ['Opus']);
  });

  it('drops ids the server name grammar would reject (slashes etc.)', () => {
    const cs = { model: 'openrouter/claude-3.5', env: {} };
    assert.deepEqual(collectModelSuggestions(null, cs), []);
  });

  it('enforces the name grammar boundaries (leading alnum, 1-64 chars)', () => {
    const profiles = {
      profiles: [{
        ANTHROPIC_MODEL: '-leading-dash',        // must start alnum
        activeModel: '9starts-with-digit',       // digits allowed first
      }],
      defaultConfig: { model: 'x'.repeat(64) },  // max length, kept
    };
    const cs = { model: 'x'.repeat(65) };        // too long, dropped
    assert.deepEqual(collectModelSuggestions(profiles, cs), ['9starts-with-digit', 'x'.repeat(64)]);
  });

  it('tolerates garbage input without throwing', () => {
    assert.deepEqual(collectModelSuggestions(null, null), []);
    assert.deepEqual(collectModelSuggestions(undefined, undefined), []);
    assert.deepEqual(collectModelSuggestions({ profiles: 'nope' }, {}), []);
    assert.deepEqual(collectModelSuggestions({ profiles: [null, 7, 'x'] }, 'junk'), []);
  });
});
