// Miscellaneous small routes (moved verbatim from server.js handleRequest).
import { getUserProfile } from '../lib/user-profile.js';
import { runWaterfallHook } from '../lib/plugin-loader.js';
import { normalizeBasePath } from '../lib/base-path.js';

async function userProfile(req, res) {
  const profile = await getUserProfile();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(profile));
}

async function localUrl(req, res, parsedUrl, isLocal, deps) {
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
