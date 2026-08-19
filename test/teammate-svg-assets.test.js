/**
 * Structural validation for the animated teammate avatar SVGs in src/img/teammates/.
 *
 * These files are ?raw-imported and injected inline via dangerouslySetInnerHTML at
 * multiple sites simultaneously, so they must obey the DESIGN.md v2 authoring rules:
 * duplicate-instance safety (no document-global features like id/<style>), theme
 * safety (no currentColor — a site CSS rule sets `svg { fill: currentColor }`),
 * one-shot SMIL that degrades to the finished portrait, and a size budget (the raw
 * text ships inside the JS bundle). No XML parser exists in the dependency tree,
 * so the checks are structural (regex/count based), per DESIGN.md.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIR = new URL('../apps/web/src/img/teammates/', import.meta.url);

const ROLES = [
  'worker', 'reviewer', 'researcher', 'explorer', 'analyst', 'tracer',
  'investigator', 'builder', 'implementer', 'auditor', 'translator', 'security',
  'scanner', 'expert', 'executor', 'designer', 'default',
];

const MAX_BYTES = 10240;
// Matches DESIGN.md's "total timeline <= 1.2s" ceiling (current real max: 1.08s).
const MAX_DUR_SECONDS = 1.2;

// Substrings banned by DESIGN.md rule A2 (document-global or theme-unsafe features).
const BANNED = [
  ' id=', ' class=', '<defs', '<use', '<style', '<script', '<text', '<image',
  'url(', 'currentColor', 'repeatCount',
];

// The marvel/ subdirectory holds an alternate avatar set that follows the same
// authoring rules. It is intentionally NOT imported by teammateAvatars.js, so it
// never enters the dist bundle or the npm artifact — validated here for quality only.
const SETS = [
  { label: 'teammates', dir: DIR },
  { label: 'teammates/marvel', dir: new URL('marvel/', DIR) },
];

describe('avatar set completeness', () => {
  for (const { label, dir } of SETS) {
    it(`${label}/ contains exactly the 17 role SVGs (no strays, none missing)`, () => {
      const onDisk = readdirSync(fileURLToPath(dir))
        .filter((f) => f.endsWith('.svg'))
        .map((f) => f.replace(/\.svg$/, ''))
        .sort();
      assert.deepEqual(onDisk, [...ROLES].sort());
    });
  }
});

describe('marvel set stays unwired (likeness/IP safety)', () => {
  // The marvel/ alternates must never be imported: an import would inline them
  // into the dist bundle and ship them in the npm artifact. Walk all source
  // files (same boundary-guard idea as client-safe-imports.test.js).
  it('no file under src/ or server/ references teammates/marvel', () => {
    const roots = ['apps/web/src', 'packages/app/server'].map((d) =>
      fileURLToPath(new URL(`../${d}/`, import.meta.url)));
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === 'node_modules' || name === 'marvel') continue;
          walk(p);
        } else if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(name)) {
          if (readFileSync(p, 'utf8').includes('teammates/marvel')) offenders.push(p);
        }
      }
    };
    for (const root of roots) walk(root);
    assert.deepEqual(offenders, []);
  });
});

for (const { label, dir } of SETS) for (const role of ROLES) {
  describe(`${label}/${role}.svg`, () => {
    const url = new URL(`${role}.svg`, dir);
    const src = readFileSync(fileURLToPath(url), 'utf8');

    it('fits the size budget', () => {
      assert.ok(Buffer.byteLength(src) <= MAX_BYTES,
        `${Buffer.byteLength(src)} bytes exceeds ${MAX_BYTES}`);
    });

    it('has the required root attributes', () => {
      assert.match(src, /^<svg\b/);
      assert.ok(src.includes('viewBox="0 0 100 100"'), 'viewBox must be 0 0 100 100');
      assert.ok(src.includes('aria-hidden="true"'), 'root must be aria-hidden');
      assert.ok(src.includes('xmlns="http://www.w3.org/2000/svg"'), 'xmlns required');
    });

    it('contains only <svg>, <path> and <animate> elements', () => {
      const tags = [...src.matchAll(/<([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
      const allowed = new Set(['svg', 'path', 'animate']);
      for (const tag of tags) {
        assert.ok(allowed.has(tag), `unexpected element <${tag}>`);
      }
    });

    it('contains no banned features (rule A2)', () => {
      for (const bad of BANNED) {
        assert.ok(!src.includes(bad), `banned substring found: ${JSON.stringify(bad)}`);
      }
      // "http" may appear exactly once: inside the xmlns declaration checked above.
      assert.equal(src.split('http').length - 1, 1, 'no external references allowed');
      // Defense-in-depth beyond the element allowlist: no event handlers,
      // inline styles, or link attributes even in attribute position.
      assert.ok(!/\son[a-z]+=/i.test(src), 'event-handler attributes banned');
      assert.ok(!/\sstyle=/.test(src), 'style attributes banned');
      assert.ok(!/xlink:href|\shref=/.test(src), 'href attributes banned');
    });

    it('is animated, one-shot, and freeze-terminated', () => {
      const animates = [...src.matchAll(/<animate\b[^>]*>/g)].map((m) => m[0]);
      assert.ok(animates.length > 0, 'must contain at least one <animate>');
      for (const a of animates) {
        assert.ok(a.endsWith('/>'), 'animate elements must be self-closing');
        assert.ok(a.includes('begin="0s"'), 'absolute begin="0s" required (no syncbase)');
        assert.ok(a.includes('fill="freeze"'), 'fill="freeze" required');
        const dur = a.match(/dur="([\d.]+)s"/);
        assert.ok(dur, 'dur required');
        assert.ok(Number(dur[1]) <= MAX_DUR_SECONDS, `dur ${dur[1]}s exceeds budget`);
      }
    });

    it('uses the shared ink hex and only the two sanctioned stroke widths (rules A4/A5)', () => {
      assert.ok(src.includes('#2b2233'), 'shared ink hex #2b2233 required');
      const widths = new Set([...src.matchAll(/stroke-width="([^"]+)"/g)].map((m) => m[1]));
      for (const w of widths) {
        assert.ok(w === '3.5' || w === '2.5', `stroke-width ${w} outside the sanctioned {3.5, 2.5}`);
      }
    });

    it('has balanced <path> tags and explicit paint on every path (rule A3)', () => {
      const opens = [...src.matchAll(/<path\b[^>]*[^/]>/g)].map((m) => m[0]);
      const selfClosed = [...src.matchAll(/<path\b[^>]*\/>/g)];
      const closes = src.split('</path>').length - 1;
      assert.equal(opens.length, closes, 'unbalanced <path> tags');
      for (const p of [...opens, ...selfClosed.map((m) => m[0])]) {
        assert.ok(p.includes('fill="'), `path missing explicit fill: ${p.slice(0, 80)}`);
        if (/stroke="(?!none)/.test(p)) {
          assert.ok(p.includes('stroke-width="'), 'stroked path missing stroke-width');
        }
      }
    });

    it('keeps the static markup as the finished portrait (degradation rule)', () => {
      // Hidden states must live inside <animate> only — never as static attributes.
      assert.ok(!/<path[^>]*stroke-dashoffset=/.test(src),
        'static stroke-dashoffset would blank the portrait in non-SMIL renderers');
      assert.ok(!/<path[^>]*\sopacity="0(\.0+)?"/.test(src),
        'static zero opacity would blank the portrait in non-SMIL renderers');
    });
  });
}
