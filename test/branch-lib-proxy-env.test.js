import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalDispatcher, setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

// 目标模块在 import 期会执行一次 setupProxyEnv()（读真实 process.env），
// 这里用动态 import 加载，随后通过直接调用 setupProxyEnv 并改写 process.env
// 来覆盖各条件分支（no-proxy return / CCV_DEBUG 输出 / 三元的两臂）。
let mod;

// 这些 env 键都会被 resolveProxyConfig 读取；测试前后必须完整快照/还原，
// 避免污染同进程其它用例（运行环境本身可能带 HTTP_PROXY）。
const PROXY_KEYS = [
  'http_proxy', 'HTTP_PROXY',
  'https_proxy', 'HTTPS_PROXY',
  'all_proxy', 'ALL_PROXY',
  'no_proxy', 'NO_PROXY',
  'CCV_DEBUG',
];

const saved = {};
let savedGlobal;

function clearProxyEnv() {
  for (const k of PROXY_KEYS) delete process.env[k];
}

before(async () => {
  mod = await import('../packages/app/server/lib/proxy-env.js');
  savedGlobal = getGlobalDispatcher();
  for (const k of PROXY_KEYS) saved[k] = process.env[k];
});

after(() => {
  // 还原全部 env 与全局 dispatcher
  for (const k of PROXY_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setGlobalDispatcher(savedGlobal);
});

describe('setupProxyEnv 分支覆盖', () => {
  // 每个用例前清空代理 env，保证 setupProxyEnv 读到的是用例自定的环境
  afterEach(() => {
    clearProxyEnv();
    setGlobalDispatcher(savedGlobal);
  });

  it('无任何代理变量时提前 return，不创建 dispatcher', () => {
    clearProxyEnv();
    // 先放一个已知 dispatcher，确认 setupProxyEnv 在 no-proxy 时不会覆盖它
    const sentinel = getGlobalDispatcher();
    mod.setupProxyEnv();
    // no-proxy 路径下 setGlobalDispatcher 不被调用，全局仍是 sentinel
    assert.equal(getGlobalDispatcher(), sentinel);
  });

  it('仅 https_proxy 设置（!httpProxy && httpsProxy）也会建立 dispatcher', () => {
    clearProxyEnv();
    process.env.https_proxy = 'http://127.0.0.1:39991';
    mod.setupProxyEnv();
    assert.ok(mod.getProxyDispatcher() instanceof EnvHttpProxyAgent);
  });

  it('仅 http_proxy 设置（httpProxy && !httpsProxy）也会建立 dispatcher', () => {
    clearProxyEnv();
    process.env.http_proxy = 'http://127.0.0.1:39992';
    mod.setupProxyEnv();
    assert.ok(mod.getProxyDispatcher() instanceof EnvHttpProxyAgent);
  });
});

describe('setupProxyEnv 的 CCV_DEBUG 调试输出分支', () => {
  let errLines;
  let origError;

  before(() => {
    origError = console.error;
  });

  function captureConsole() {
    errLines = [];
    console.error = (...a) => { errLines.push(a.join(' ')); };
  }

  afterEach(() => {
    console.error = origError;
    clearProxyEnv();
    setGlobalDispatcher(savedGlobal);
  });

  it('CCV_DEBUG 开启 + 有 http/https/no_proxy：打印含全部值的调试行（三元真臂）', () => {
    clearProxyEnv();
    process.env.http_proxy = 'http://127.0.0.1:39993';
    process.env.https_proxy = 'http://127.0.0.1:39994';
    process.env.no_proxy = 'localhost,127.0.0.1';
    process.env.CCV_DEBUG = '1';
    captureConsole();
    mod.setupProxyEnv();
    assert.equal(errLines.length, 1);
    const line = errLines[0];
    assert.ok(line.includes('http=http://127.0.0.1:39993'));
    assert.ok(line.includes('https=http://127.0.0.1:39994'));
    // noProxy 真臂：输出 no_proxy=...
    assert.ok(line.includes('no_proxy=localhost,127.0.0.1'));
  });

  it('CCV_DEBUG 开启 + 仅 http_proxy，无 no_proxy：https 走 (none)、noProxy 三元假臂', () => {
    clearProxyEnv();
    process.env.http_proxy = 'http://127.0.0.1:39995';
    // 不设 https_proxy / no_proxy
    process.env.CCV_DEBUG = '1';
    captureConsole();
    mod.setupProxyEnv();
    assert.equal(errLines.length, 1);
    const line = errLines[0];
    assert.ok(line.includes('http=http://127.0.0.1:39995'));
    // httpsProxy 为空 -> (none) 假臂
    assert.ok(line.includes('https=(none)'));
    // 无 no_proxy -> 三元假臂，输出空串，不含 no_proxy=
    assert.ok(!line.includes('no_proxy='));
  });

  it('CCV_DEBUG 开启 + 仅 https_proxy：http 走 (none) 假臂', () => {
    clearProxyEnv();
    process.env.https_proxy = 'http://127.0.0.1:39996';
    process.env.CCV_DEBUG = '1';
    captureConsole();
    mod.setupProxyEnv();
    assert.equal(errLines.length, 1);
    const line = errLines[0];
    // httpProxy 为空 -> (none) 假臂
    assert.ok(line.includes('http=(none)'));
    assert.ok(line.includes('https=http://127.0.0.1:39996'));
  });

  it('CCV_DEBUG 未开启 + 有代理：不打印调试行（if 假臂）', () => {
    clearProxyEnv();
    process.env.http_proxy = 'http://127.0.0.1:39997';
    // 不设 CCV_DEBUG
    captureConsole();
    mod.setupProxyEnv();
    assert.equal(errLines.length, 0);
  });
});
