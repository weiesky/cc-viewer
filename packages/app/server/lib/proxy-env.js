import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// 纯函数，从 env 中解析代理配置（可独立测试）
export function resolveProxyConfig(env = process.env) {
  const allProxy = env.all_proxy || env.ALL_PROXY;
  return {
    httpProxy: env.http_proxy || env.HTTP_PROXY || allProxy || undefined,
    httpsProxy: env.https_proxy || env.HTTPS_PROXY || allProxy || undefined,
    noProxy: env.no_proxy || env.NO_PROXY || undefined,
  };
}

// 关键坑位（Node 26 起的回归）：代理转发上游用的是 Node 内置全局 fetch，背后是 Node 自带的
// 那份 undici。Node ≤25 时它与 userland undici 包共享同一个 global dispatcher（Symbol.for
// 同键），所以单调 setGlobalDispatcher 也能让转发请求走代理——这也是为何旧代码一直好用。
// 实测 Node 26 起两份 undici 不再共享 global dispatcher，单靠 setGlobalDispatcher，转发请求
// 读不到 http_proxy/https_proxy，会直连 api.anthropic.com 绕过用户的网络代理。
// 解法：把这里构造的 EnvHttpProxyAgent 显式保存下来，由 proxy 转发处作为 fetch 的 dispatcher
// 选项传入（内置 fetch 接受 userland undici 的 dispatcher 实例，各 Node 版本通用）。
let _proxyDispatcher = null;

export function setupProxyEnv() {
  const { httpProxy, httpsProxy, noProxy } = resolveProxyConfig();
  if (!httpProxy && !httpsProxy) return;

  _proxyDispatcher = new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy });
  setGlobalDispatcher(_proxyDispatcher); // 仍保留：覆盖直接 import 'undici' 的 fetch 调用路径
  if (process.env.CCV_DEBUG) {
    console.error(`[CC Viewer] HTTP proxy: http=${httpProxy || '(none)'}, https=${httpsProxy || '(none)'}${noProxy ? `, no_proxy=${noProxy}` : ''}`);
  }
}

// 返回供"内置全局 fetch"使用的代理 dispatcher；无代理配置时返回 null（调用方不传即直连）。
export function getProxyDispatcher() {
  return _proxyDispatcher;
}

setupProxyEnv();
