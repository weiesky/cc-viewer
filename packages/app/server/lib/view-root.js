// View-root resolution (multi-project, 2026-10): map an optional `?project=`
// name to the REAL filesystem root of that project, so project-scoped READ
// routes (file tree / git / skills / memory / stats / search) can follow the
// viewed parallel project instead of always the bound one.
//
// Name → path sources (both consulted, in order):
//   1. workspace-registry (loadWorkspaces) — persistent { path, projectName },
//      works even when the project has no live PTY;
//   2. pty-manager live records (listLivePtys) — currentWorkspacePath of a
//      running/exited-but-unreaped record.
// The bound project is the fallback when no override is given (byte-identical
// to the pre-multi-project behavior).
//
// Name collision arbitration (2026-10-05): two different real dirs can share
// one basename-derived project name (e.g. ~/proj and ~/work/proj both named
// "proj"). Never silently pick a WRONG one — but a single live PTY is the
// authoritative answer (a view attach means "look at the running project"),
// and a registry entry whose path no longer exists is dead weight. Order:
//   1. exactly one live PTY candidate → use it;
//   2. no live PTY → drop registry candidates whose dir is gone;
//      one survivor → use it;
//   3. still >1 real candidate → 400, never a silent guess.
//
// Pure + dependency-injected (fs/registry/pty seams) so it is directly
// node-testable. WRITE routes must NOT use this — they stay bound-only.

import { realpathSync, existsSync, statSync } from 'node:fs';
import { projectKeyForCwd } from './system-prompt-snapshots.js';

// A project name must be sanitizer-stable: projectKeyForCwd maps every legal
// basename to [a-zA-Z0-9_\-\.] (collapsing only ALL-dot degenerate names to
// '_'), so a name that still contains anything else could never match a
// registered/live candidate anyway. Reject it here (along with separators and
// control chars) as a 400 — never a lookup that can only 404. Interior dots
// (`foo..bar`, `v2.3`) are legal basenames and pass the round-trip check;
// traversal is already impossible because separators are rejected.
function isValidProjectName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  return projectKeyForCwd(name) === name;
}

/**
 * @param {object} opts
 * @param {string} [opts.projectParam] - the `?project=` override (may be ''/undefined).
 * @param {string} opts.boundCwd - the bound project root (CCV_PROJECT_DIR || process.cwd()).
 * @param {() => Array<{path:string, projectName:string}>} opts.loadWorkspaces - registry reader.
 * @param {() => Array<{cwd:string}>} opts.listLivePtys - live PTY records.
 * @returns {{ ok:true, root:string, via:'bound'|'registry'|'live' } | { ok:false, status:number, error:string }}
 */
export function resolveViewRoot({ projectParam, boundCwd, loadWorkspaces, listLivePtys } = {}) {
  const bound = boundCwd || process.cwd();
  const name = (typeof projectParam === 'string' && projectParam) || '';
  if (!name) return { ok: true, root: bound, via: 'bound' };
  if (!isValidProjectName(name)) {
    return { ok: false, status: 400, error: 'invalid project name' };
  }
  // Bound project by name → normally the bound root (covers "view switches
  // back"). But do NOT short-circuit past arbitration when a DIFFERENT live
  // PTY holds the same name: bound /a/proj + parallel live /b/proj (both
  // "proj") would otherwise silently resolve the parallel tab's ?project=proj
  // to the bound dir — the exact wrong-project pick this module forbids. So
  // the bound root joins the candidate pool and only wins when no other live
  // PTY claims the name.
  const boundMatches = projectKeyForCwd(bound) === name;

  const candidates = [];
  if (boundMatches) candidates.push({ path: bound, via: 'bound' });
  try {
    for (const w of loadWorkspaces() || []) {
      if (w && w.projectName === name && typeof w.path === 'string' && w.path) {
        candidates.push({ path: w.path, via: 'registry' });
      }
    }
  } catch { /* registry unreadable → fall through to live */ }
  try {
    for (const p of listLivePtys() || []) {
      const cwd = p && p.cwd;
      if (typeof cwd === 'string' && cwd && projectKeyForCwd(cwd) === name) {
        candidates.push({ path: cwd, via: 'live' });
      }
    }
  } catch { /* pty map unavailable → registry-only */ }

  // Dedupe by path string (a project live AND registered under the SAME path
  // is one candidate). Keys are the raw candidate paths — not realpathSync —
  // so two symlink aliases of one real dir stay distinct and fall through to
  // the arbitration below rather than being merged here. When the SAME path
  // appears in both sources keep via:'live' — the live record must still count
  // as a live candidate in the arbitration below, otherwise a
  // running+registered project plus one stale same-name entry would look like
  // "no live PTY, two real candidates" and wrongly 400.
  const byPath = new Map();
  for (const c of candidates) {
    const prev = byPath.get(c.path);
    if (!prev || c.via === 'live') byPath.set(c.path, c);
  }
  const uniq = [...byPath.values()];
  if (uniq.length === 0) {
    return { ok: false, status: 404, error: 'unknown project' };
  }
  // Arbitration when the name maps to more than one real dir (see header):
  //  1. A single live PTY is authoritative — an attach view means "the running
  //     project", so a live record outranks stale registry entries.
  if (uniq.length > 1) {
    const live = uniq.filter((c) => c.via === 'live');
    if (live.length === 1) {
      const root = live[0].path;
      try {
        if (!existsSync(root) || !statSync(root).isDirectory()) {
          return { ok: false, status: 404, error: 'project dir missing' };
        }
        return { ok: true, root: realpathSync(root), via: 'live' };
      } catch {
        return { ok: false, status: 404, error: 'project dir unreadable' };
      }
    }
    if (live.length > 1) {
      // Two REAL PTYs running in two different dirs under one name — no
      // authoritative tiebreak; refuse rather than guess.
      return { ok: false, status: 400, error: 'ambiguous project name' };
    }
    // 2. No live PTY: drop registry candidates whose dir is gone (dead residue
    //    from a moved/deleted checkout), then re-check the survivor count.
    const alive = uniq.filter((c) => {
      try { return existsSync(c.path) && statSync(c.path).isDirectory(); }
      catch { return false; }
    });
    if (alive.length === 0) {
      return { ok: false, status: 404, error: 'unknown project' };
    }
    if (alive.length > 1) {
      return { ok: false, status: 400, error: 'ambiguous project name' };
    }
    const root = alive[0].path;
    try {
      return { ok: true, root: realpathSync(root), via: alive[0].via };
    } catch {
      return { ok: false, status: 404, error: 'project dir unreadable' };
    }
  }
  const root = uniq[0].path;
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      return { ok: false, status: 404, error: 'project dir missing' };
    }
    return { ok: true, root: realpathSync(root), via: uniq[0].via };
  } catch {
    return { ok: false, status: 404, error: 'project dir unreadable' };
  }
}

/**
 * HTTP-facing wrapper shared by every project-scoped READ route (multi-project,
 * 2026-10): resolves `?project=` (or a POST-body override) via resolveViewRoot
 * and, on failure, writes the error response itself. Returns the resolved root
 * to continue with, or null after replying (the caller must return early).
 *
 * Centralizing here removes the three byte-identical per-route copies
 * (files-content / git / skills) — routes → lib is a legal L3→L1 edge.
 *
 * @param {object} req - the incoming request.
 * @param {object} res - the response (error written here on failure).
 * @param {URL} parsedUrl - the request URL (query `project` read here).
 * @param {object} opts
 * @param {string} opts.boundCwd - the bound project root (CCV_PROJECT_DIR || process.cwd()).
 * @param {() => Array} opts.loadWorkspaces - registry reader.
 * @param {() => Array} opts.listLivePtys - live PTY records.
 * @param {string} [opts.bodyProject] - POST-body project override (wins over query).
 * @returns {string|null} the resolved absolute root, or null (already replied).
 */
export function viewRootOrReply(req, res, parsedUrl, { boundCwd, loadWorkspaces, listLivePtys, bodyProject } = {}) {
  const r = resolveViewRoot({
    projectParam: (typeof bodyProject === 'string' && bodyProject) || parsedUrl?.searchParams?.get('project'),
    boundCwd,
    loadWorkspaces,
    listLivePtys,
  });
  if (!r.ok) {
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: r.error }));
    return null;
  }
  return r.root;
}
