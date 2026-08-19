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
// slice(length - 1) 让 normalizedBase 的尾斜杠留作结果的前导斜杠：
//   stripBasePath('/proxy/api/x', '/proxy/') → '/api/x'
//   stripBasePath('/proxy/',      '/proxy/') → '/'
// 不匹配（含裸前缀 '/proxy' 无尾斜杠的访问）原样返回，由调用方按 SPA/404 处理。
export function stripBasePath(pathname, normalizedBase) {
  if (!normalizedBase || !pathname.startsWith(normalizedBase)) return pathname;
  return pathname.slice(normalizedBase.length - 1) || '/';
}
