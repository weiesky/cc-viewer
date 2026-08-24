// 内置模型页签的纯逻辑（SystemTextModal 与 ModelPromptTabs 共享，抽出让规则可单测：
// 双墓碑全清、shadowed 判定、有效禁用态合成都是「只存在于 UI 代码」的语义，服务端无对应约束）。
// Pure logic for built-in model prompt tabs (shared by SystemTextModal and ModelPromptTabs).

export const BUILTIN_SCOPE = 'builtin';

/**
 * 有效禁用态合成：workspace/global 任一墓碑命中即视为禁用（显示层口径；
 * per-scope 的禁用/启用操作按目标 scope 执行，见 builtinToggleScopes）。
 * Effective disabled state: tombstoned in either scope.
 *
 * @param {{ disabled?: { workspace?: boolean, global?: boolean } } | null | undefined} entry
 * @returns {boolean}
 */
export function isBuiltinEntryDisabled(entry) {
  return !!(entry && entry.disabled && (entry.disabled.workspace || entry.disabled.global));
}

/**
 * 物化/墓碑的目标作用域：用户选择 workspace 且有活动工作区时落 workspace，否则 global。
 * Target scope for materializing/tombstoning a built-in entry.
 *
 * @param {string|undefined} scopePref 用户在该页签上的选择（'global'|'workspace'）
 * @param {boolean} workspaceActive 是否有活动工作区
 * @returns {'global'|'workspace'}
 */
export function builtinTargetScope(scopePref, workspaceActive) {
  return scopePref === 'workspace' && workspaceActive ? 'workspace' : 'global';
}

/**
 * 禁用/启用切换的目标 scope 列表：
 * - 禁用 → [目标 scope]（向该 scope 写墓碑）；
 * - 启用 → 所有实际墓碑所在 scope（workspace/global 双墓碑一次全清）——
 *   否则跨会话后组件内存态的 scope 选择回落 global，workspace 墓碑永远无法经 UI 清除（死路）。
 * Scopes to POST for a disable/enable toggle. Enable clears every scope actually tombstoned.
 *
 * @param {{ disabled?: { workspace?: boolean, global?: boolean } } | null | undefined} entry
 * @param {boolean} nowDisabled 目标态（true=禁用，false=启用）
 * @param {string} targetScope 禁用方向的目标 scope
 * @returns {string[]} 需要 POST 的 scope 列表（可能为空 = 状态已一致）
 */
export function builtinToggleScopes(entry, nowDisabled, targetScope) {
  if (nowDisabled) return [targetScope];
  return ['workspace', 'global'].filter((s) => entry?.disabled?.[s]);
}

/**
 * shadowed 判定：物化目标 key 是否已被非内置条目占用（含会话内新建未持久化的页签）——
 * 防止「保存内置草稿」与「新建同名片签」两条并发 POST 打同一 scope:name 目标的覆盖竞态。
 * Whether the materialize target key is already taken by a non-built-in entry.
 *
 * @param {Array<{ name: string, scope: string }>} entries
 * @param {string} targetKey `${scope}:${name}`
 * @returns {boolean}
 */
export function isBuiltinShadowed(entries, targetKey) {
  if (!Array.isArray(entries)) return false;
  return entries.some((e) => e.scope !== BUILTIN_SCOPE && `${e.scope}:${e.name}` === targetKey);
}
