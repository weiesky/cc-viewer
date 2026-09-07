#!/usr/bin/env node
// Cheap pre-push tarball-drift guard (L4 companion to verify-tarball-contract.mjs).
//
// verify:tarball does a real `npm pack` and diffs the FULL file list — authoritative but slow
// (assemble + pack). That cost means it is NOT wired into the local pretest hooks, so a commit
// that adds/removes a published source file (e.g. a new server/lib/*.js) used to slip through
// locally and only fail in CI/release (v1.8.10). This guard closes that gap: it diffs the SET of
// source files that assemble-dist copies into packages/app (server/, concepts/, ultraAgents/,
// plugins/, node_modules/@ccv/core/) against the committed tarball-baseline.json. No pack, no
// assemble — milliseconds. If this passes but the real verify:tarball would still fail (a dist/
// structural change, an exports/bin change), CI's verify:tarball is still the authoritative gate;
// this only catches the dominant add/remove-file case early, before push.
//
// Exits 1 with a remediation hint when the source set and baseline disagree.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(REPO_ROOT, 'packages', 'app');
const BASELINE = join(REPO_ROOT, 'scripts', 'tarball-baseline.json');

// Source dirs assemble-dist.mjs / npm-pack copies verbatim into the publishable layout.
// Each entry: [tarball path prefix, on-disk source dir, optional subdir-within-source to scope to].
// @ccv/core ships only `src/` (its package.json `files:["src/"]`); its test/ is NOT published.
const SOURCES = [
  ['server/', join(APP_DIR, 'server'), ''],
  ['concepts/', join(REPO_ROOT, 'packages', 'content', 'concepts'), ''],
  ['ultraAgents/', join(REPO_ROOT, 'packages', 'content', 'ultraAgents'), ''],
  ['plugins/', join(APP_DIR, 'plugins'), ''],
  ['node_modules/@ccv/core/src/', join(REPO_ROOT, 'packages', 'core', 'src'), ''],
];

/** Recursively list files under dir, returned as POSIX-style paths relative to dir. */
function* walk(dir, base = dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(abs, base);
    } else if (ent.isFile()) {
      yield relative(base, abs).replaceAll('\\', '/');
    }
  }
}

if (!existsSync(BASELINE)) {
  // No baseline → nothing to guard against (verify:tarball will create/validate it in CI).
  console.log('[verify-tarball-drift] no baseline yet; skipping (CI verify:tarball is authoritative)');
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const baselineSet = new Set(baseline.filter((f) => !f.startsWith('dist/')));

// Build the current source file set in tarball-path form (prefix + relative path).
const current = new Set();
for (const [prefix, dir] of SOURCES) {
  if (!existsSync(dir)) continue;
  for (const rel of walk(dir)) current.add(prefix + rel);
}

// Only compare the prefixes this guard covers (root shims / package.json / etc. stay with CI).
const coveredBaseline = [...baselineSet].filter((f) => SOURCES.some(([p]) => f.startsWith(p)));
const added = [...current].filter((f) => !baselineSet.has(f));
const removed = coveredBaseline.filter((f) => !current.has(f));

if (added.length || removed.length) {
  console.error('[verify-tarball-drift] published source files differ from the tarball baseline:');
  for (const f of added) console.error(`  + ${f}`);
  for (const f of removed) console.error(`  - ${f}`);
  console.error('[verify-tarball-drift] a publishable file was added/removed without regenerating the baseline.');
  console.error('  Review the delta, then regenerate:  node scripts/verify-tarball-contract.mjs --write');
  process.exit(1);
}
console.log(`[verify-tarball-drift] OK — ${current.size} published source files match baseline`);
