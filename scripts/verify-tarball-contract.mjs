#!/usr/bin/env node
// L4 tarball-contract gate: the published tarball's physical layout is the public API
// (bin entry, exports map, claude-cli injection markers, managed hook paths — see
// docs/refactor/pnpm-monorepo-migration-plan.zh.md §0.1). This script dry-run packs
// packages/app and diffs the file list against the committed baseline.
//
// dist/assets/* is excluded from the diff: vite content-hashes those filenames on every
// web change. dist/ is instead asserted structurally (index.html + voice-packs present).
//
// Usage:
//   node scripts/verify-tarball-contract.mjs          # diff vs baseline, exit 1 on delta
//   node scripts/verify-tarball-contract.mjs --write  # regenerate the baseline
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(REPO_ROOT, 'packages', 'app');
const BASELINE = join(REPO_ROOT, 'scripts', 'tarball-baseline.json');
const writeMode = process.argv.includes('--write');

function fail(msg) {
  console.error(`[verify-tarball] ${msg}`);
  process.exit(1);
}

// Assemble first (idempotent; fails loudly on stale/missing web dist), then pack with
// --ignore-scripts: prepack's own stdout would otherwise corrupt npm's --json output.
execFileSync('pnpm', ['--filter', 'cc-viewer', 'run', 'assemble'], { cwd: REPO_ROOT, stdio: 'inherit' });
// npm pack --dry-run --json prints [{ name, version, files: [{path}...] }] on stdout.
const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: APP_DIR,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const files = JSON.parse(out)[0].files.map((f) => f.path).sort();

// Structural assertions for the hash-named parts of dist/.
if (!files.includes('dist/index.html')) fail('dist/index.html missing from tarball');
for (const dir of ['dist/voice-packs/default/', 'dist/voice-packs/sanguo/']) {
  if (!files.some((f) => f.startsWith(dir))) fail(`tarball carries no files under ${dir}`);
}
// dist/assets/* is excluded from the file-list diff (hashed names), so assert the bundle
// is actually loadable: every asset referenced by dist/index.html must be in the pack list.
{
  const indexHtml = readFileSync(join(APP_DIR, 'dist', 'index.html'), 'utf8');
  const refs = [...indexHtml.matchAll(/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)].map((m) => `dist/${m[0]}`);
  if (refs.length === 0) fail('dist/index.html references no assets/* bundle — broken web build');
  const packSet = new Set(files);
  const missing = refs.filter((r) => !packSet.has(r));
  if (missing.length) fail(`dist/index.html references assets missing from the tarball: ${missing.join(', ')}`);
}

const stable = files.filter((f) => !f.startsWith('dist/assets/'));

if (writeMode) {
  writeFileSync(BASELINE, JSON.stringify(stable, null, 2) + '\n');
  console.log(`[verify-tarball] baseline written: ${stable.length} entries → ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  fail(`baseline missing at ${BASELINE} — regenerate with \`node scripts/verify-tarball-contract.mjs --write\``);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const currentSet = new Set(stable);
const baselineSet = new Set(baseline);
const added = stable.filter((f) => !baselineSet.has(f));
const removed = baseline.filter((f) => !currentSet.has(f));

if (added.length || removed.length) {
  console.error('[verify-tarball] tarball file list differs from baseline:');
  for (const f of added) console.error(`  + ${f}`);
  for (const f of removed) console.error(`  - ${f}`);
  console.error('[verify-tarball] if this delta is intentional, review it line by line, then regenerate:');
  console.error('  node scripts/verify-tarball-contract.mjs --write');
  process.exit(1);
}
console.log(`[verify-tarball] OK — ${stable.length} files match baseline (dist/assets excluded: hashed names)`);
