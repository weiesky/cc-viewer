// Centralized physical path constants relative to repo root / server root / node_modules,
// to avoid error-prone cross-depth join('..','..',...) chains. New code should import from here;
// legacy code migrates gradually. Named `_paths.js`: underscore prefix = server startup
// constants, visually separated from business modules (lib/*.js) in directory listings.
//
// ⚠️ Position-sensitive: this file's own path is the anchor for every constant
// (HERE = dirname(this file)). `git mv server/_paths.js <elsewhere>` will silently shift
// PACKAGE_ROOT / NODE_MODULES / DIST_DIR / etc. — no static error, so every import site
// must be manually verified after moving this file.
//
// NODE_MODULES assumption: cc-viewer physically lives at `<node_modules>/cc-viewer/`
// (production npm install). Under `npm link` / git clone dev setups this resolves to the
// wrong location; upstream consumers (findcc.js) use `getGlobalNodeModulesDir()` as a
// fallback, but this constant itself is not aware of those edge cases.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of server/ directory */
export const SERVER_DIR    = HERE;
/** cc-viewer package root (at npm install time = `<node_modules>/cc-viewer`) */
export const PACKAGE_ROOT  = resolve(HERE, '..');
/** cc-viewer's sibling node_modules/ (npm install assumption; broken under npm link) */
export const NODE_MODULES  = resolve(HERE, '..', '..');
/** server/lib/ subdirectory */
export const SERVER_LIB    = join(HERE, 'lib');
/** Vite build output (dist/index.html + assets/*) */
export const DIST_DIR      = join(PACKAGE_ROOT, 'dist');
/** Dev resources (public/voice-packs/* etc., copied to dist/ by vite).
 *  Monorepo: public/ lives in apps/web (vite build input); the published tarball
 *  ships no public/ at all (its contents reach dist/ via the web build). */
export const PUBLIC_DIR    = existsSync(join(PACKAGE_ROOT, 'public'))
  ? join(PACKAGE_ROOT, 'public')
  : resolve(PACKAGE_ROOT, '..', '..', 'apps', 'web', 'public');
/** Bundled plugin directory (scanned by plugin-loader at startup) */
export const PLUGINS_DIR   = join(PACKAGE_ROOT, 'plugins');

// Bundled content assets live in the @ccv/content workspace package (packages/content)
// and are copied back into packages/app at pack time (scripts/assemble-dist.mjs).
// Probe the content package FIRST so dev edits are live even when a stale assembled
// copy exists in packages/app; the installed tarball has no ../content sibling and
// falls back to the assembled in-package copy. Each probe checks a structural sentinel
// to avoid false hits on an unrelated sibling directory.
const CONTENT_PKG = resolve(PACKAGE_ROOT, '..', 'content');
/** Multi-language concept docs (GlobalSettings.md / Tool-*.md etc.) */
export const CONCEPTS_DIR  = existsSync(join(CONTENT_PKG, 'concepts', 'en'))
  ? join(CONTENT_PKG, 'concepts')
  : join(PACKAGE_ROOT, 'concepts');
/** Bundled ultraplan preset expert directory (ultraAgents/*.json, served by /api/ultra-agents) */
export const ULTRA_AGENTS_DIR = existsSync(join(CONTENT_PKG, 'ultraAgents', 'code-expert.json'))
  ? join(CONTENT_PKG, 'ultraAgents')
  : join(PACKAGE_ROOT, 'ultraAgents');
/** Bundled IM default skill source (server/imSkills/<lang>/<skill>/SKILL.md + scripts/*.mjs) */
export const IM_SKILLS_DIR = existsSync(join(CONTENT_PKG, 'server', 'imSkills', 'scripts'))
  ? join(CONTENT_PKG, 'server', 'imSkills')
  : join(SERVER_DIR, 'imSkills');
/** Bundled IM persona preset templates (server/imPreset/<lang>.md, {platform}/{id} substituted at runtime) */
export const IM_PRESET_DIR = existsSync(join(CONTENT_PKG, 'server', 'imPreset', 'en.md'))
  ? join(CONTENT_PKG, 'server', 'imPreset')
  : join(SERVER_DIR, 'imPreset');
/** cc-viewer's own package.json (updater/server.js reads version) */
export const PACKAGE_JSON  = join(PACKAGE_ROOT, 'package.json');
