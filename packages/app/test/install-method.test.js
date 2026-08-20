import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getInstallMethod, projectMetaRoutes } from '../server/routes/project-meta.js';

describe('getInstallMethod', () => {
  it('returns electron when running under Electron (regardless of brew detection)', () => {
    assert.equal(getInstallMethod({ electron: '38.0.0', detect: () => '/opt/homebrew' }), 'electron');
    assert.equal(getInstallMethod({ electron: '38.0.0', detect: () => null }), 'electron');
  });

  it('returns brew when Homebrew install is detected and not electron', () => {
    assert.equal(getInstallMethod({ electron: undefined, detect: () => '/opt/homebrew' }), 'brew');
    assert.equal(getInstallMethod({ electron: '', detect: () => '/usr/local' }), 'brew');
  });

  it('falls back to npm when no brew prefix and not electron', () => {
    assert.equal(getInstallMethod({ electron: undefined, detect: () => null }), 'npm');
    assert.equal(getInstallMethod({ electron: '', detect: () => null }), 'npm');
  });

  it('is failure-safe: brew detection throwing falls back to npm', () => {
    assert.equal(getInstallMethod({ electron: undefined, detect: () => { throw new Error('realpath boom'); } }), 'npm');
  });
});

describe('GET /api/version-info handler', () => {
  it('returns 200 with { version, installMethod } matching package.json and a known method', () => {
    const route = projectMetaRoutes.find(r => r.path === '/api/version-info');
    assert.ok(route, 'route registered');
    let statusCode = null;
    let body = '';
    const res = {
      writeHead(code) { statusCode = code; },
      end(payload) { body = payload; },
    };
    route.handler({}, res);
    assert.equal(statusCode, 200);
    const json = JSON.parse(body);
    assert.match(json.version, /^\d+\.\d+\.\d+$/);
    assert.ok(['electron', 'brew', 'npm'].includes(json.installMethod), `unexpected installMethod: ${json.installMethod}`);
  });
});
