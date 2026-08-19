/**
 * CLAUDE.md 候选发现 + 安全读取。
 *
 * 用途：为 /api/claude-md 端点提供 (1) 候选清单计算 (2) 通过稳定 id 取回某条候选的内容。
 *
 * 策略：
 *   - 项目候选：从 cwd 实际路径（realpath 后）向上走，每层若 <dir>/CLAUDE.md 存在且为文件，收一条。
 *     终止条件：dir === dirname(dir)（fs root） / dir === homedir() / <dir>/.git 存在 / depth 达 8（任一即停）。
 *     三种终止条件（homedir / .git / fs root）都先收当前层再停——pushIfFile 在终止判定之前无条件执行。
 *   - 全局候选：~/.claude/CLAUDE.md（以参数 claudeConfigDir 为准，由调用方传入，便于沙箱测试）。
 *   - 排序：项目候选按"靠近 cwd"在前，全局总是最后一条。
 *   - 去重：基于 realpath 去重；同一物理文件被多入口指向只留一条（保留先入者）。
 *   - id：sha1(realPath).slice(0,12)。FS 不变 → 两次 list 结果一致；候选被换成不同物理文件 → id 变化（防 swap）。
 *   - Windows：跳过父链遍历，只返回全局候选（POSIX 父链语义在 win 上需要单独验证，留给 v2）。
 */

import { existsSync, statSync, realpathSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { dirname, join, basename, relative } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const MAX_DEPTH = 8;

function safeRealpath(p) {
  try { return realpathSync(p); } catch { return null; }
}

function isFileSafe(p) {
  try {
    const st = statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function makeId(realPath) {
  return createHash('sha1').update(realPath).digest('hex').slice(0, 12);
}

/**
 * @param {object} opts
 * @param {string} opts.cwd            起始目录(将被 realpath 化)。
 * @param {string} opts.claudeConfigDir ~/.claude 目录(由 findcc.getClaudeConfigDir() 提供)。
 * @param {(p:string) => {ok:boolean, real?:string}} [opts.isReadAllowedFn] 可选预过滤闸:
 *        若提供, 候选必须 isReadAllowed(realPath).ok 才进列表 —— 避免父链祖先目录
 *        因不在 file-access-policy allowlist 而点击必返回 403 的 UX 坑。测试可省略。
 * @returns {Array<{id:string, scope:'project'|'global', realPath:string, tail:string, mtimeMs:number}>}
 */
export function discoverClaudeMdCandidates({ cwd, claudeConfigDir, isReadAllowedFn }) {
  const out = [];
  const seenReal = new Set();
  const home = homedir();

  const pushIfFile = (path, scope, tail) => {
    // path 可能是 dir/CLAUDE.md, 也可能是 ~/.claude/CLAUDE.md
    if (!existsSync(path)) return;
    const real = safeRealpath(path);
    if (!real) return;
    if (basename(real) !== 'CLAUDE.md') return; // 防 symlink-name swap
    if (!isFileSafe(real)) return;
    if (seenReal.has(real)) return;
    // 预过滤: 若注入了 policy gate, 不在 allowlist 内的祖先候选直接剔除 ——
    // 这样 UI chip 不会渲染出"看得见点不开"的 403 项 (defensive review P1-A)。
    if (typeof isReadAllowedFn === 'function') {
      const policy = isReadAllowedFn(real);
      if (!policy || !policy.ok) return;
    }
    seenReal.add(real);
    let mtimeMs = 0;
    try { mtimeMs = statSync(real).mtimeMs; } catch {}
    out.push({ id: makeId(real), scope, realPath: real, tail, mtimeMs });
  };

  // ── 项目链遍历 ─────────────────────────────────────────────────────────────
  if (process.platform !== 'win32') {
    const startReal = safeRealpath(cwd) || cwd;
    let dir = startReal;
    let depth = 0;
    while (depth < MAX_DEPTH) {
      const candidatePath = join(dir, 'CLAUDE.md');
      // tail：相对 startReal 的路径；若就是 startReal，tail = "CLAUDE.md"；
      // 父级则 tail = "../../CLAUDE.md"。UI 只用 tail 做信息提示（title=fullPath）。
      let tail;
      if (dir === startReal) {
        tail = 'CLAUDE.md';
      } else {
        const rel = relative(startReal, dir);
        tail = (rel ? rel + '/' : '') + 'CLAUDE.md';
      }
      pushIfFile(candidatePath, 'project', tail);

      // 终止判定：homedir / .git / fs root
      const isHome = dir === home;
      const hasGit = existsSync(join(dir, '.git'));
      const parent = dirname(dir);
      const atRoot = parent === dir;
      if (isHome || hasGit || atRoot) break;

      dir = parent;
      depth++;
    }
  }

  // ── 全局候选 ───────────────────────────────────────────────────────────────
  if (claudeConfigDir) {
    pushIfFile(join(claudeConfigDir, 'CLAUDE.md'), 'global', '.claude/CLAUDE.md');
  }

  return out;
}

/**
 * 通过稳定 id 取候选内容。调用方应：
 *   1) 先 discoverClaudeMdCandidates 得到 candidates;
 *   2) 用本函数按 id 取内容并做最终安全闸 (basename + isReadAllowed);
 *
 * 安全闸由 isReadAllowedFn 注入(默认 file-access-policy.isReadAllowed),便于测试 mock。
 *
 * @param {Array} candidates  discoverClaudeMdCandidates 的返回。
 * @param {string} id         12-hex 字符 id。
 * @param {object} opts
 * @param {number} opts.maxBytes               文件大小上限(字节)。
 * @param {(p:string) => {ok:boolean, real?:string, reason?:string}} opts.isReadAllowedFn 安全闸。
 * @returns {{ok:true, scope, tail, content, real} | {ok:false, status:number, error:string}}
 */
export function readCandidateById(candidates, id, { maxBytes, isReadAllowedFn }) {
  if (typeof id !== 'string' || !/^[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, status: 400, error: 'Invalid id' };
  }
  const entry = candidates.find(c => c.id === id);
  if (!entry) return { ok: false, status: 404, error: 'Candidate not found' };

  // 二次校验：basename 仍是 CLAUDE.md (防 discovery 与 read 之间的 FS 变更)
  if (basename(entry.realPath) !== 'CLAUDE.md') {
    return { ok: false, status: 404, error: 'Candidate basename mismatch' };
  }

  const policy = isReadAllowedFn(entry.realPath);
  if (!policy.ok) {
    // 复用 file-access-policy.reasonToStatus 的语义：caller 决定状态码映射；
    // 这里给 403 作为默认，调用方可按 reason 重写。
    return { ok: false, status: 403, error: 'Forbidden', reason: policy.reason };
  }

  // 用 policy.real（已 realpath 过）做 size + read，避免再次 realpath 引入新的 TOCTOU 窗口。
  const real = policy.real;
  let size = 0;
  let fd = null;
  try {
    fd = openSync(real, 'r');
    const st = fstatSync(fd);
    if (!st.isFile()) {
      return { ok: false, status: 400, error: 'Not a file' };
    }
    size = st.size;
    if (size > maxBytes) {
      return { ok: false, status: 413, error: 'File too large' };
    }
    const buf = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const n = readSync(fd, buf, read, size - read, read);
      if (n === 0) break;
      read += n;
    }
    return {
      ok: true,
      scope: entry.scope,
      tail: entry.tail,
      content: buf.toString('utf-8'),
      real,
    };
  } catch (e) {
    return { ok: false, status: 500, error: e && e.code ? e.code : 'read-failed' };
  } finally {
    if (fd != null) {
      try { closeSync(fd); } catch {}
    }
  }
}
