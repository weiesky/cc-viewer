/**
 * Tools diff —— 计算「当前请求 tools」相对「上一条 MainAgent 请求 tools」的新增/移除。
 *
 * 用于 ContextTab 的 tools 变化可视化(tools_search 等场景下 tools 列表逐请求变化)。
 * 抽成纯函数:① 让渲染逻辑变短;② 统一 added/removed 的统计口径(均按唯一 name 计数,
 * 不再 added 按数组、removed 按集合导致重名时口径不一致);③ 可独立单测。
 *
 * 约定:tool 按 name 比对(无 name 的 tool 不参与 diff);prevTools 非数组(无上一条 /
 * 当前请求非 MainAgent)时视为「无可比对基线」,hasPrev=false、不产生任何 added/removed。
 *
 * @param {Array|undefined|null} prevTools 上一条请求的 tools 数组(可空)
 * @param {Array|undefined|null} curTools  当前请求的 tools 数组
 * @returns {{
 *   hasPrev: boolean,            // 是否存在可比对基线
 *   isAdded: (name: string) => boolean, // 某 name 是否为相对上一条新增
 *   addedNames: string[],        // 新增的唯一 name 列表
 *   removedNames: string[],      // 移除的唯一 name 列表(上一条有、当前没有)
 *   addedCount: number,          // = addedNames.length
 *   removedCount: number,        // = removedNames.length
 *   changed: boolean,            // 是否有任何新增或移除
 * }}
 */
export function computeToolsDiff(prevTools, curTools) {
  const prevNameSet = Array.isArray(prevTools)
    ? new Set(prevTools.map(t => t?.name).filter(Boolean))
    : null;
  const curNameSet = new Set(
    (Array.isArray(curTools) ? curTools : []).map(t => t?.name).filter(Boolean),
  );

  const addedNames = prevNameSet ? [...curNameSet].filter(n => !prevNameSet.has(n)) : [];
  const removedNames = prevNameSet ? [...prevNameSet].filter(n => !curNameSet.has(n)) : [];

  return {
    hasPrev: prevNameSet != null,
    // 仅对有 name 且存在基线的 tool 判新增;无 name 无法按名比对,一律不标记
    isAdded: (name) => prevNameSet != null && !!name && !prevNameSet.has(name),
    addedNames,
    removedNames,
    addedCount: addedNames.length,
    removedCount: removedNames.length,
    changed: addedNames.length > 0 || removedNames.length > 0,
  };
}
