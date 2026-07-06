/**
 * File and command validation utilities.
 */

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp']);

export function isImageFile(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  return IMAGE_EXTS.has(ext);
}

const MUTATING_CMD_RE = /\b(rm|mkdir|mv|cp|touch|chmod|chown|ln|git\s+(checkout|reset|stash|merge|rebase|cherry-pick|restore|clean|rm)|npm\s+(install|uninstall|ci)|yarn\s+(add|remove)|pnpm\s+(add|remove|install)|pip\s+install|tar|unzip|curl\s+-[^\s]*o|wget)\b|[^>]>(?!>)|>>/;

export function isMutatingCommand(cmd) {
  return MUTATING_CMD_RE.test(cmd);
}
