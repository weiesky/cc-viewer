// Client mirror of the server's replace primitives (server/lib/code-replace.js +
// buildQueryRegExp/looksCatastrophic in code-search.js). Kept byte-for-byte equivalent so the
// inline replace preview equals exactly what the server writes, and so single-match targeting
// uses the SAME (node/JS) match positions the server will — never a ripgrep-derived submatch
// offset that could disagree. Parity is pinned by test/search-replace-preview.test.js.

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildQueryRegExp({ query, regex, wholeWord, caseSensitive }) {
  let pattern = regex ? query : escapeRegExp(query);
  if (wholeWord) pattern = `\\b(?:${pattern})\\b`;
  const flags = 'g' + (caseSensitive ? '' : 'i');
  return new RegExp(pattern, flags);
}

export function looksCatastrophic(pattern) {
  return /\([^()]*[+*}][^()]*\)\s*[+*]/.test(pattern)
    || /\([^()]*[+*][^()]*\)\{\d/.test(pattern);
}

/** Non-global clone (for native $-expansion of a single match). */
export function noGlobal(reG) {
  return new RegExp(reG.source, reG.flags.replace('g', ''));
}

/** regex → native JS $-substitution; literal → verbatim (no $ interpretation). */
export function applyMatch(matchedText, reNoG, regex, replacement) {
  if (!regex) return replacement;
  return matchedText.replace(reNoG, replacement);
}

/**
 * For a clicked match, recover the node-engine match position on the line so the server can
 * re-verify it. Finds the JS-regex match covering `submatchStart`; returns its index + text.
 * @returns {{col:number, expectText:string}|null}
 */
export function computeMatchTarget(lineText, submatchStart, reG) {
  reG.lastIndex = 0;
  let m;
  let fallback = null;
  while ((m = reG.exec(lineText)) !== null) {
    if (m[0] === '') { reG.lastIndex++; continue; }
    if (m.index === submatchStart) { reG.lastIndex = 0; return { col: m.index, expectText: m[0] }; }
    if (m.index <= submatchStart && submatchStart < m.index + m[0].length) fallback = { col: m.index, expectText: m[0] };
    if (m.index > submatchStart) break;
  }
  reG.lastIndex = 0;
  return fallback;
}
