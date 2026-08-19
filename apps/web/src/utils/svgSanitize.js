// SVG sanitize: allow SMIL animation tags through DOMPurify's strict svg profile so previewed
// *.svg files animate, but reject <set>/<animate*> retargeting onto on*/href/style — defending
// against post-sanitize attribute injection via the SMIL animation engine.
//
// Uses a PRIVATE DOMPurify instance so the SMIL guard hook stays scoped to SVG sanitize calls
// (no leakage into the markdown / Mermaid sanitize pipelines that share the default singleton).

import DOMPurify from 'dompurify';

export const SMIL_TAGS = new Set(['set', 'animate', 'animatemotion', 'animatetransform']);
export const FORBIDDEN_ANIM_TARGET = /^(on|href$|xlink:href$|style$)/i;

export function isHostileAnimAttr(tagName, attrName, attrValue) {
  // DOMPurify lowercases attrName before passing to hooks; the explicit toLowerCase is cheap
  // insurance against version drift / direct callers (unit tests).
  if (String(attrName || '').toLowerCase() !== 'attributename') return false;
  if (!SMIL_TAGS.has((tagName || '').toLowerCase())) return false;
  return FORBIDDEN_ANIM_TARGET.test(String(attrValue || '').trim());
}

export const SVG_SANITIZE_CONFIG = Object.freeze({
  USE_PROFILES: { svg: true },
  ADD_TAGS: ['animate', 'animateMotion', 'animateTransform', 'set', 'mpath'],
  ADD_ATTR: [
    'attributeName', 'attributeType', 'calcMode', 'values', 'keyTimes', 'keySplines',
    'dur', 'repeatCount', 'repeatDur', 'begin', 'end', 'from', 'to', 'by',
    'restart', 'min', 'max', 'additive', 'accumulate', 'path', 'rotate',
    'fill', 'href', 'xlink:href', 'type', 'origin',
  ],
});

// DOMPurify default export is both an instance and a factory: calling it with a window returns a
// fresh instance whose hook chain is independent. In SSR / node:test (no window) the default
// instance is a stub without addHook/sanitize — guard so this module is import-safe everywhere.
const svgPurify = typeof window !== 'undefined' ? DOMPurify(window) : DOMPurify;

if (typeof svgPurify.addHook === 'function') {
  svgPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (isHostileAnimAttr(node && node.nodeName, data && data.attrName, data && data.attrValue)) {
      data.keepAttr = false;
    }
  });
}

export function sanitizeSvg(text) {
  if (typeof svgPurify.sanitize !== 'function') return text;
  return svgPurify.sanitize(text, SVG_SANITIZE_CONFIG);
}
