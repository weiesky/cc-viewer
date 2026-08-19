// 从 URL 中提取 LAN 访问 token，附加到所有 API 请求 / WebSocket 握手
const _urlToken = new URLSearchParams(window.location.search).get('token');

// 反向代理子路径部署: 从 <base> 标签或 SSR 注入的全局变量读取 base path，
// 使 API/WebSocket 等动态请求也能正确路由到代理后端。
export function getBasePath() {
  if (typeof window !== 'undefined' && window.__CCV_BASE_PATH__) return window.__CCV_BASE_PATH__;
  if (typeof document === 'undefined' || !document.querySelector) return '';
  const base = document.querySelector('base');
  if (base && base.href) return base.getAttribute('href');
  return '';
}

// 把 token 追加到任意 URL（HTTP path 或 ws:// 完整 URL 皆可）。无 token 时原样返回。
// WS 握手必须也带 token —— 否则启用鉴权后远程「?token=」终端会被 socket.destroy()。
export function appendToken(url) {
  if (!_urlToken) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${_urlToken}`;
}

export function apiUrl(path) {
  const base = getBasePath();
  const fullPath = base ? base.replace(/\/$/, '') + path : path;
  return appendToken(fullPath);
}
