// Target-mode filesystem mutation + OS-open routes for the file browser modal
// (CLAUDE.md / skill folder targets). These mirror the project-scoped routes in
// files-fs.js, but resolve the writable root from the TARGET identity (kind+id /
// source+targetPath) via lib/target-scope.js instead of the viewed project —
// because a target frequently lives OUTSIDE any project root (~/.claude, $HOME),
// where no ?project= value could resolve it.
//
// Path contract: `path` / `dirPath` / `oldPath` in the request body are relative
// to the target's NAVIGATION ROOT (the same root the read route /api/target-files
// returns entries against — that is what the browser displays in its breadcrumb).
// This differs from files-fs.js, where paths are relative to the project root.
// Do NOT "fix" callers to send project-relative paths.
//
// SECURITY / INTENTIONAL DESIGN (do NOT weaken in review without product sign-off):
//  - The writable surface is the WHOLE navigation root (see
//    lib/target-scope.js resolveTargetWriteScope), a deliberate product decision
//    so the context menu keeps working after the user navigates to ancestors.
//  - Sensitive files/dirs inside that wider surface are the backstop of
//    isWriteAllowed (lib/file-access-policy.js): ~/.claude credentials/settings/
//    history, ~/.ssh, the LOG_DIR tree, the config-backup tree, private keys, etc.
//  - rename validates BOTH source and destination with isWriteAllowed (renaming a
//    denylisted name to a benign one must not make it readable); recursive delete
//    scans the subtree and refuses if any descendant is write-denied.
//  - Every handler is gated by isAdminReq + isSameOriginBrowserRequest BEFORE the
//    body is read (same bar as the read route), because these endpoints can reach
//    the user's home tree.
//  - Symlinks are rejected as mutation targets (lstat on the spelled path);
//    isWriteAllowed additionally refuses a dangling-symlink leaf so create/save
//    cannot be redirected outside the root. Delete re-realpaths before rmdir
//    (TOCTOU defense).
import {
  existsSync, statSync, lstatSync, mkdirSync, writeFileSync,
  realpathSync, rmSync, unlinkSync, readdirSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { isWriteAllowed, isReadAllowed } from '../lib/file-access-policy.js';
import { renameSyncWithRetry } from '../lib/file-api.js';
import { reportSwallowed } from '../lib/error-report.js';
import { revealInOs, openTerminalAt } from '../lib/os-open.js';
import { viewRootOrReply } from '../lib/view-root.js';
import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';
import { loadWorkspaces } from '../workspace-registry.js';
import { listLivePtys } from '../pty-manager.js';
import {
  targetError, errnoToStatus, insidePath, requiredTargetRelPath, resolveTargetWriteScope,
} from '../lib/target-scope.js';

function forbidden(res) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'forbidden' }));
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function replyTargetError(res, err) {
  const status = err?.status || 500;
  if (status === 500) console.error('[api/target-*]', err);
  send(res, status, { error: status === 500 ? 'Internal error' : err.message });
}

// Resolve the viewed project cwd (query project/instance win over POST body).
function cwdFor(req, res, parsedUrl, body) {
  return viewRootOrReply(req, res, parsedUrl, {
    boundCwd: process.env.CCV_PROJECT_DIR || process.cwd(),
    loadWorkspaces,
    listLivePtys,
    bodyProject: body?.project,
    bodyInstance: body?.instance,
  });
}

// Read + JSON-parse the POST body, then run `run(body, scope)`. The admin +
// same-origin gate runs BEFORE the body is consumed so a cross-site / non-admin
// caller cannot even reach the parser. `scope` is re-derived server-side from
// the target identity in the query string (never from a client-sent root).
function withBody(req, res, parsedUrl, isLocal, deps, run) {
  if (!isAdminReq(req, isLocal) || !isSameOriginBrowserRequest(req, parsedUrl)) {
    return forbidden(res);
  }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return send(res, 400, { error: 'Invalid request body' }); }
    try {
      const cwd = cwdFor(req, res, parsedUrl, parsed);
      if (!cwd) return;
      const scope = resolveTargetWriteScope(parsedUrl, cwd);
      run(parsed, scope);
    } catch (err) {
      replyTargetError(res, err);
    }
  });
}

// Reject symlink mutation targets: an attacker could swap a symlink between
// validation and the mutation so the operation lands outside the navigation
// root. lstat does not follow the link, so an isSymbolicLink() hit refuses.
function lstatNoSymlink(fullPath) {
  let st;
  try { st = lstatSync(fullPath); } catch (err) { throw targetError(errnoToStatus(err), 'Path not found'); }
  if (st.isSymbolicLink()) throw targetError(400, 'Cannot operate on symbolic links via this endpoint');
  return st;
}

// Walk a directory subtree and throw 403 if any descendant fails the write
// policy. Used before a recursive rmdir so deleting a directory cannot bypass
// the per-file denylist (credentials, settings, transcripts). Symlinks are
// skipped (their targets are evaluated by the caller's own containment checks).
function assertSubtreeWritable(dirReal) {
  let dirents;
  try { dirents = readdirSync(dirReal, { withFileTypes: true }); } catch { return; }
  for (const entry of dirents) {
    const child = join(dirReal, entry.name);
    let lst;
    try { lst = lstatSync(child); } catch { continue; }
    if (lst.isSymbolicLink()) continue;
    const policy = isWriteAllowed(child);
    if (!policy.ok) throw targetError(403, `Refusing to delete: contains a protected path (${entry.name})`);
    if (lst.isDirectory()) assertSubtreeWritable(child);
  }
}

function validateName(name, kind) {
  if (!name) throw targetError(400, 'Missing name');
  if (name.includes('/') || name.includes('\\') || name.includes('..') || /[\x00-\x1f]/.test(name)) {
    throw targetError(400, `Invalid ${kind} name`);
  }
  // A `.git` segment must never be created/renamed into place from the browser.
  if (name.toLowerCase() === '.git') throw targetError(400, `Invalid ${kind} name`);
}

// Resolve a navigation-root-relative path to its real absolute path, enforcing
// containment in the navigation root. Returns the REAL path (symlinks resolved).
function resolveContained(scope, segments) {
  const full = segments.length ? join(scope.rootReal, ...segments) : scope.rootReal;
  let real;
  try { real = realpathSync(full); } catch (err) { throw targetError(errnoToStatus(err), 'Path not found'); }
  if (!insidePath(real, scope.rootReal)) throw targetError(403, 'Path outside navigation root');
  return { full, real };
}

// ─── reveal in OS file manager ──────────────────────────────────────────────
function targetRevealFile(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, parsedUrl, isLocal, deps, (parsed, scope) => {
    // '' resolves to the navigation root itself (the browser's container menu).
    const segments = requiredTargetRelPath(parsed.path ?? '');
    const { full, real } = resolveContained(scope, segments);
    // Reveal is a READ-side action (open the OS file manager), so gate it with the
    // read policy, not the write policy — a read-only-but-unwritable entry (e.g.
    // inside LOG_DIR) must still be revealable.
    if (parsed.path) {
      const policy = isReadAllowed(real);
      if (!policy.ok) throw targetError(403, 'Path not allowed');
    }
    // A directory reveals itself; a file reveals its parent (Linux xdg-open on a
    // file would launch the default app instead of showing it).
    revealInOs(full, { isDir: statSync(real).isDirectory() });
    send(res, 200, { ok: true, fullPath: full });
  });
}

// ─── open in OS terminal ────────────────────────────────────────────────────
function targetOpenTerminal(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, parsedUrl, isLocal, deps, (parsed, scope) => {
    const segments = requiredTargetRelPath(parsed.path ?? '');
    const { real } = resolveContained(scope, segments);
    const st = statSync(real);
    // Opening a terminal on a FILE opens it in the file's directory instead.
    const dir = st.isDirectory() ? real : dirname(real);
    openTerminalAt(dir);
    send(res, 200, { ok: true });
  });
}

// ─── resolve to absolute path (for copy-path / attach-to-chat) ──────────────
function targetResolvePath(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, parsedUrl, isLocal, deps, (parsed, scope) => {
    const segments = parsed.path ? requiredTargetRelPath(parsed.path) : [];
    const full = segments.length ? join(scope.rootReal, ...segments) : scope.rootReal;
    send(res, 200, { ok: true, fullPath: full });
  });
}

// ─── create file ────────────────────────────────────────────────────────────
function targetCreateFile(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, parsedUrl, isLocal, deps, (parsed, scope) => {
    validateName(parsed.name, 'file');
    const dirSegs = parsed.dirPath ? requiredTargetRelPath(parsed.dirPath) : [];
    const { real: dirReal } = resolveContained(scope, dirSegs);
    if (!statSync(dirReal).isDirectory()) throw targetError(400, 'Directory not found');
    const full = join(dirReal, parsed.name);
    if (existsSync(full)) throw targetError(409, 'File already exists');
    const policy = isWriteAllowed(full);
    if (!policy.ok) throw targetError(403, 'Path not allowed');
    writeFileSync(policy.real, '');
    const relPath = parsed.dirPath ? `${parsed.dirPath}/${parsed.name}` : parsed.name;
    send(res, 200, { ok: true, path: relPath });
  });
}

// ─── create directory ───────────────────────────────────────────────────────
function targetCreateDir(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, parsedUrl, isLocal, deps, (parsed, scope) => {
    validateName(parsed.name, 'folder');
    const dirSegs = parsed.dirPath ? requiredTargetRelPath(parsed.dirPath) : [];
    const { real: dirReal } = resolveContained(scope, dirSegs);
    if (!statSync(dirReal).isDirectory()) throw targetError(400, 'Directory not found');
    const full = join(dirReal, parsed.name);
    if (existsSync(full)) throw targetError(409, 'Already exists');
    const policy = isWriteAllowed(full);
    if (!policy.ok) throw targetError(403, 'Path not allowed');
    mkdirSync(policy.real);
    const relPath = parsed.dirPath ? `${parsed.dirPath}/${parsed.name}` : parsed.name;
    send(res, 200, { ok: true, path: relPath });
  });
}

// ─── rename (basename only; never moves across directories) ────────────────
function targetRenameFile(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, parsedUrl, isLocal, deps, (parsed, scope) => {
    const { oldPath, newName } = parsed;
    if (!oldPath || !newName) throw targetError(400, 'Missing oldPath or newName');
    validateName(newName, 'file');
    const segs = requiredTargetRelPath(oldPath);
    // Renaming the navigation root itself would break the browser's own anchor.
    if (segs.length === 0) throw targetError(403, 'Cannot rename the navigation root');
    const { full: oldFull, real: oldReal } = resolveContained(scope, segs);
    // Symlink check must run on the SPELLED path (oldFull), not the realpath'd
    // one — lstat on oldReal can never see a symlink, so checking it would
    // silently rename the link's target instead of refusing the link.
    lstatNoSymlink(oldFull);
    // SECURITY: validate the SOURCE with the write policy too, not just the
    // destination. Renaming a denylisted name (settings.json / credentials.json /
    // master.key) or subtree (projects/ todos/ shell-snapshots/ …) to a benign
    // name would otherwise make it readable via /api/file-content — a denylist
    // bypass. Do NOT drop this check in review.
    const srcPolicy = isWriteAllowed(oldReal);
    if (!srcPolicy.ok) throw targetError(403, 'Path not allowed');
    // SECURITY: renaming a DIRECTORY moves its whole subtree, so apply the same
    // per-descendant write scan as delete. Without this, renaming ~/.claude (or a
    // sensitive-prefix dir like ~/.ssh) to a benign name would sidestep every
    // path-based denylist (the read policy keys off the live config-dir path) and
    // expose credentials/transcripts. Do NOT drop this scan in review.
    if (statSync(oldReal).isDirectory()) assertSubtreeWritable(oldReal);
    // Parent must also stay inside the navigation root (it does, but the rename
    // destination is derived from it, so assert before composing).
    const parentDir = dirname(oldReal);
    if (!insidePath(parentDir, scope.rootReal)) throw targetError(403, 'Path outside navigation root');
    const newFull = join(parentDir, newName);
    const policy = isWriteAllowed(newFull);
    if (!policy.ok) throw targetError(403, 'Path not allowed');
    const parentRel = segs.slice(0, -1).join('/');
    const newRelPath = parentRel ? `${parentRel}/${newName}` : newName;

    // Case-only rename on a case-insensitive FS needs a temp hop (same dance as
    // files-fs.js renameFile) so NTFS/APFS do not see the destination as the source.
    const oldName = basename(oldReal);
    if (oldName !== newName && oldName.toLowerCase() === newName.toLowerCase()) {
      try {
        if (realpathSync.native(newFull) === realpathSync.native(oldReal)) {
          const tempPath = join(parentDir, `.ccv-rename-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
          renameSyncWithRetry(oldReal, tempPath);
          try { renameSyncWithRetry(tempPath, newFull); }
          catch (err) {
            try { renameSyncWithRetry(tempPath, oldReal); }
            catch (rollbackErr) { reportSwallowed('targetFs.renameRollback', rollbackErr, { tempPath }); }
            throw err;
          }
          return send(res, 200, { ok: true, newPath: newRelPath });
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    if (existsSync(newFull)) throw targetError(409, 'Target already exists');
    renameSyncWithRetry(oldReal, newFull);
    send(res, 200, { ok: true, newPath: newRelPath });
  });
}

// ─── delete ─────────────────────────────────────────────────────────────────
function targetDeleteFile(req, res, parsedUrl, isLocal, deps) {
  withBody(req, res, parsedUrl, isLocal, deps, (parsed, scope) => {
    const filePath = parsed.path;
    if (!filePath) throw targetError(400, 'Missing path');
    const segs = requiredTargetRelPath(filePath);
    if (segs.length === 0) throw targetError(403, 'Cannot delete the navigation root');
    const { full, real } = resolveContained(scope, segs);
    const policy = isWriteAllowed(real);
    if (!policy.ok) throw targetError(403, 'Path not allowed');
    const st = lstatNoSymlink(full);
    if (st.isDirectory()) {
      // protectedDirs guard must defeat Win backslash + NTFS case-insensitive
      // spellings, so normalize both separators and case before the check.
      const protectedDirs = new Set(['node_modules', '.git', '.svn', '.hg']);
      const normalizedSegs = filePath.split(/[\\/]/).map(s => s.toLowerCase());
      if (normalizedSegs.some(part => protectedDirs.has(part))) {
        throw targetError(400, 'Cannot delete protected directory');
      }
      // Defense-in-depth: re-realpath in the window between lstat and rmdir.
      const real2 = realpathSync(full);
      if (!insidePath(real2, scope.rootReal)) throw targetError(403, 'Path escaped navigation root');
      // SECURITY: a recursive rmdir must not bypass the per-file write policy.
      // Scan the subtree and refuse the whole delete if ANY descendant is
      // write-denied (settings.json / credentials / projects transcripts / …),
      // otherwise deleting ~/.claude would wipe the very files the policy
      // protects one-by-one. Do NOT remove this scan to "speed up" deletes.
      assertSubtreeWritable(real2);
      rmSync(full, { recursive: true, force: true });
    } else if (st.isFile()) {
      unlinkSync(full);
    } else {
      throw targetError(400, 'Unsupported path type');
    }
    send(res, 200, { ok: true });
  });
}

export const targetFilesFsRoutes = [
  { method: 'POST', match: 'exact', path: '/api/target-reveal-file', handler: targetRevealFile },
  { method: 'POST', match: 'exact', path: '/api/target-open-terminal', handler: targetOpenTerminal },
  { method: 'POST', match: 'exact', path: '/api/target-resolve-path', handler: targetResolvePath },
  { method: 'POST', match: 'exact', path: '/api/target-create-file', handler: targetCreateFile },
  { method: 'POST', match: 'exact', path: '/api/target-create-dir', handler: targetCreateDir },
  { method: 'POST', match: 'exact', path: '/api/target-rename-file', handler: targetRenameFile },
  { method: 'POST', match: 'exact', path: '/api/target-delete-file', handler: targetDeleteFile },
];
