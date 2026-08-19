// UltraPlan「专家」列表的纯逻辑：把内置专家(codeExpert / researchExpert)与用户自定义专家
// (customUltraplanExperts)合成一份「有序 + 可显隐」的统一列表，供 PC popover、移动端弹窗、
// 以及「管理专家」弹窗共用同一份真源。无 React / antd / i18n 依赖，可直接在 node:test 下 import。
//
// 变体键(key)约定(与发送侧 TerminalPanel 的解析一致，保持稳定)：
//   · 内置：'codeExpert' / 'researchExpert'
//   · 自定义：'custom:' + item.id
//
// 持久化(preferences.json)：
//   · ultraplanExpertOrder: string[]  —— 全量有序键;缺省=自然序。
//   · ultraplanExpertHidden: string[] —— 被隐藏的键;缺省=全部可见。
// 二者都按「当前 customExperts」重算：指向已删除自定义专家的陈旧键一律忽略，绝不抛错。

// 内置专家键，固定排在自然序最前。
export const BUILTIN_EXPERT_KEYS = ['codeExpert', 'researchExpert'];

function safeCustomList(customExperts) {
  return Array.isArray(customExperts) ? customExperts.filter(e => e && e.id != null) : [];
}

// 自然序：内置在前，自定义按其数组顺序在后。
export function naturalExpertKeys(customExperts) {
  return [
    ...BUILTIN_EXPERT_KEYS,
    ...safeCustomList(customExperts).map(e => 'custom:' + e.id),
  ];
}

// 有效有序键：先取 order 中「仍存在」的键(去重)，再把剩余自然序键追加到末尾。
// → 新建/未知键自动落到末尾;order 里的陈旧键被过滤。
export function orderedExpertKeys(customExperts, order) {
  const natural = naturalExpertKeys(customExperts);
  const naturalSet = new Set(natural);
  const seen = new Set();
  const known = [];
  for (const k of Array.isArray(order) ? order : []) {
    if (naturalSet.has(k) && !seen.has(k)) { seen.add(k); known.push(k); }
  }
  for (const k of natural) {
    if (!seen.has(k)) { seen.add(k); known.push(k); }
  }
  return known;
}

// 有序描述符列表，供渲染：{ key, kind:'builtin'|'custom', item|null, hidden:boolean }。
export function buildExpertList(customExperts, order, hidden) {
  const hiddenSet = new Set(Array.isArray(hidden) ? hidden : []);
  const byKey = new Map(safeCustomList(customExperts).map(e => ['custom:' + e.id, e]));
  return orderedExpertKeys(customExperts, order).map(key => {
    const kind = key.startsWith('custom:') ? 'custom' : 'builtin';
    return {
      key,
      kind,
      item: kind === 'custom' ? (byKey.get(key) || null) : null,
      hidden: hiddenSet.has(key),
    };
  });
}

// 可见键(过滤掉 hidden 的有序键)，即真正出现在 tab 条上的专家。
export function visibleExpertKeys(customExperts, order, hidden) {
  return buildExpertList(customExperts, order, hidden)
    .filter(d => !d.hidden)
    .map(d => d.key);
}

// 拖拽排序：把 keys[from] 移动到「落点行」下标 to 之前，返回新数组(纯函数,不改原数组)。
// to 是被拖到其位置那一行的当前下标；移除 from 后右侧整体左移一位，故 from<to 时落点修正为 to-1。
// from === to / 越界 / from==null 视为无变化，返回原数组的拷贝。
export function reorderKeys(keys, from, to) {
  const arr = Array.isArray(keys) ? [...keys] : [];
  if (from == null || to == null || from < 0 || from >= arr.length || from === to) return arr;
  const [moved] = arr.splice(from, 1);
  arr.splice(from < to ? to - 1 : to, 0, moved);
  return arr;
}

// 当前可见(未隐藏)专家数。list = buildExpertList(...) 的结果。
export function countVisible(list) {
  return (Array.isArray(list) ? list : []).filter(d => d && !d.hidden).length;
}

// 是否还能再隐藏一个：隐藏后仍至少保留 1 个可见专家才允许(管理弹窗护栏)。
export function canHideOne(list) {
  return countVisible(list) > 1;
}
