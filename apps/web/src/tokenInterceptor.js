// Token 拦截器：自动为所有 API 请求附加 token
(function() {
  let token = null;

  // 从 URL 提取 token
  function extractToken() {
    if (token) return token;
    const params = new URLSearchParams(window.location.search);
    token = params.get('token') || '';
    return token;
  }

  // 为 URL 添加 token 参数
  function addToken(url) {
    const t = extractToken();
    if (!t) return url;

    // 处理相对路径
    if (url.startsWith('/')) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}token=${encodeURIComponent(t)}`;
    }

    // 处理完整 URL
    try {
      const urlObj = new URL(url);
      // 只为同源请求添加 token
      if (urlObj.origin === window.location.origin) {
        urlObj.searchParams.set('token', t);
        return urlObj.toString();
      }
    } catch {}

    return url;
  }

  // 拦截 fetch
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    return originalFetch(addToken(url), options);
  };

  // 拦截 EventSource
  const OriginalEventSource = window.EventSource;
  window.EventSource = function(url, config) {
    return new OriginalEventSource(addToken(url), config);
  };

  // 拦截 WebSocket
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    return new OriginalWebSocket(addToken(url), protocols);
  };
  // 保留静态常量（CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3）和原型链
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
})();
