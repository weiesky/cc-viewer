import React from 'react';

/**
 * 刷新缓存的 assistant ChatMessage element 上随 ChatView `_sessionItemCache` FULL HIT 而冻结的
 * 过期 map prop。仅对「持有指定 toolName 的 tool_use」的 element 做 cloneElement 注入 nextMap，
 * 其余原样返回；prevMap===nextMap 时返回原数组（零分配）。
 *
 * 背景：FULL HIT 路径直接返回 `sc.items` 时 React reconciler 看到完全相同的 element 引用就跳过
 * diff，ChatMessage SCU 根本不会被调用，元素创建时冻结的旧 map（planApprovalMap / askAnswerMap）
 * 永不刷新——导致 ExitPlanMode 审批后卡片不切「已批准」、AskUserQuestion 答完后仍显示 pending。
 * 本函数合并自原 refreshPlanApprovalCache / refreshAskAnswerCache 两个孪生模块。
 *
 * @param {Array} items - 缓存的 ChatMessage React element 数组
 * @param {object} prevMap - 上一轮存入 cache 时的 map 引用
 * @param {object} nextMap - 本轮派生的 map 引用
 * @param {string} toolName - 触发刷新的 tool_use 名（'ExitPlanMode' / 'AskUserQuestion'）
 * @param {string} propName - 要刷新的 prop 名（'planApprovalMap' / 'askAnswerMap'）
 * @returns {Array} 引用全等时为 items；否则为新数组（仅命中者被 cloneElement）
 */
export function refreshCachedItemProp(items, prevMap, nextMap, toolName, propName) {
  if (prevMap === nextMap) return items;
  let dirty = false;
  const out = items.map(m => {
    if (!m || !m.props || m.props.role !== 'assistant' || !Array.isArray(m.props.content)) return m;
    if (!m.props.content.some(b => b.type === 'tool_use' && b.name === toolName)) return m;
    dirty = true;
    return React.cloneElement(m, { [propName]: nextMap });
  });
  return dirty ? out : items;
}
