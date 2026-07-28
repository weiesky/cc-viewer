// 1.7.0 migration prompt (plan P2): detect legacy v1 logs that have not been
// converted to the v2 session store yet, so the UI can offer one-click
// migration at startup / workspace switch. Detection is pure filesystem
// arithmetic on top of the converter's own bookkeeping — a v1 file counts as
// pending unless the convert state marks it done AT ITS CURRENT SIZE (the
// converter's trust rule, convert.js), because the converter never deletes
// v1 sources ("files exist" alone is not "migration needed").
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { listV1Files, listConvertibleProjects, readConvertState } from './convert.js';

/** Pending v1 files + bytes of ONE project dir. */
function pendingOf(projectDir) {
  const state = readConvertState(projectDir);
  // Migration already completed — don't re-prompt, even if v1 files grew
  // (dual-write captures new entries in v2).
  if (state && state.status === 'done') return { files: 0, totalBytes: 0 };
  const doneAtSize = new Map(
    (state && Array.isArray(state.files) ? state.files : [])
      .filter((f) => f && f.done)
      .map((f) => [f.name, f.size])
  );
  let files = 0;
  let totalBytes = 0;
  for (const name of listV1Files(projectDir)) {
    let size = 0;
    try { size = statSync(join(projectDir, name)).size; } catch { continue; }
    if (size === 0) continue; // empty shells are not worth prompting over
    if (doneAtSize.get(name) === size) continue; // converted & unchanged
    files++;
    totalBytes += size;
  }
  return { files, totalBytes };
}

/**
 * Migration status of one project (plus how many OTHER projects also have
 * pending v1 logs — the prompt mentions `ccv convert --all` for those).
 * @param {string} logDir - LOG_DIR root
 * @param {string} project - project directory name ('' → not pending)
 * @returns {{pending: boolean, files: number, totalBytes: number, otherProjects: number}}
 */
export function migrationStatus(logDir, project) {
  const empty = { pending: false, files: 0, totalBytes: 0, otherProjects: 0 };
  if (!logDir || !project) return empty;
  try {
    const { files, totalBytes } = pendingOf(join(logDir, project));
    let otherProjects = 0;
    for (const p of listConvertibleProjects(logDir)) {
      if (p === project) continue;
      if (pendingOf(join(logDir, p)).files > 0) otherProjects++;
    }
    return { pending: files > 0, files, totalBytes, otherProjects };
  } catch {
    return empty;
  }
}
