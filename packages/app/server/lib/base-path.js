// CCV_BASE_PATH（反向代理子路径部署）的统一 normalize / validate / strip。
// 纯函数，无副作用，server.js（HTTP 剥离 / <base> 注入 / WS upgrade）与 cli.js（启动 URL
// 打印）共用，消除各处复制粘贴的 normalize 逻辑。vite.config.js 不复用（构建期 base 有
// `undefined→'/'` 的三态语义，与运行时"未设=无前缀"不同，见该文件注释）。

// 规范化 basePath：未设 / 空串 / 根 '/' → ''（无前缀）；其余补尾斜杠（'/proxy' → '/proxy/'）。
// 尾斜杠是 startsWith 匹配的防歧义关键（'/proxy/' 不会误命中 '/proxyextra/x'）。
// 缺前导 '/' 的非法值（'proxy/x'）也返回 ''（忽略）——否则注入段会产出相对 <base> 破坏页面；
// 告警由 validateBasePath 在启动期负责。
export function normalizeBasePath(raw) {
  if (!raw || raw === '/' || !raw.startsWith('/')) return '';
  // 剥裸换行符：含 \n/\r 的值会把 index.html 注入的 JS 字符串断成语法错误（页面级 DoS）
  return raw.replace(/[\r\n]/g, '').replace(/\/?$/, '/');
}

// 校验 + 规范化。非空但缺前导 '/'（如 'proxy/x'）属配置错误：startsWith 永不命中、剥离
// 静默失效。不自动补 '/' —— 自动修正会掩盖与代理侧前缀的错配，更难排查；这里选择
// 忽略（按无前缀工作）并返回 i18n key 供启动期 console.warn。
export function validateBasePath(raw) {
  if (raw && raw !== '/' && !raw.startsWith('/')) {
    return { ok: false, normalized: '', warning: 'basePath.missingLeadingSlash' };
  }
  return { ok: true, normalized: normalizeBasePath(raw), warning: null };
}

// 从请求 pathname 剥掉 basePath 前缀，保证结果带前导 '/'（路由表按 '/api/...' 匹配）。
// slice(length - 1) 让匹配前缀的尾斜杠留作结果的前导斜杠：
//   stripBasePath('/proxy/api/x', '/proxy/') → '/api/x'
//   stripBasePath('/proxy/',      '/proxy/') → '/'
// 请求 pathname 一律经 new URL 序列化（safeParseRequestUrl / 浏览器均如此），字面前缀里的
// '{token}' 等字符在线格式下是 '%7Btoken%7D' —— 因此匹配用 wireBasePathVariants 的编码形式，
// 注入（<base>/window.__CCV_BASE_PATH__）仍用字面形式。不匹配原样返回，由调用方按 SPA/404 处理。
// 裸前缀（无尾斜杠，如 '/proxy' 或编码形式）按前缀根处理 → '/'：配合注入的 <base href>，
// 相对资源解析正确，分享链接少个尾斜杠不再白屏/404。精确相等判断，'/proxyextra' 不受误伤。

// 把字面 basePath 序列化为线格式（请求 pathname 形态）：new URL 会把 '{'/'}' 等 WHATWG
// path 字符百分号编码（'/session/{token}/' → '/session/%7Btoken%7D/'）。前缀剥离、插件
// cookie Path 等一切与"已解析请求路径"比较的场合都必须用这个形态；字面形态只用于
// <base href>/JS 注入。含 '?#' 的值会被 URL 解析吞掉尾斜杠（'/a?x/' → '/a'），这种配置
// 本就命不中任何请求——回退字面形式保持旧行为（永不误剥相邻路径）。
export function wireBasePath(normalizedBase) {
  if (!normalizedBase) return '';
  if (/[?#]/.test(normalizedBase)) return normalizedBase;
  try {
    const wire = new URL(`http://ccv-base${normalizedBase}`).pathname;
    // 尾斜杠是 startsWith 防歧义与 slice 前导斜杠语义的关键，丢失即回退（防御性）。
    return wire.endsWith('/') ? wire : normalizedBase;
  } catch {
    return normalizedBase;
  }
}

// 匹配候选：线格式 + 百分号编码大小写变体（有的代理会把 %7B 转小写为 %7b、或反向转大写，
// new URL 原样保留大小写，故两种形态都可能到达）。无编码时去重为单元素。
export function wireBasePathVariants(normalizedBase) {
  const wire = wireBasePath(normalizedBase);
  if (!wire) return [];
  const lower = wire.replace(/%([0-9A-Fa-f]{2})/g, (s) => s.toLowerCase());
  const upper = wire.replace(/%([0-9A-Fa-f]{2})/g, (s) => s.toUpperCase());
  return [...new Set([wire, lower, upper])];
}

export function stripBasePath(pathname, normalizedBase) {
  if (!normalizedBase) return pathname;
  for (const base of wireBasePathVariants(normalizedBase)) {
    if (pathname.startsWith(base)) return pathname.slice(base.length - 1) || '/';
    if (pathname === base.slice(0, -1)) return '/';
  }
  return pathname;
}
