#!/usr/bin/env node
// Assemble the Electron staging directory (apps/electron/stage): a
// self-contained app root that combines the published package payload
// (packages/app) with the Electron shell (apps/electron/electron).
//
// electron-builder packs this staging dir (see electron-builder.yml,
// directories.app: stage). stage/electron and stage/server must stay side
// by side — the Electron rootDir probe (electron/main.js, tab-worker.js)
// detects the packaged layout by looking for ../server/server.js.
//
// stage/package.json is generated here so the desktop build always carries
// the npm package version (packages/app) and the exact runtime dependency
// set of @ccv/electron; electron-builder collects those deps (including
// the optional @anthropic-ai/claude-agent-sdk) into the packaged app.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ELECTRON_APP = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(ELECTRON_APP, '..', '..');
const APP_PKG = join(REPO_ROOT, 'packages', 'app');
const APP_ASSEMBLE = join(APP_PKG, 'scripts', 'assemble-dist.mjs');
const STAGE = join(ELECTRON_APP, 'stage');

// Payload dirs/files copied from the published package; relative to APP_PKG.
const APP_PAYLOAD = [
  'server',
  'cli.js',
  'findcc.js',
  'server.js',
  'interceptor.js',
  'concepts',
  'plugins',
  'ultraAgents',
  'dist',
];

// 1. Run the app assemble first: it copies apps/web/dist → packages/app/dist
//    and has its own freshness guards (fails loudly on a stale/missing web
//    build). Inherit stdio so its output surfaces in the build log.
execFileSync(process.execPath, [APP_ASSEMBLE], { stdio: 'inherit' });

// 2. Fail loudly on missing inputs before touching the stage.
for (const rel of APP_PAYLOAD) {
  if (!existsSync(join(APP_PKG, rel))) {
    throw new Error(`[assemble-app] missing payload input: packages/app/${rel} (run the app assemble first)`);
  }
}
if (!existsSync(join(ELECTRON_APP, 'electron', 'main.js'))) {
  throw new Error('[assemble-app] missing shell input: apps/electron/electron/main.js');
}

// 3. Rebuild the stage from scratch.
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const rel of APP_PAYLOAD) {
  cpSync(join(APP_PKG, rel), join(STAGE, rel), { recursive: true });
}
cpSync(join(ELECTRON_APP, 'electron'), join(STAGE, 'electron'), { recursive: true });

// 4. Generate stage/package.json. The desktop version mirrors the npm
//    package version; main/type point at the Electron shell; the runtime
//    dependencies come from @ccv/electron so electron-builder collects the
//    exact set the shell requires.
const appPkg = JSON.parse(readFileSync(join(APP_PKG, 'package.json'), 'utf8'));
const electronPkg = JSON.parse(readFileSync(join(ELECTRON_APP, 'package.json'), 'utf8'));
const stagePkg = {
  name: 'cc-viewer',
  version: appPkg.version,
  main: 'electron/main.js',
  type: 'module',
  dependencies: { ...electronPkg.dependencies },
  optionalDependencies: { ...electronPkg.optionalDependencies },
};
for (const section of ['dependencies', 'optionalDependencies']) {
  for (const [name, spec] of Object.entries(stagePkg[section] ?? {})) {
    if (typeof spec === 'string' && /^(workspace|catalog):/.test(spec)) {
      throw new Error(`[assemble-app] stage package.json ${section}.${name} uses "${spec}" — forbidden in a packaged app`);
    }
  }
}
writeFileSync(join(STAGE, 'package.json'), `${JSON.stringify(stagePkg, null, 2)}\n`);

// 5. Vendor @ccv/core into the stage as real files. The staged server code
//    imports '@ccv/core/*'; the stage manifest declares it (inherited from
//    @ccv/electron dependencies above), but the registry can never satisfy
//    "0.0.0" — the desktop bundle must carry the package physically, exactly
//    like the npm tarball does via bundledDependencies. The stage is a
//    throwaway build artifact, so copying here (unlike dev node_modules) is
//    always safe.
const CORE_PKG = join(REPO_ROOT, 'packages', 'core');
const CORE_STAGE = join(STAGE, 'node_modules', '@ccv', 'core');
if (!existsSync(join(CORE_PKG, 'package.json'))) {
  throw new Error('[assemble-app] packages/core missing — @ccv/core payload incomplete');
}
mkdirSync(dirname(CORE_STAGE), { recursive: true });
cpSync(CORE_PKG, CORE_STAGE, { recursive: true, filter: (src) => !src.includes(`${sep}test`) });

console.log(`[assemble-app] staged ${STAGE} (cc-viewer v${appPkg.version})`);
