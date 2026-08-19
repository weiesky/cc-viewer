// 汉堡菜单「钉住 → 快捷方式」的全局持久化（localStorage，跨项目共享）。
// 纯函数：parse / serialize / toggle；localStorage I/O 留在组件侧（AppHeader）。
// 存储值是一个菜单 key 字符串数组，顺序即用户钉住（pin）的先后顺序。

export const PINNED_KEY = 'ccv_pinnedMenuKeys';

// 解析 localStorage 原始字符串 → string[]。
// 任何异常（null / 非 JSON / 非数组）一律降级为 []，并过滤掉非字符串元素 + 去重。
export function parsePinned(raw) {
  if (typeof raw !== 'string' || raw === '') return [];
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (typeof item !== 'string' || item === '') continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// 序列化 string[] → 可写入 localStorage 的字符串。
export function serializePinned(arr) {
  return JSON.stringify(Array.isArray(arr) ? arr : []);
}

// 切换某个 key 的钉住状态：已存在则移除，不存在则追加到末尾（保持插入顺序）。
// 返回新数组（不修改入参）；顺带去重。
export function togglePinned(arr, key) {
  const list = parsePinnedArray(arr);
  if (typeof key !== 'string' || key === '') return list;
  if (list.includes(key)) return list.filter(k => k !== key);
  return [...list, key];
}

// 内部：把任意入参规整成「去重的字符串数组」，避免脏数据传播。
function parsePinnedArray(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (typeof item !== 'string' || item === '') continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
