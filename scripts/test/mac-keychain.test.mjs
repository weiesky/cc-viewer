import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

// Exercise the installed dependency without touching a real keychain or secrets.
const electronRequire = createRequire(new URL('../../apps/electron/package.json', import.meta.url));
const builderRequire = createRequire(electronRequire.resolve('electron-builder'));
const signingPath = builderRequire.resolve('app-builder-lib/out/codeSign/macCodeSign.js');
const dependencyRequire = createRequire(signingPath);
const source = readFileSync(signingPath, 'utf8');

for (const installer of [false, true]) {
  test(`keychain ACL uses the keychain password (${installer ? 'two certificates' : 'one certificate'})`, async () => {
    const calls = [];
    let keychainPassword;
    const exports = {};
    runInNewContext(source, {
      exports,
      __dirname: dirname(signingPath),
      process: { platform: 'darwin', env: { TRAVIS: 'true' } },
      require(id) {
        if (id === 'builder-util') return {
          async exec(command, args) {
            assert.equal(command, '/usr/bin/security');
            calls.push(args);
            if (args[0] === 'create-keychain') keychainPassword = args[2];
            if (args[0] === 'unlock-keychain') assert.equal(args[2], keychainPassword);
            if (args[0] === 'set-key-partition-list') {
              assert.equal(args[args.indexOf('-k') + 1], keychainPassword,
                'ACL configuration must unlock with the random keychain password, not the P12 password');
            }
            return '';
          },
        };
        if (id === './codesign') return { importCertificate: async link => link };
        return dependencyRequire(id);
      },
    });
    await exports.createKeychain({
      tmpDir: {}, currentDir: '/mock/project',
      cscLink: '/mock/application.p12', cscKeyPassword: 'application-export-password',
      ...(installer ? { cscILink: '/mock/installer.p12', cscIKeyPassword: 'installer-export-password' } : {}),
    });
    assert.ok(keychainPassword);
    assert.notEqual(keychainPassword, 'application-export-password');
    const imports = calls.filter(args => args[0] === 'import');
    assert.deepEqual(imports.map(args => args[args.indexOf('-P') + 1]),
      installer ? ['application-export-password', 'installer-export-password'] : ['application-export-password']);
    assert.equal(calls.filter(args => args[0] === 'set-key-partition-list').length, imports.length);
  });
}
