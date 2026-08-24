import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseNpmPackFiles } from '../scripts/lib/npm-pack-json.mjs';

describe('parseNpmPackFiles', () => {
  it('extracts and sorts paths from npm pack JSON', () => {
    const output = JSON.stringify([{ files: [{ path: 'z.js' }, { path: 'a.js' }] }]);
    assert.deepEqual(parseNpmPackFiles(output), ['a.js', 'z.js']);
  });

  it('rejects the empty array returned by npm dry-run in CI', () => {
    assert.throws(() => parseNpmPackFiles('[]'), /no package file list.*array\(0\)/);
  });

  it('reports invalid JSON without leaking a TypeError', () => {
    assert.throws(() => parseNpmPackFiles('not json'), /npm pack returned invalid JSON/);
  });
});
