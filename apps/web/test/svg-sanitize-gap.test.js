/**
 * Gap top-up for src/utils/svgSanitize.js
 *
 * test/svg-sanitize.test.js covers the pure guard (isHostileAnimAttr / regex / config)
 * but cannot reach the DOMPurify-bound lines because, in plain node:test, the default
 * DOMPurify export is an unsupported stub (addHook / sanitize are undefined). So:
 *   - L37-43: the addHook('uponSanitizeAttribute', …) registration + its callback
 *   - L45-48: sanitizeSvg delegating to svgPurify.sanitize
 * stay uncovered.
 *
 * We make them reachable WITHOUT jsdom by registering an in-process ESM loader (a
 * data: URL — no extra files) that replaces the `dompurify` specifier with a tiny
 * controllable factory: calling it with a window returns an instance whose addHook
 * records hooks and whose sanitize replays a single attribute pass through them, so
 * the real module's hook body actually executes and we can observe `keepAttr` flip.
 *
 * The loader only intercepts the `dompurify` specifier and only matters for THIS
 * isolated test run; everything else resolves normally.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// ── In-process loader: stub `dompurify` with a hookable fake instance ────────────
const loaderSrc = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'dompurify') {
    const src = \`
      function makeInstance() {
        const hooks = [];
        const inst = function() { return makeInstance(); };
        inst.isSupported = true;
        inst.addHook = (name, fn) => { hooks.push([name, fn]); };
        // sanitize replays the hook once per attribute scenario passed via a marker
        // embedded in the text: "ATTR:<tag>|<attrName>|<attrValue>". keepAttr decisions
        // are surfaced back in the returned string so the test can assert them.
        inst.sanitize = (text, cfg) => {
          let kept = 'n/a';
          const m = /ATTR:([^|]*)\\\\|([^|]*)\\\\|([^>]*)/.exec(text);
          if (m) {
            const data = { attrName: m[2], attrValue: m[3], keepAttr: true };
            for (const [n, fn] of hooks) {
              if (n === 'uponSanitizeAttribute') fn({ nodeName: m[1] }, data);
            }
            kept = String(data.keepAttr);
          }
          return '<clean keepAttr=' + kept + '>' + text + '</clean>';
        };
        return inst;
      }
      const DOMPurify = makeInstance();
      export default DOMPurify;
    \`;
    return { url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

let mod;
before(async () => {
  register('data:text/javascript,' + encodeURIComponent(loaderSrc), import.meta.url);
  // A window must exist so the module takes the `DOMPurify(window)` branch (real instance
  // with addHook), not the SSR stub branch.
  globalThis.window = {};
  mod = await import('../src/utils/svgSanitize.js');
});

after(() => {
  delete globalThis.window;
});

describe('sanitizeSvg (real module, hookable DOMPurify stub)', () => {
  it('delegates to svgPurify.sanitize and returns its output', () => {
    const out = mod.sanitizeSvg('<svg>hello</svg>');
    assert.match(out, /^<clean keepAttr=n\/a><svg>hello<\/svg><\/clean>$/);
  });

  it('the registered uponSanitizeAttribute hook DROPS a hostile SMIL retarget (keepAttr=false)', () => {
    // marker drives the stub to invoke the hook with set/attributeName/onclick
    const out = mod.sanitizeSvg('ATTR:set|attributeName|onclick>');
    assert.match(out, /keepAttr=false/);
  });

  it('the hook KEEPS a safe SMIL retarget (keepAttr stays true)', () => {
    const out = mod.sanitizeSvg('ATTR:animate|attributeName|opacity>');
    assert.match(out, /keepAttr=true/);
  });

  it('the hook ignores a non-SMIL parent tag (keepAttr stays true)', () => {
    const out = mod.sanitizeSvg('ATTR:path|attributeName|onclick>');
    assert.match(out, /keepAttr=true/);
  });

  it('the hook ignores a non-attributeName attr (keepAttr stays true)', () => {
    const out = mod.sanitizeSvg('ATTR:set|to|onclick>');
    assert.match(out, /keepAttr=true/);
  });

  it('passes SVG_SANITIZE_CONFIG through (svg profile preserved on the real export)', () => {
    assert.equal(mod.SVG_SANITIZE_CONFIG.USE_PROFILES.svg, true);
  });
});
