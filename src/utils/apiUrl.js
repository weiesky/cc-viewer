// 从 URL 中提取 LAN 访问 token，附加到所有 API 请求
const _urlToken = new URLSearchParams(window.location.search).get('token');

export function apiUrl(path) {
  if (!_urlToken) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${_urlToken}`;
}
