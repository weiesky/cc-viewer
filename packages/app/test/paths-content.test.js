// Content extraction (packages/content, @ccv/content): _paths.js must resolve the four
// bundled-asset dirs into the content package in the dev repo. The probe prefers the
// content package even when an assembled copy exists inside packages/app (stale-residue
// guard); the installed tarball has no ../content sibling and falls back to the copy.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { existsSync } from 'node:fs';
import { CONCEPTS_DIR, ULTRA_AGENTS_DIR, IM_SKILLS_DIR, IM_PRESET_DIR } from '../server/_paths.js';

const EXPECTED = {
  CONCEPTS_DIR: ['packages', 'content', 'concepts'],
  ULTRA_AGENTS_DIR: ['packages', 'content', 'ultraAgents'],
  IM_SKILLS_DIR: ['packages', 'content', 'server', 'imSkills'],
  IM_PRESET_DIR: ['packages', 'content', 'server', 'imPreset'],
};

describe('content-package probes in _paths.js', () => {
  for (const [name, segments] of Object.entries(EXPECTED)) {
    it(`${name} resolves into packages/content and exists`, () => {
      const actual = { CONCEPTS_DIR, ULTRA_AGENTS_DIR, IM_SKILLS_DIR, IM_PRESET_DIR }[name];
      assert.ok(actual.endsWith(segments.join(sep)), `${name} = ${actual}`);
      assert.ok(existsSync(actual), `${name} target missing: ${actual}`);
    });
  }
});
