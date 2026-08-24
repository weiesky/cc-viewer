import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseNpmPackFiles } from '../scripts/lib/npm-pack-json.mjs';

describe('parseNpmPackFiles', () => {
  it('extracts and sorts paths from npm pack JSON', () => {
    const output = JSON.stringify([{ files: [{ path: 'z.js' }, { path: 'a.js' }] }]);
    assert.deepEqual(parseNpmPackFiles(output), ['a.js', 'z.js']);
  });

  it('accepts the npm 12 object keyed by package name', () => {
    const output = JSON.stringify({
      'cc-viewer': { files: [{ path: 'server.js' }, { path: 'cli.js' }] },
    });
    assert.deepEqual(parseNpmPackFiles(output), ['cli.js', 'server.js']);
  });

  it('rejects the empty array returned by npm dry-run in CI', () => {
    assert.throws(() => parseNpmPackFiles('[]'), /no package file list.*array\(0\)/);
  });

  it('reports invalid JSON without leaking a TypeError', () => {
    assert.throws(() => parseNpmPackFiles('not json'), /npm pack returned invalid JSON/);
  });

  it('surfaces npm JSON error summaries', () => {
    const output = JSON.stringify({ error: { summary: 'Invalid package' } });
    assert.throws(() => parseNpmPackFiles(output), /npm pack failed: Invalid package/);
  });
});
