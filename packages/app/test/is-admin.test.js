import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isAdminReq } from '../server/lib/is-admin.js';

describe('server/lib/is-admin.js isAdminReq', () => {
  it('loopback (isLocal=true) is admin regardless of req flag', () => {
    assert.equal(isAdminReq({}, true), true);
    assert.equal(isAdminReq({ ccvIsAdmin: false }, true), true);
    assert.equal(isAdminReq(undefined, true), true);
  });

  it('remote with req.ccvIsAdmin === true is admin', () => {
    assert.equal(isAdminReq({ ccvIsAdmin: true }, false), true);
  });

  it('remote without a true flag is NOT admin', () => {
    assert.equal(isAdminReq({ ccvIsAdmin: false }, false), false);
    assert.equal(isAdminReq({}, false), false);
    assert.equal(isAdminReq({ ccvIsAdmin: 'true' }, false), false); // string, not boolean
    assert.equal(isAdminReq({ ccvIsAdmin: 1 }, false), false);       // truthy but not === true
    assert.equal(isAdminReq(undefined, false), false);
    assert.equal(isAdminReq(null, false), false);
  });

  it('undefined isLocal is treated as not-local', () => {
    assert.equal(isAdminReq({ ccvIsAdmin: true }, undefined), true);
    assert.equal(isAdminReq({}, undefined), false);
  });
});
