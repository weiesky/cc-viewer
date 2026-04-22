import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseLoadedSkills } from '../src/utils/skillsParser.js';

describe('parseLoadedSkills', () => {
  it('returns [] when header sentence is missing', () => {
    assert.deepEqual(parseLoadedSkills('no header here\n- foo: bar'), []);
  });

  it('returns [] when header exists but no bullet list follows', () => {
    assert.deepEqual(
      parseLoadedSkills('The following skills are available for use with the Skill tool:\n\nnothing here'),
      [],
    );
  });

  it('parses a single item', () => {
    const text = 'The following skills are available for use with the Skill tool:\n\n- foo: bar';
    assert.deepEqual(parseLoadedSkills(text), [{ name: 'foo', description: 'bar' }]);
  });

  it('parses multiple items separated by newlines', () => {
    const text = 'skills are available for use with the Skill tool:\n- a: x\n- b: y';
    assert.deepEqual(parseLoadedSkills(text), [
      { name: 'a', description: 'x' },
      { name: 'b', description: 'y' },
    ]);
  });

  it('joins multi-line descriptions with newlines (preserves paragraph structure for modal)', () => {
    const text = 'skills are available for use with the Skill tool:\n- a: first\ncontinuation\n- b: tail';
    const res = parseLoadedSkills(text);
    assert.equal(res.length, 2);
    assert.equal(res[0].name, 'a');
    assert.equal(res[0].description, 'first\ncontinuation');
    assert.equal(res[1].name, 'b');
    assert.equal(res[1].description, 'tail');
  });

  it('treats blank line as flush but keeps scanning for later dashes', () => {
    const text = 'skills are available for use with the Skill tool:\n- a: x\n\n- b: y';
    assert.deepEqual(parseLoadedSkills(text), [
      { name: 'a', description: 'x' },
      { name: 'b', description: 'y' },
    ]);
  });

  it('keeps plugin: prefix in name', () => {
    const text = 'skills are available for use with the Skill tool:\n- plugin:foo: desc';
    assert.deepEqual(parseLoadedSkills(text), [{ name: 'plugin:foo', description: 'desc' }]);
  });

  it('keeps double-colon names verbatim (skill-creator:skill-creator)', () => {
    const text = 'skills are available for use with the Skill tool:\n- skill-creator:skill-creator: Create new skills';
    assert.deepEqual(parseLoadedSkills(text), [{ name: 'skill-creator:skill-creator', description: 'Create new skills' }]);
  });

  it('handles bullet with no description', () => {
    const text = 'skills are available for use with the Skill tool:\n- foo';
    assert.deepEqual(parseLoadedSkills(text), [{ name: 'foo', description: '' }]);
  });

  it('trims trailing lone colon when no space after it', () => {
    const text = 'skills are available for use with the Skill tool:\n- foo:';
    assert.deepEqual(parseLoadedSkills(text), [{ name: 'foo', description: '' }]);
  });

  it('treats non-indented lines as continuation (real Claude reminders do this)', () => {
    const text = 'skills are available for use with the Skill tool:\n- a: x\nTRIGGER when code\n- b: y';
    assert.deepEqual(parseLoadedSkills(text), [
      { name: 'a', description: 'x\nTRIGGER when code' },
      { name: 'b', description: 'y' },
    ]);
  });

  it('breaks the list when a blank line is followed by a non-dash paragraph', () => {
    const text = 'skills are available for use with the Skill tool:\n- a: x\n\nSome heading\n- b: y';
    assert.deepEqual(parseLoadedSkills(text), [{ name: 'a', description: 'x' }]);
  });

  it('returns [] for non-string or empty input', () => {
    assert.deepEqual(parseLoadedSkills(null), []);
    assert.deepEqual(parseLoadedSkills(undefined), []);
    assert.deepEqual(parseLoadedSkills(123), []);
    assert.deepEqual(parseLoadedSkills(''), []);
  });

  it('skips bullets whose name is empty (e.g. "- " line)', () => {
    const text = 'skills are available for use with the Skill tool:\n- \n- real: desc';
    assert.deepEqual(parseLoadedSkills(text), [{ name: 'real', description: 'desc' }]);
  });

  it('parses a realistic long sample (5 items with mixed shapes)', () => {
    const text = [
      'The following skills are available for use with the Skill tool:',
      '',
      '- update-config: Use this skill to configure the Claude Code harness via settings.json.',
      '- simplify: Review changed code for reuse, quality, and efficiency, then fix any issues found.',
      '- loop: Run a prompt on a recurring interval.',
      'Omit the interval to let the model self-pace.',
      '- plugin:skill-creator:skill-creator: Create new skills',
      '- init: Initialize a new CLAUDE.md file with codebase documentation',
    ].join('\n');
    const res = parseLoadedSkills(text);
    assert.equal(res.length, 5);
    assert.equal(res[0].name, 'update-config');
    assert.equal(res[1].name, 'simplify');
    assert.equal(res[2].name, 'loop');
    assert.equal(res[2].description, 'Run a prompt on a recurring interval.\nOmit the interval to let the model self-pace.');
    assert.equal(res[3].name, 'plugin:skill-creator:skill-creator');
    assert.equal(res[3].description, 'Create new skills');
    assert.equal(res[4].name, 'init');
  });
});
