/**
 * ultraplan-teamcreate-free.test.js — guard the TeamCreate-free invariant.
 *
 * The UltraReview / codeExpert prompt and the Teammate concept docs must NOT
 * reference the `TeamCreate` / `TeamDelete` tools — they do not exist. A prior
 * pass (fcf50e24) removed them from the prompt templates but left the 36
 * Teammate.md files (18 locales × content+app trees) still teaching TeamCreate,
 * and none of the existing tests assert absence (the parity/agents tests only
 * pin byte-drift, so re-adding TeamCreate to both source and copy stays green).
 *
 * These tests assert the negative: no in-scope surface may contain the removed
 * tool names. They read the shipped files directly (source-contract style).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ULTRAPLAN_VARIANTS, buildCustomTemplate } from '../src/utils/ultraplanTemplates.js';
import { t } from '../src/i18n.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..', '..');

const FORBIDDEN = ['TeamCreate', 'TeamDelete'];

function assertTeamCreateFree(text, label) {
  for (const bad of FORBIDDEN) {
    assert.ok(!text.includes(bad), `${label} must not reference ${bad}`);
  }
}

const LOCALES = readdirSync(join(REPO, 'packages', 'content', 'concepts'))
  .filter(d => existsSync(join(REPO, 'packages', 'content', 'concepts', d, 'Teammate.md')));

describe('UltraReview/codeExpert prompt is TeamCreate-free', () => {
  it('ULTRAPLAN_VARIANTS codeExpert & researchExpert', () => {
    for (const [key, tpl] of Object.entries(ULTRAPLAN_VARIANTS)) {
      assertTeamCreateFree(tpl, `ULTRAPLAN_VARIANTS.${key}`);
    }
  });

  it('buildCustomTemplate output and i18n prefill skeleton', () => {
    assertTeamCreateFree(buildCustomTemplate('x'), 'buildCustomTemplate');
    assertTeamCreateFree(t('ui.ultraplan.customContentTemplate'), 'ui.ultraplan.customContentTemplate');
    assertTeamCreateFree(t('ui.preset.codeReview5.desc'), 'ui.preset.codeReview5.desc');
  });

  it('code-expert.json (ultraAgents preset)', () => {
    for (const tree of ['packages/content/ultraAgents', 'packages/app/ultraAgents']) {
      const p = join(REPO, tree, 'code-expert.json');
      if (existsSync(p)) assertTeamCreateFree(readFileSync(p, 'utf-8'), p);
    }
  });
});

describe('Teammate concept docs are TeamCreate-free across all locales & both trees', () => {
  it('content tree: no locale Teammate.md references TeamCreate/TeamDelete', () => {
    assert.ok(LOCALES.length >= 18, `expected ≥18 locales, got ${LOCALES.length}`);
    for (const loc of LOCALES) {
      const p = join(REPO, 'packages', 'content', 'concepts', loc, 'Teammate.md');
      assertTeamCreateFree(readFileSync(p, 'utf-8'), `content/${loc}/Teammate.md`);
    }
  });

  it('app tree mirrors the content tree (byte-identical Teammate.md)', () => {
    for (const loc of LOCALES) {
      const c = join(REPO, 'packages', 'content', 'concepts', loc, 'Teammate.md');
      const a = join(REPO, 'packages', 'app', 'concepts', loc, 'Teammate.md');
      if (!existsSync(a)) continue;
      assert.equal(readFileSync(a, 'utf-8'), readFileSync(c, 'utf-8'), `app/content ${loc} Teammate.md diverged`);
    }
  });
});
