// Shared resolution of a "target" (CLAUDE.md / skill folder) into the
// navigation root the file browser walks, plus the path validation both the
// read route (/api/target-files in routes/files-content.js) and the write
// routes (/api/target-* in routes/target-files-fs.js) rely on.
//
// These helpers were moved verbatim out of routes/files-content.js so the new
// target write routes resolve the EXACT same root as the read route — never
// trust a client-supplied absolute root, always re-derive it from the target
// identity (kind + id, or source + targetPath) via resolveTargetRoot.
//
// Layering: this is L1 (lib). It must NOT import from routes/ — routes import
// lib, never the reverse (enforced by pnpm run verify:boundaries).
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { isReadAllowed, reasonToStatus } from './file-access-policy.js';
import { listSkills } from './skills-api.js';
import { discoverClaudeMdCandidates } from './claude-md-discovery.js';
import { getClaudeConfigDir } from '../../findcc.js';

export function targetError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Map fs errno to a sensible HTTP status: missing → 404, permission → 403,
// symlink loop → 400 (treat as malformed), anything else → 404 (don't leak).
export function errnoToStatus(err) {
  const code = err?.code;
  if (code === 'EACCES' || code === 'EPERM') return 403;
  if (code === 'ELOOP') return 400;
  return 404;
}

export function realDirectory(path, label) {
  let real;
  try { real = realpathSync(path); } catch (err) { throw targetError(errnoToStatus(err), `${label} not found`); }
  let st;
  try { st = statSync(real); } catch (err) { throw targetError(errnoToStatus(err), `${label} not found`); }
  if (!st.isDirectory()) throw targetError(400, `${label} is not a directory`);
  return real;
}

export function checkedDirectory(path, label) {
  const real = realDirectory(path, label);
  const policy = isReadAllowed(real);
  if (!policy.ok) throw targetError(reasonToStatus(policy.reason), `${label} not readable`);
  return policy.real;
}

export function insidePath(path, root) {
  return path === root || path.startsWith(root + sep);
}

export function targetNavigation(targetReal, cwd) {
  const projectReal = realDirectory(cwd, 'Project');
  if (insidePath(targetReal, projectReal)) return { rootReal: projectReal, rootKind: 'project' };
  // $HOME becomes the navigation root for home-resident targets (user skills,
  // plugins, the global CLAUDE.md). Entries outside the allowlist (e.g. ~/.ssh,
  // ~/.aws) are filtered per-entry by isReadAllowed, and sensitive paths inside
  // ~/.claude are covered by file-access-policy's denylist. The /api/target-files
  // handler additionally gates this endpoint behind isAdminReq + same-origin so
  // a cross-site page cannot enumerate the user's home tree.
  const homeReal = realDirectory(homedir(), 'Home');
  if (insidePath(targetReal, homeReal)) {
    checkedDirectory(targetReal, 'Directory');
    return { rootReal: homeReal, rootKind: 'home' };
  }
  const configReal = realDirectory(getClaudeConfigDir(), 'Claude config');
  if (insidePath(targetReal, configReal)) {
    checkedDirectory(targetReal, 'Directory');
    return { rootReal: realDirectory(dirname(configReal), 'Config root'), rootKind: 'config' };
  }
  // Allowlist fallback: targets that live inside another allowlisted root
  // (registered workspaces, /tmp/cc-viewer-uploads, etc.) are reachable via
  // /api/claude-md's discovery (which uses isReadAllowed), so we must not
  // 403 them here. Use the target's own directory as the navigation root —
  // no parent browsing, but at least the entry the user clicked actually opens.
  const policy = isReadAllowed(targetReal);
  if (!policy.ok) throw targetError(reasonToStatus(policy.reason), 'Target not readable');
  return { rootReal: realDirectory(targetReal, 'Target'), rootKind: 'target' };
}

export function targetScope(targetReal, cwd) {
  const navigation = targetNavigation(targetReal, cwd);
  return { ...navigation, targetPath: relative(navigation.rootReal, targetReal).split(sep).join('/') };
}

export function targetRelPath(raw) {
  if (raw == null) return null;
  if (raw === '') return [];
  if (typeof raw !== 'string' || raw.length > 2048 || raw.includes('\0') || raw.includes('\\')
    || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    throw targetError(400, 'Invalid path');
  }
  const segments = raw.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw targetError(400, 'Invalid path');
  }
  // Hard cap on navigation depth: each segment triggers at least one
  // synchronous readdir + per-entry realpath/stat in `ancestors`, and a 2KB
  // free-form path could otherwise fan out into hundreds of syscalls per
  // request. 32 is far deeper than any realistic skill / CLAUDE.md location.
  if (segments.length > 32) throw targetError(400, 'Path too deep');
  return segments;
}

export function resolveTargetRoot(parsedUrl, cwd) {
  const kind = parsedUrl.searchParams.get('kind');
  if (kind === 'claude-md') {
    const id = parsedUrl.searchParams.get('id') || '';
    if (!/^[0-9a-f]{12}$/i.test(id)) throw targetError(400, 'Invalid id');
    const candidate = discoverClaudeMdCandidates({
      cwd,
      claudeConfigDir: getClaudeConfigDir(),
      isReadAllowedFn: isReadAllowed,
    }).find(entry => entry.id === id);
    if (!candidate || basename(candidate.realPath) !== 'CLAUDE.md') throw targetError(404, 'Target not found');
    return { ...targetScope(realDirectory(dirname(candidate.realPath), 'Directory'), cwd), targetKind: 'claude-md' };
  }
  if (kind !== 'skill') throw targetError(400, 'Invalid target kind');
  const source = parsedUrl.searchParams.get('source');
  const targetPath = parsedUrl.searchParams.get('targetPath');
  if (!['user', 'project', 'plugin'].includes(source)) throw targetError(400, 'Invalid skill source');
  if (typeof targetPath !== 'string' || !targetPath || targetPath.length > 4096 || targetPath.includes('\0')) {
    throw targetError(400, 'Invalid skill path');
  }
  const skill = listSkills({ projectDir: cwd })
    .find(entry => entry.source === source && entry.path === targetPath);
  if (!skill) throw targetError(404, 'Target not found');
  const rootReal = realDirectory(skill.path, 'Directory');
  const scope = targetScope(rootReal, cwd);
  const anchor = source === 'project'
    ? scope.rootReal
    : dirname(dirname(skill.path));
  const anchorReal = realDirectory(anchor, 'Skill root');
  if (!insidePath(rootReal, anchorReal)) throw targetError(403, 'Target outside skill root');
  // Plugin root must follow the configured Claude config dir, not the default
  // homedir()/.claude — otherwise plugin skills break under CLAUDE_CONFIG_DIR.
  if (source === 'plugin' && !insidePath(rootReal, realDirectory(join(getClaudeConfigDir(), 'plugins'), 'Plugin root'))) {
    throw targetError(403, 'Target outside plugin root');
  }
  return { ...scope, targetKind: 'skill' };
}

// ===========================================================================
// Write-side scope resolution (used only by the /api/target-* write routes).
// ===========================================================================

// SECURITY / INTENTIONAL DESIGN (do NOT tighten in review without product sign-off):
// the writable area for a target browser is the WHOLE navigation root returned by
// targetNavigation (project / home / config / target), NOT just the target's own
// subtree. This is a deliberate product decision — the user navigates the browser
// up to ancestors (e.g. from a skill folder to ~ or ~/.claude) and expects the
// context menu to keep working there. The sensitive-file / sensitive-directory
// backstop for that wider surface is isWriteAllowed (lib/file-access-policy.js),
// which every mutation runs through; containment in the navigation root plus
// isWriteAllowed is the boundary, not the target subtree.
export function resolveTargetWriteScope(parsedUrl, cwd) {
  // Re-derive the target identity server-side (never trust a client-sent root).
  // The writable surface is the WHOLE navigation root (scope.rootReal) — the
  // target's own directory is NOT separately resolved here because the product
  // decision is to allow writes anywhere in the navigation root, with the
  // sensitive-file backstop living in isWriteAllowed (see file-access-policy.js).
  return resolveTargetRoot(parsedUrl, cwd);
}

// targetRelPath treats null as "caller omitted path" (the read route uses that
// to default to the target's own directory). The write routes always need an
// explicit path, so this is the required variant: omitted → 400.
export function requiredTargetRelPath(raw) {
  const segs = targetRelPath(raw);
  if (segs === null) throw targetError(400, 'Missing path');
  return segs;
}
