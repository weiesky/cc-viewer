import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const electronRoot = fileURLToPath(new URL('..', import.meta.url));
const config = readFileSync(join(electronRoot, 'electron-builder.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8'));

describe('macOS notarization configuration', () => {
  it('uses electron-builder built-in notarization without an afterSign hook', () => {
    assert.match(config, /^\s{2}notarize:\s*true\s*$/m);
    assert.doesNotMatch(config, /^afterSign:/m);
    assert.equal(existsSync(join(electronRoot, 'build/notarize.js')), false);
  });

  it('does not install a second notarization implementation', () => {
    assert.equal(pkg.devDependencies?.['@electron/notarize'], undefined);
  });
});
