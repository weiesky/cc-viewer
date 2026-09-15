/**
 * launch-config.js — Launch-time configuration shared by the PTY and SDK spawns.
 *
 * Extracted from pty-manager.js so the SDK link (sdk-manager.js / cli.js runSdkMode)
 * produces byte-identical system-prompt injection to the PTY link:
 *   - withDefaultThinkingDisplay: inject `--thinking-display summarized` by default
 *   - parseResumeArgs: continuation-flag parsing (-c/--continue/-r/--resume/--fork-session)
 *   - resolveLaunchSystemPrompt: the full system-prompt pipeline — resume pin
 *     (snapshot replay, never re-render variables) or fresh build (CC_SYSTEM.md /
 *     CC_APPEND_SYSTEM.md sentinels, model-specific match, ${...} template render),
 *     plus the pending record consumed by the wire-side binding (v2-writer Bind A).
 *
 * Everything here is spawn-shape logic only — no PTY, no SDK. Callers own their
 * mode-specific concerns (PTY: rejection self-heal sets, spawn notices; SDK: args →
 * options.extraArgs conversion).
 */

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LOG_DIR } from '../../findcc.js';
import { reportSwallowed } from '@ccv/core/error-report';
import {
  buildSystemPromptFileArgs, hasArg, argValue, isNonEmptyFile,
  SYSTEM_PROMPT_FILE, APPEND_SYSTEM_PROMPT_FILE,
} from './system-prompt-files.js';
import { renderSystemPromptFileArgs, renderedPromptDir } from './system-prompt-render.js';
import { createSystemPromptVariables } from './create_system_prompt.js';
import { appendPending, readSnapshot, resolveContinueTargetUuid } from './system-prompt-snapshots.js';
import { MODEL_PROMPT_DIR, listModelPrompts } from './model-system-prompts.js';
import { resolveSpawnModel } from './spawn-model-resolver.js';
import { setLaunchSystemPromptInfo } from './system-prompt-live.js';

// Opus 4.7 默认不再返回 thinking；为所有非显式覆写的调用加上 summarized。
// 纯函数：仅根据 args 决定是否注入；用户已显式传入 `--thinking-display` 时原样返回。
export function withDefaultThinkingDisplay(args) {
  if (!Array.isArray(args)) return args;
  const hasFlag = args.some(a =>
    a === '--thinking-display' || (typeof a === 'string' && a.startsWith('--thinking-display='))
  );
  return hasFlag ? args : [...args, '--thinking-display', 'summarized'];
}

// Tokens after a literal `--` are prompt text for claude — any flag appended there is
// silently swallowed as part of the prompt. cc-viewer's injected flags (system-prompt
// file args, `--thinking-display`) must therefore land in the user-flag region BEFORE
// the first literal `--`. Both spawn links (PTY pty-manager / headless runProxyCommand)
// share this helper so the byte order stays consistent and neither path re-introduces
// the "flag landed after `--`" misplacement.
//
// Pure function — never mutates the input. Two steps:
//   1. splice `injections` in just before the first literal `--` (or at the end when absent);
//   2. relocate any `--thinking-display <value>` pair that ended up at/after `--`
//      (it is appended at the very end by withDefaultThinkingDisplay) to just before `--`.
// User-supplied `--thinking-display` written before `--` is left untouched.
export function insertBeforeDashDash(args, injections = []) {
  if (!Array.isArray(args)) return args;
  const out = [...args];
  const dd = () => out.indexOf('--');
  if (injections.length) {
    const at = dd();
    out.splice(at === -1 ? out.length : at, 0, ...injections);
  }
  const live = dd();
  if (live !== -1) {
    const tdIdx = out.indexOf('--thinking-display', live);
    if (tdIdx !== -1) {
      const pair = out.splice(tdIdx, 2); // ['--thinking-display', value]
      out.splice(out.indexOf('--'), 0, ...pair);
    }
  }
  return out;
}

// Parse continuation flags from claude args: -c/--continue, -r/--resume (value as the
// next token or in = form), --fork-session. Returns null for non-continuation launches;
// picker=true means a valueless -r (interactive picker — target unknowable at spawn).
// Same flag set as cli.js markContinueEnv / routes/workspaces.js.
export function parseResumeArgs(args) {
  if (!Array.isArray(args)) return null;
  let continued = false;
  let resumeValue = null;
  let picker = false;
  let fork = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '--continue') { continued = true; continue; }
    if (a === '--fork-session') { fork = true; continue; }
    if (a === '-r' || a === '--resume') {
      continued = true;
      const next = args[i + 1];
      if (typeof next === 'string' && next && !next.startsWith('-')) { resumeValue = next; i++; }
      else picker = true;
      continue;
    }
    const m = typeof a === 'string' && a.match(/^(?:-r|--resume)=(.+)$/);
    if (m) { continued = true; resumeValue = m[1]; }
  }
  return continued ? { resumeValue, picker, fork } : null;
}

// Materialize snapshot entries into temp files. Each spawn gets its own subdirectory
// under renderedPromptDir (per-process): two sequential spawns pinning DIFFERENT
// conversations would otherwise overwrite the same basename before claude reads it.
// Returns the same {args, loaded, entries} shape renderSystemPromptFileArgs produces.
export function materializePinnedEntries(entries) {
  const args = [];
  const loaded = [];
  const out = [];
  for (const e of entries) {
    try {
      const dir = join(renderedPromptDir(), `pin-${randomBytes(4).toString('hex')}`);
      mkdirSync(dir, { recursive: true });
      const target = join(dir, e.basename);
      writeFileSync(target, e.content, 'utf-8');
      args.push(e.flag, target);
      loaded.push(e.basename);
      out.push({ flag: e.flag, basename: e.basename, content: e.content });
    } catch (err) {
      // A dropped entry breaks the byte-identity this feature exists to protect —
      // warn visibly AND report: silent degradation here is a future cache miss.
      console.warn(`[CC Viewer] system-prompt pin materialize failed for ${e?.basename}:`, err?.message || err);
      reportSwallowed('pty-pin.materialize', err);
    }
  }
  return { args, loaded, entries: out };
}

// Manual-first: a user-passed synonymous flag suppresses the matching pinned entry
// (same semantics as the fresh buildSystemPromptFileArgs path). All entries
// suppressed → no injection.
export function suppressManuallyFlaggedPinned(entries, userArgs) {
  return entries.filter(e => {
    const pair = e.flag === '--system-prompt-file'
      ? ['--system-prompt', '--system-prompt-file']
      : ['--append-system-prompt', '--append-system-prompt-file'];
    return !hasArg(userArgs, ...pair);
  });
}

// The F2 no-record notice only matters to users who HAVE injection configured right
// now (sentinel files or a model-prompt dir) — for everyone else a resume silently
// injecting nothing is exactly the status quo, and the line would be pure noise.
// Fidelity note (accepted gap): this check does NOT see the built-in preset layer —
// users whose only injection is a default-effective built-in (no dirs, no sentinels)
// get no F2 notice on resume either. Deliberate: making built-in hits count would turn
// the notice into near-constant noise for every built-in user resuming old sessions.
export function injectionConfigured(spawnDir, logDir = LOG_DIR) {
  try {
    return isNonEmptyFile(join(spawnDir, SYSTEM_PROMPT_FILE))
      || isNonEmptyFile(join(spawnDir, APPEND_SYSTEM_PROMPT_FILE))
      || existsSync(join(spawnDir, MODEL_PROMPT_DIR))
      || existsSync(join(logDir, MODEL_PROMPT_DIR));
  } catch { return false; }
}

// Default model reader with the NODE_TEST_CONTEXT guard (dev-shell model env vars must
// not leak into unit tests). pty-manager passes its own test-seam reader instead.
function _defaultModelReader(spawnDir, env, opts) {
  return env.NODE_TEST_CONTEXT ? null : resolveSpawnModel(spawnDir, env, opts);
}

/**
 * Resolve this launch's system-prompt injection.
 *
 * Resume-pin semantics (see pty-manager header / system-prompt-snapshots.js):
 *   target identified + snapshot record → re-inject the recorded bytes verbatim;
 *   target identified + no record       → inject NOTHING (F2 — never alter the system
 *                                         text an existing context already has);
 *   target unidentifiable (picker/-c with no transcripts) → normal fresh pipeline.
 *
 * @param {object} p
 * @param {string} p.spawnDir — directory claude runs with
 * @param {string[]} p.extraArgs — final user args (post settings-merge, post thinking-display);
 *   used for synonymous-flag suppression of injected entries
 * @param {object} [p.env] — process env of the launch (model resolution + opt-out checks)
 * @param {object|null} [p.launchSettings] — merged --settings object (model resolution signal)
 * @param {object|null|undefined} [p.resume] — explicit resume intent {resumeValue, picker, fork};
 *   `undefined` parses from extraArgs (PTY path); explicit null forces the fresh pipeline
 * @param {function} [p.modelReader] — (spawnDir, env, {launchSettings}) => modelId|null
 * @param {boolean} [p.insideLogDir] — IM-worker spawns skip the whole pin/match machinery
 * @param {string} [p.logDir]
 * @param {boolean} [p.suppressInjection] — caller-side suppression (PTY: rejected-binary
 *   set / skip-once token). Zeroes the injection and drops the pending record.
 * @param {boolean} [p.persistPending] — record the effective injection for the wire-side
 *   binding (v2-writer Bind A). PTY passes true; SDK also passes true (its wire traffic
 *   flows through the same proxy). Set false only for dry-run callers.
 * @returns {{
 *   sysPrompt: {args: string[], loaded: string[], model: string|null, entries: object[], suppressed?: string, pinned?: boolean, noRecord?: boolean, noRecordNotice?: boolean},
 *   resume: object|null,
 *   resolvedModelId: string|null,
 *   diagnostic: null|'no-match'|'no-model'|'builtin-disabled',
 * }}
 */
export function resolveLaunchSystemPrompt(p) {
  const {
    spawnDir,
    extraArgs,
    env = process.env,
    launchSettings = null,
    resume: resumeIntent,
    modelReader = _defaultModelReader,
    insideLogDir = false,
    logDir = LOG_DIR,
    suppressInjection = false,
    persistPending = true,
  } = p;

  const out = {
    sysPrompt: { args: [], loaded: [], model: null, entries: [] },
    resume: null,
    resolvedModelId: null,
    diagnostic: null,
  };
  // The variable set collected while rendering this launch's injected files (if any).
  // Captured via the render seam below and published to the live layer so a later hot
  // model switch re-renders with THIS launch's variables — never by spawning git in
  // the fetch hook. Stays null when nothing was injected or no file had `${...}`.
  let collectedVariables = null;
  if (!spawnDir) {
    // 复位 live 启动判定：早退不得把上一次 launch 的注入状态泄漏给这次
    // （什么都没注入的 launch 必须关闭 live 改写门）。
    try { setLaunchSystemPromptInfo(null); } catch (err) { reportSwallowed('launch-config.publishLiveInfo', err); }
    return out;
  }

  // Continuation launches (-c/--continue/-r/--resume): pin the resumed conversation's
  // original injection — never re-render variables. IM workers (insideLogDir) skip the
  // whole snapshot machinery: their persona file must be re-read on every launch.
  const resume = insideLogDir ? null : (resumeIntent !== undefined ? resumeIntent : parseResumeArgs(extraArgs));
  out.resume = resume;
  let pendingRec = null;
  let pinned = null;
  if (resume && env.CCV_DISABLE_AUTO_SYSTEM_PROMPT !== '1') {
    const targetUuid = resume.resumeValue ?? resolveContinueTargetUuid(spawnDir);
    if (targetUuid) {
      const snap = readSnapshot(spawnDir, targetUuid);
      if (snap) {
        // Manual-flag suppression BEFORE materialize (suppressed entries never hit disk).
        const kept = suppressManuallyFlaggedPinned(snap.entries, extraArgs);
        const m = materializePinnedEntries(kept);
        pinned = { args: m.args, loaded: m.loaded, model: snap.model, entries: m.entries, pinned: true };
        // The pending carries the SNAPSHOT's entries (post-suppression), not the
        // materialized subset — a transient temp-write failure must not degrade the
        // permanent record via Bind B.
        pendingRec = { entries: kept, model: snap.model, resumeExpected: true, resolvedUuid: targetUuid, fork: resume.fork };
      } else {
        // F2: target identified but no snapshot → inject NOTHING this launch (never
        // alter the system text an existing context already has).
        pinned = { args: [], loaded: [], model: null, entries: [], pinned: true, noRecord: true, noRecordNotice: injectionConfigured(spawnDir, logDir) };
      }
    }
    // Bare -r (picker): the target is unknowable at spawn → normal pipeline, and NO
    // pending. -c with no transcripts (targetUuid null): claude fails and the caller's
    // retry respawns without -c — treat as fresh below.
  }

  if (pinned) {
    out.sysPrompt = pinned;
    // resolvedModelId 仅在 fresh 分支产出（modelReader 的真模型 id）。pinned 分支的
    // snap.model 是「条目名」（OPUS/KIMI-K3 大写 stem；sentinel 为 null），不是 wire
    // 模型 id —— 置 null，live seed 由 pinned:true 走「无条件 seed 自 pin 字节」，
    // 保证 resume pin 不被强行覆盖（snap.model 与 _targetModel 用 === 永不命中，
    // 误当模型 id 会让 seed 死掉、第 2 请求被重选覆盖 pin）。
    out.resolvedModelId = null;
  } else {
    // launchSettings is this launch's own live configuration — launchers like cfuse
    // deliver ANTHROPIC_MODEL exclusively inside it, so it must participate in model
    // resolution or model-specific entries silently never match.
    const resolvedModelId = insideLogDir ? null : modelReader(spawnDir, env, { launchSettings });
    out.resolvedModelId = resolvedModelId;
    let sysPrompt = buildSystemPromptFileArgs(spawnDir, extraArgs, env, {
      modelId: resolvedModelId,
      globalModelDir: join(logDir, MODEL_PROMPT_DIR),
    });
    if (suppressInjection) {
      sysPrompt = { args: [], loaded: [], model: null, entries: [] };
    } else if (sysPrompt.builtinDisabled) {
      // The resolved model hit a built-in preset that the user tombstone-disabled —
      // distinct from 'no-match' (a likely misnamed file): this is an intentional opt-out.
      out.diagnostic = 'builtin-disabled';
    } else if (resolvedModelId && !sysPrompt.model && !sysPrompt.suppressed
      && (existsSync(join(spawnDir, MODEL_PROMPT_DIR)) || existsSync(join(logDir, MODEL_PROMPT_DIR)))) {
      // A system_prompt dir is configured but the resolved model matched no entry
      // (likely a misnamed file).
      out.diagnostic = 'no-match';
    } else if (!resolvedModelId && !sysPrompt.suppressed && !insideLogDir
      && (listModelPrompts(join(spawnDir, MODEL_PROMPT_DIR)).length > 0
        || listModelPrompts(join(logDir, MODEL_PROMPT_DIR)).length > 0)) {
      // Entries exist but NO model signal resolved at all, so matching never ran.
      out.diagnostic = 'no-model';
    }
    // Resolve `${...}` template variables in the injected files. Skipped entirely when
    // suppression zeroed the args (a rejected binary never pays the render cost).
    // The collected variable set is captured (below) and published to the live layer
    // so a later hot model switch re-renders with THIS launch's variables — never by
    // spawning git inside the fetch hook. The render seam is lazy: it only fires when
    // some injected file actually contains `${...}`, so a no-template launch collects
    // nothing and collectedVariables stays null.
    if (sysPrompt.args.length > 0) {
      sysPrompt = renderSystemPromptFileArgs(sysPrompt, {
        cwd: spawnDir,
        modelId: resolvedModelId,
        variablesFactory: (overrides, opts) => {
          const variables = createSystemPromptVariables(overrides, opts);
          collectedVariables = variables;
          return variables;
        },
      });
    } else {
      sysPrompt = { ...sysPrompt, entries: [] };
    }
    out.sysPrompt = sysPrompt;
  }

  // Unified suppression (pin and fresh alike): nothing was injected → nothing can be bound.
  if (suppressInjection) {
    out.sysPrompt = { args: [], loaded: [], model: null, entries: [] };
    pendingRec = null;
  }

  // Record this launch's effective injection for the binding channels (wire Bind A /
  // SessionStart Bind B). Empty pendings are never queued (see pty-manager history).
  const effectiveEntries = (out.sysPrompt.entries || []).filter(e => e && !e.unavailable);
  if (pendingRec && pendingRec.entries.length === 0) pendingRec = null;
  const rec = pendingRec || (!resume && !pinned && effectiveEntries.length > 0
    ? { entries: effectiveEntries, model: out.sysPrompt.model ?? null, resumeExpected: false, resolvedUuid: null, fork: false }
    : null);
  if (persistPending && rec) {
    try { appendPending(spawnDir, rec, logDir); } catch (err) { reportSwallowed('launch-config.appendPending', err); }
  }
  out.pendingRec = rec;

  // 发布启动判定给 live 层（system-prompt-live.js）。强行覆盖模式：以热切换选中的
  // 模型为准，只要该模型有对应 system 文本就注入/替换（含启动未注入的情况）。
  // manualSystemPrompt：用户手动传了 --system-prompt（任意文本）或 --system-prompt-file
  // 且其值不是 ccv 本次注入的路径 —— 此类会话绝不被热切换覆盖（手动优先；用户说的
  // 手动是字面 flag，不含 ccv 启动阶段写入的那份）。
  const _injectedSysPath = (() => {
    const a = out.sysPrompt.args || [];
    for (let i = 0; i + 1 < a.length; i++) {
      if (a[i] === '--system-prompt-file') return a[i + 1];
    }
    return null;
  })();
  // ccv 本次注入的 --append-system-prompt-file 路径（同款识别，排除「手动 vs 注入」误判）
  const _injectedAppendPath = (() => {
    const a = out.sysPrompt.args || [];
    for (let i = 0; i + 1 < a.length; i++) {
      if (a[i] === '--append-system-prompt-file') return a[i + 1];
    }
    return null;
  })();
  const _manualSys =
    hasArg(extraArgs, '--system-prompt') ||
    (() => { const v = argValue(extraArgs, '--system-prompt-file'); return v !== null && v !== _injectedSysPath; })();
  // 手动优先同样覆盖 append 两族：用户手传 --append-system-prompt[-file] 时启动期按
  // 「手动优先」跳过 ccv 注入（buildSystemPromptFileArgs:148），live 层不得在请求时回补
  // —— 同一条规则启动期生效、live 层绕过是不一致的。任一手动 flag → 关闭 live 门。
  const _manualAppendSys =
    hasArg(extraArgs, '--append-system-prompt') ||
    (() => { const v = argValue(extraArgs, '--append-system-prompt-file'); return v !== null && v !== _injectedAppendPath; })();
  try {
    setLaunchSystemPromptInfo({
      workspaceDir: spawnDir,
      resolvedModelId: out.resolvedModelId,
      entries: effectiveEntries,
      pinned: !!pinned,
      // suppressInjection（二进制拒绝 flag 自愈 / IM 去注入重启）必须有对应 suppressed，
      // 否则 live 门会被击穿、把启动期明确不要的注入在请求时回补。
      suppressed: suppressInjection ? 'suppressInjection' : (out.sysPrompt.suppressed ?? null),
      manualSystemPrompt: _manualSys || _manualAppendSys,
      // IM worker（spawnDir 在 LOG_DIR 内）persona 绝不被全局模型条目替换 → 拒绝 live 覆盖。
      // F2 resume（pinned.noRecord：目标已识别但无快照）语义是「本次启动不注入任何东西，
      // 绝不改动既有上下文的 system」→ 同样拒绝 live 覆盖（否则 resume 会话被强行注入）。
      allowLive: !insideLogDir && !(pinned && pinned.noRecord === true),
      // 本次启动收集到的变量集（含 git/os/env/memory…；live 层只缓存其快照部分）。
      // 热切换渲染复用它,绝不在 fetch hook 同步段跑 git。无注入/无 ${...} → null。
      variableSnapshot: collectedVariables,
    });
  } catch (err) { reportSwallowed('launch-config.publishLiveInfo', err); }
  return out;
}

/**
 * Convert a flat launch-args array (['--system-prompt-file', path, ...]) into the SDK
 * query() options.extraArgs shape ({ 'system-prompt-file': path, ... }). Boolean flags
 * (no value) map to null. Unknown pairing (trailing flag) maps to null — the SDK
 * appends it bare, mirroring claude argv semantics.
 */
export function launchArgsToExtraArgs(args) {
  const out = {};
  if (!Array.isArray(args)) return out;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || !a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = args[i + 1];
    if (typeof next === 'string' && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = null;
  }
  return out;
}

/**
 * Split user CLI args for the SDK link: flags with SDK-native options are lifted out
 * (--model / -c / --continue / -r / --resume / --fork-session — also needed at the
 * sdk-manager level for resume-pin semantics); everything else rides along in `rest`
 * (later converted to options.extraArgs verbatim). A valueless `-r` (interactive
 * picker) can't work headless — reported via `pickerResume` so the caller can warn.
 */
export function splitSdkLaunchArgs(args) {
  const out = { model: null, continue: false, resume: null, forkSession: false, pickerResume: false, rest: [] };
  if (!Array.isArray(args)) return out;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string') { out.rest.push(a); continue; }
    if (a === '-c' || a === '--continue') { out.continue = true; continue; }
    if (a === '--fork-session') { out.forkSession = true; continue; }
    if (a === '-r' || a === '--resume') {
      const next = args[i + 1];
      if (typeof next === 'string' && next && !next.startsWith('-')) { out.resume = next; i++; }
      else out.pickerResume = true;
      continue;
    }
    let m = a.match(/^(?:-r|--resume)=(.+)$/);
    if (m) { out.resume = m[1]; continue; }
    m = a.match(/^--model=(.+)$/);
    if (m) { out.model = m[1]; continue; }
    if (a === '--model') {
      const next = args[i + 1];
      if (typeof next === 'string' && next && !next.startsWith('-')) { out.model = next; i++; continue; }
      out.rest.push(a); continue; // valueless --model: pass through, claude surfaces its own usage error
    }
    out.rest.push(a);
  }
  return out;
}
