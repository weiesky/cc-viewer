// Miscellaneous small routes (moved verbatim from server.js handleRequest).
import { getUserProfile } from '../lib/user-profile.js';
import { runWaterfallHook } from '../lib/plugin-loader.js';
import { normalizeBasePath } from '../lib/base-path.js';
import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';

async function userProfile(req, res) {
  const profile = await getUserProfile();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(profile));
}

async function localUrl(req, res, parsedUrl, isLocal, deps) {
  // The response embeds the full ACCESS_TOKEN. Without this gate the permissive global
  // CORS prelude would let any cross-site page read the token from a loopback server
  // (loopback skips auth) and then bypass every Origin/admin check end-to-end.
  // CLI/native clients (no Origin header) and same-origin admin pages stay allowed.
  if (!isAdminReq(req, isLocal) || !isSameOriginBrowserRequest(req, parsedUrl)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: admin and same-origin required' }));
    return;
  }
  const localIp = deps.getLocalIp();
  // 反代子路径部署时分享/二维码 URL 也要带前缀，否则扫码绕过代理直连源站端口（与
  // server.startedNetwork 启动打印保持一致）。未设 CCV_BASE_PATH 时为空串，行为不变。
  const basePath = normalizeBasePath(process.env.CCV_BASE_PATH);
  const defaultUrl = `${deps.protocol}://${localIp}:${deps.actualPort}${basePath}?token=${deps.ACCESS_TOKEN}`;
  const hookResult = await runWaterfallHook('localUrl', { url: defaultUrl, ip: localIp, port: deps.actualPort, token: deps.ACCESS_TOKEN });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ url: hookResult.url }));
}

export const miscRoutes = [
  { method: 'GET', match: 'exact', path: '/api/user-profile', handler: userProfile },
  { method: 'GET', match: 'exact', path: '/api/local-url', handler: localUrl },
];
