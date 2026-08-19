#!/usr/bin/env node
// Assemble the published package payload: copy the web build output
// (apps/web/dist) into packages/app/dist.
//
// Invoked by `prepack` (npm/pnpm pack) and by the root `build` script.
// The published tarball's layout is a public contract (see the monorepo
// migration plan): dist/ must sit at the package root, so a silent missing
// or stale web build would ship a broken viewer — fail loudly instead.
import { cpSync, existsSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const WEB_DIST = join(REPO_ROOT, 'apps', 'web', 'dist');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const WEB_PUBLIC = join(REPO_ROOT, 'apps', 'web', 'public');
const APP_DIST = join(APP_ROOT, 'dist');

function newestMtimeMs(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) newest = Math.max(newest, newestMtimeMs(p));
    else newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
}

if (!existsSync(join(WEB_DIST, 'index.html'))) {
  throw new Error(`[assemble-dist] ${WEB_DIST} is missing index.html — run \`pnpm --filter @ccv/web build\` first`);
}
// Staleness covers both vite inputs: src/ (bundled) and public/ (copied verbatim —
// voice-packs, favicon). A public/-only change must not ship a stale dist either.
const newestInput = Math.max(newestMtimeMs(WEB_SRC), newestMtimeMs(WEB_PUBLIC));
if (statSync(join(WEB_DIST, 'index.html')).mtimeMs < newestInput) {
  throw new Error(`[assemble-dist] ${WEB_DIST} is older than web sources — rebuild with \`pnpm --filter @ccv/web build\``);
}

// Guard: the published manifest must never carry pnpm-only protocol specifiers
// (npm cannot resolve them; shipping one breaks every consumer install).
const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
for (const section of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']) {
  for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
    if (typeof spec === 'string' && /^(workspace|catalog):/.test(spec)) {
      throw new Error(`[assemble-dist] package.json ${section}.${name} uses "${spec}" — forbidden in the published package`);
    }
  }
}

rmSync(APP_DIST, { recursive: true, force: true });
cpSync(WEB_DIST, APP_DIST, { recursive: true });

// Bundled content assets live in packages/content (@ccv/content) in the monorepo; the
// published tarball must carry them at their contract paths inside packages/app.
// (server/_paths.js probes packages/content first in dev, so these copies only matter
// for packing — keep them idempotent and fail loudly when the source is missing.)
const CONTENT_PKG = join(REPO_ROOT, 'packages', 'content');
for (const rel of ['concepts', 'ultraAgents', join('server', 'imPreset'), join('server', 'imSkills')]) {
  const from = join(CONTENT_PKG, rel);
  if (!existsSync(from)) throw new Error(`[assemble-dist] ${from} missing — content payload incomplete`);
  const dest = join(APP_ROOT, rel);
  rmSync(dest, { recursive: true, force: true });
  cpSync(from, dest, { recursive: true });
}

// npm auto-includes README*/LICENSE* from the package dir only — in the monorepo
// they live at the repo root, so copy them in to preserve the published contract.
for (const doc of ['README.md', 'LICENSE.md']) {
  const from = join(REPO_ROOT, doc);
  if (!existsSync(from)) throw new Error(`[assemble-dist] ${from} missing — the published tarball must carry ${doc}`);
  cpSync(from, join(APP_ROOT, doc));
}

console.log(`[assemble-dist] copied ${WEB_DIST} → ${APP_DIST}`);
