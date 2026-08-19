// 把「纯字符串 或 {lang: str} 本地化对象」解析成当前语言下的字符串。
// 用于 ultraAgents 预设专家的 title / description：服务端原样下发本地化对象，
// 前端按 getLang() 解析，语言切换无需重新请求。(content 是单语言字符串，不走本处。)
//
// 回退顺序：精确语言 → 去区域后的主语言(zh-TW→zh, pt-BR→pt) → en → zh → 首个非空字符串值。
// 异常输入（数组 / 数字 / null / 空对象 / 全空串对象）一律安全返回 ''，绝不抛错。
export function resolveLocalized(field, lang) {
  if (typeof field === 'string') return field;
  if (!field || typeof field !== 'object' || Array.isArray(field)) return '';
  const pick = (k) => (typeof field[k] === 'string' && field[k].trim() ? field[k] : null);
  const base = typeof lang === 'string' ? lang.split('-')[0] : '';
  return pick(lang)
    || pick(base)
    || pick('en')
    || pick('zh')
    || (Object.values(field).find(v => typeof v === 'string' && v.trim()) || '');
}
