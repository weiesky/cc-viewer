// skillImportErrors mapping + source-contract guards: both skill-add entry points
// (CachePopoverContent user-level, ImPlatformSettings IM-level) must use the shared
// error-code → i18n mapping so strict skill-spec rejections surface localized messages.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { skillImportErrorKey } from '../src/utils/skillImportErrors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');

describe('skillImportErrorKey', () => {
  it('maps every server error code to its i18n key', () => {
    assert.equal(skillImportErrorKey('INVALID_TYPE'), 'ui.skills.invalidType');
    assert.equal(skillImportErrorKey('MISSING_SKILL_MD'), 'ui.skills.missingSkillMd');
    assert.equal(skillImportErrorKey('INVALID_FRONTMATTER'), 'ui.skills.invalidFrontmatter');
    assert.equal(skillImportErrorKey('MISSING_NAME'), 'ui.skills.missingName');
    assert.equal(skillImportErrorKey('INVALID_NAME'), 'ui.skills.invalidName');
    assert.equal(skillImportErrorKey('MISSING_DESCRIPTION'), 'ui.skills.missingDescription');
    assert.equal(skillImportErrorKey('ZIP_BOMB'), 'ui.skills.tooLarge');
    assert.equal(skillImportErrorKey('TOO_LARGE'), 'ui.skills.tooLarge');
    assert.equal(skillImportErrorKey('INVALID_ZIP'), 'ui.skills.invalidZip');
    assert.equal(skillImportErrorKey('EXISTS'), 'ui.skills.exists');
  });

  it('returns null for unknown codes (caller falls back to raw server text)', () => {
    assert.equal(skillImportErrorKey('unknown'), null);
    assert.equal(skillImportErrorKey(undefined), null);
    assert.equal(skillImportErrorKey(''), null);
  });
});

describe('skill import wiring (source contract)', () => {
  const components = [
    'components/dashboard/CachePopoverContent.jsx',
    'components/settings/ImPlatformSettings.jsx',
  ];

  for (const rel of components) {
    it(`${rel}: uses the shared error-code mapping for import failures`, () => {
      const code = src(rel);
      assert.ok(code.includes('skillImportErrorKey'), 'must use the shared error-code mapping');
      assert.ok(!code.includes('zipMissingSkillMd'), 'removed i18n key must not be referenced');
      assert.ok(!code.includes('folderMissingSkillMd'), 'removed i18n key must not be referenced');
    });

    it(`${rel}: import errors render inline (setSkillImportError + Alert), not only a global toast`, () => {
      const code = src(rel);
      assert.ok(code.includes('setSkillImportError'), 'must drive an inline error state');
      assert.ok(code.includes('skillImportError &&'), 'must render the inline Alert');
    });
  }
});
