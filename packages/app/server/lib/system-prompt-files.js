import { statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_PROMPT_DIR, matchModelPrompt } from './model-system-prompts.js';

// 启动目录里检查的「全大写 sentinel」文件名：多词约定用下划线连接
// (对齐 CLAUDE.md / GitHub CODE_OF_CONDUCT.md 等惯例)。
// The uppercase sentinel filenames checked in claude's launch directory.
export const SYSTEM_PROMPT_FILE = 'CC_SYSTEM.md';
export const APPEND_SYSTEM_PROMPT_FILE = 'CC_APPEND_SYSTEM.md';

// 一键关闭整个自动注入的 env 开关 (=== '1' 生效)，对齐本仓库 CCV_* 短路开关风格。
// Opt-out env var to disable the whole auto-injection.
export const DISABLE_AUTO_SYSTEM_PROMPT_ENV = 'CCV_DISABLE_AUTO_SYSTEM_PROMPT';

// 文件需存在、是普通文件且非空(size>0)才算数：空文件会把 system prompt 抹空，跳过更安全。
// 坏符号链接 / 不存在 / 目录 → statSync 抛错或 isFile()=false → 返回 false。
export function isNonEmptyFile(p) {
  try {
    const st = statSync(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

// args 里是否已含某个 flag(同时匹配 `--x` 与 `--x=value` 两种写法，检测更稳)。
function hasArg(args, ...names) {
  if (!Array.isArray(args)) return false;
  return args.some(a =>
    typeof a === 'string' && names.some(n => a === n || a.startsWith(n + '='))
  );
}

/**
 * 启动 claude 前，按「启动目录」里的 sentinel 文件决定是否注入 system prompt 文件参数。
 *
 * - CC_SYSTEM.md → --system-prompt-file (整段替换默认 system prompt)
 * - CC_APPEND_SYSTEM.md → --append-system-prompt-file (追加到默认之后)
 * 两者独立生效；用户已手动传同义 flag 时跳过对应自动项(手动优先)；
 * 空文件跳过；CCV_DISABLE_AUTO_SYSTEM_PROMPT=1 整体关闭。
 *
 * 模型定制(opts.modelId 提供时)：先在 <projectDir>/system_prompt/(工作区)与
 * opts.globalModelDir(全局)里做模糊匹配；命中的条目「整体取代」上面两份默认 sentinel
 * ——即便手动 flag 抑制了注入也不再回看默认文件(条目已取而代之)。未命中/无 modelId
 * 则完全走旧逻辑。
 *
 * Decide whether to inject system-prompt file flags based on sentinel files in
 * the launch directory. When opts.modelId is given, model-specific entries in
 * the workspace/global system_prompt folders are matched first; a match fully
 * supersedes the Default sentinels. Pure function: reads fs/env only.
 *
 * @param {string} projectDir 启动目录(绝对路径)
 * @param {string[]} [existingArgs] 已有的 claude 参数(用于「手动优先」判断)
 * @param {Object} [env] 环境变量(默认 process.env)
 * @param {{ modelId?: string|null, globalModelDir?: string|null }} [opts]
 * @returns {{ args: string[], loaded: string[], model: string|null, suppressed?: 'env'|'manual-flag' }}
 *          args: 待追加参数；loaded: 实际加载的文件(终端提示)；model: 命中的条目名(未命中为 null)；
 *          suppressed: 注入被有意跳过的原因(env 开关 / 手动同义 flag 抑制了已命中的模型条目)——
 *          调用方(pty-manager)据此不再打「no matching entry」误导性告警。
 */
export function buildSystemPromptFileArgs(projectDir, existingArgs = [], env = process.env, opts = {}) {
  const out = { args: [], loaded: [], model: null };
  if (!projectDir) return out;
  if (env?.[DISABLE_AUTO_SYSTEM_PROMPT_ENV] === '1') return { ...out, suppressed: 'env' };

  if (opts?.modelId) {
    const candidates = [{ dir: join(projectDir, MODEL_PROMPT_DIR), scope: 'workspace' }];
    if (opts.globalModelDir) candidates.push({ dir: opts.globalModelDir, scope: 'global' });
    const match = matchModelPrompt(opts.modelId, candidates);
    if (match) {
      const flagPair = match.mode === 'override'
        ? ['--system-prompt', '--system-prompt-file']
        : ['--append-system-prompt', '--append-system-prompt-file'];
      if (!hasArg(existingArgs, ...flagPair)) {
        out.args.push(flagPair[1], match.path);
        out.loaded.push(`${match.scope === 'global' ? 'global ' : ''}${MODEL_PROMPT_DIR}/${match.fileName}`);
        out.model = match.name;
      } else {
        out.suppressed = 'manual-flag'; // 条目命中但用户手传了同义 flag：有意跳过，非「无条目」
      }
      return out; // 命中即返回：默认 sentinel 不再参与(含手动 flag 抑制注入的情况)。
    }
    // No matching entry: fall through to the default sentinels. Diagnostics for
    // this case live in the caller (pty-manager) — this stays a pure function.
  }

  // 整段替换：CC_SYSTEM.md → --system-prompt-file (用户已传 --system-prompt[-file] 则跳过)
  if (!hasArg(existingArgs, '--system-prompt', '--system-prompt-file')) {
    const p = join(projectDir, SYSTEM_PROMPT_FILE);
    if (isNonEmptyFile(p)) {
      out.args.push('--system-prompt-file', p);
      out.loaded.push(SYSTEM_PROMPT_FILE);
    }
  }
  // 追加：CC_APPEND_SYSTEM.md → --append-system-prompt-file (用户已传 --append-system-prompt[-file] 则跳过)
  if (!hasArg(existingArgs, '--append-system-prompt', '--append-system-prompt-file')) {
    const p = join(projectDir, APPEND_SYSTEM_PROMPT_FILE);
    if (isNonEmptyFile(p)) {
      out.args.push('--append-system-prompt-file', p);
      out.loaded.push(APPEND_SYSTEM_PROMPT_FILE);
    }
  }
  return out;
}

/**
 * 读取「当前工作区」的系统文本，供偏好设置「系统文本修改」回显(两模式互斥，至多一份生效)。
 * - CC_SYSTEM.md 非空 → { mode:'override', text }
 * - 否则 CC_APPEND_SYSTEM.md 非空 → { mode:'append', text }
 * - 都没有 / 无 dir / 读失败 → { mode:'append', text:'' }(默认追加)
 * Read the workspace's system text for the preferences editor.
 *
 * @param {string} dir 工作区目录
 * @returns {{ mode: 'override'|'append', text: string }}
 */
export function readWorkspaceSystemText(dir) {
  if (dir) {
    const sysPath = join(dir, SYSTEM_PROMPT_FILE);
    if (isNonEmptyFile(sysPath)) {
      try { return { mode: 'override', text: readFileSync(sysPath, 'utf-8') }; } catch { /* fall through */ }
    }
    const appendPath = join(dir, APPEND_SYSTEM_PROMPT_FILE);
    if (isNonEmptyFile(appendPath)) {
      try { return { mode: 'append', text: readFileSync(appendPath, 'utf-8') }; } catch { /* fall through */ }
    }
  }
  return { mode: 'append', text: '' };
}

/**
 * 写「当前工作区」的系统文本，两模式互斥：
 * - text 去空白后为空 → 删两份(= 关闭功能)，返回 { cleared:true }
 * - mode==='override' → 写 CC_SYSTEM.md + 删 CC_APPEND_SYSTEM.md
 * - 否则(默认 append)→ 写 CC_APPEND_SYSTEM.md + 删 CC_SYSTEM.md
 * 写入原文 text(仅用 trim 判空，不改动内容本身)。
 * Write the workspace's system text; the two modes are mutually exclusive.
 *
 * @param {string} dir 工作区目录(必填，缺失则 throw)
 * @param {'override'|'append'} mode
 * @param {string} text
 * @returns {{ mode: 'override'|'append', written: boolean, cleared: boolean }}
 */
export function writeWorkspaceSystemText(dir, mode, text) {
  if (!dir) throw new Error('no workspace directory');
  const normMode = mode === 'override' ? 'override' : 'append';
  const sysPath = join(dir, SYSTEM_PROMPT_FILE);
  const appendPath = join(dir, APPEND_SYSTEM_PROMPT_FILE);
  const raw = typeof text === 'string' ? text : '';
  const rm = (p) => { try { rmSync(p, { force: true }); } catch { /* ignore */ } };

  if (raw.trim().length === 0) {
    rm(sysPath);
    rm(appendPath);
    return { mode: normMode, written: false, cleared: true };
  }
  // 先删反向文件、再写目标文件：缩小「两份并存」的中间态窗口——若写入前进程被杀，
  // 最坏只是两份都不在(下次启动不注入)，而非两份同时存在被一并注入。
  if (normMode === 'override') {
    rm(appendPath);
    writeFileSync(sysPath, raw, 'utf-8');
  } else {
    rm(sysPath);
    writeFileSync(appendPath, raw, 'utf-8');
  }
  return { mode: normMode, written: true, cleared: false };
}
