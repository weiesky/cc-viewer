import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStageManifest } from '../scripts/stage-manifest.mjs';

const electronRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const appPkg = JSON.parse(readFileSync(join(repoRoot, 'packages/app/package.json'), 'utf8'));
const electronPkg = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8'));

describe('Electron stage manifest', () => {
  it('preserves repository metadata required by electron-builder publish detection', () => {
    const manifest = createStageManifest(appPkg, electronPkg);

    assert.deepEqual(manifest.repository, appPkg.repository);
    assert.equal(manifest.description, appPkg.description);
    assert.deepEqual(manifest.author, appPkg.author);
    assert.equal(manifest.homepage, appPkg.homepage);
    assert.deepEqual(manifest.bugs, appPkg.bugs);
  });

  it('keeps the Electron entry point and runtime dependency sets', () => {
    const manifest = createStageManifest(appPkg, electronPkg);

    assert.equal(manifest.main, 'electron/main.js');
    assert.equal(manifest.type, 'module');
    assert.deepEqual(manifest.dependencies, electronPkg.dependencies);
    assert.deepEqual(manifest.optionalDependencies, electronPkg.optionalDependencies);
  });
});
