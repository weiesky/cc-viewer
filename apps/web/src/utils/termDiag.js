/**
 * termDiag —— 终端渲染管线最小可观测性（Windows 卡死排查回报通道）。
 *
 * 纯本地、仅数值计数器/水位，不含任何命令内容、无任何上报。
 * 使用方式（用户侧）：
 *   - 控制台执行 `__ccvTermDiag()` 获取快照；
 *   - `localStorage.ccv_term_diag = '1'` 后每 5s console.warn 一行
 *     `[ccv-diag] {...}`（沿既有 [cc-viewer] 英文诊断日志惯例，非 UI 文案，
 *     不走 i18n）。
 *
 * 指标：
 *   trimCount        writeQueue 积压丢弃次数（2MB 高水位触发）
 *   resyncCount      服务端 data-resync 次数（behind→resume 振荡的标尺）
 *   longtaskCount    主线程 ≥50ms 长任务数（PerformanceObserver，仅计数不降级）
 *   writeQPendingBytes / chunkSize / cbLatencyEwma   喂入闭环水位（P2 自适应接线）
 *   detect*          promptDetect 耗时统计（>50ms 计 overrun——仅监测计数，无熔断降级）
 *
 * 纯 JS、浏览器 API 全部能力守卫（node:test 可直接 import 测纯逻辑）。
 */
import { getPromptDetectStats } from './promptDetect.js';

const counters = {
  trimCount: 0,
  resyncCount: 0,
  longtaskCount: 0,
};

const gauges = {
  writeQPendingBytes: 0,
  chunkSize: 0,
  cbLatencyEwma: 0,
};

export function diagCount(name, n = 1) {
  if (typeof counters[name] === 'number') counters[name] += n;
}

export function diagSet(name, value) {
  if (typeof gauges[name] === 'number' && typeof value === 'number') gauges[name] = value;
}

/** 指数加权滑动平均（alpha 默认 0.2），返回更新后的值 */
export function diagEwma(name, sample, alpha = 0.2) {
  if (typeof gauges[name] !== 'number' || typeof sample !== 'number') return 0;
  gauges[name] = gauges[name] === 0 ? sample : gauges[name] * (1 - alpha) + sample * alpha;
  return gauges[name];
}

export function getTermDiagSnapshot() {
  const detect = getPromptDetectStats();
  return {
    ...counters,
    writeQPendingBytes: Math.round(gauges.writeQPendingBytes),
    chunkSize: Math.round(gauges.chunkSize),
    cbLatencyEwma: Math.round(gauges.cbLatencyEwma * 10) / 10,
    detectCalls: detect.calls,
    detectLastMs: Math.round(detect.lastMs * 10) / 10,
    detectMaxMs: Math.round(detect.maxMs * 10) / 10,
    detectOverruns: detect.overruns,
  };
}

/** 仅测试用：清零本模块计数（promptDetect 的统计不归此处管） */
export function _resetTermDiagForTest() {
  for (const k of Object.keys(counters)) counters[k] = 0;
  for (const k of Object.keys(gauges)) gauges[k] = 0;
}

let _installed = false;
let _logTimer = null;
let _ltObserver = null;

/**
 * 浏览器侧安装（幂等）：window.__ccvTermDiag + longtask 计数 + 可选周期日志。
 * 在 node 环境（无 window）下为 no-op。
 */
export function installTermDiag() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  window.__ccvTermDiag = getTermDiagSnapshot;

  // 长任务仅计数不降级（与 TerminalPanel WebGL 守卫的能力检测同模式）
  try {
    if (typeof PerformanceObserver !== 'undefined'
        && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      _ltObserver = new PerformanceObserver((list) => {
        diagCount('longtaskCount', list.getEntries().length);
      });
      _ltObserver.observe({ entryTypes: ['longtask'] });
    }
  } catch {}

  // 周期日志：localStorage 开关，运行期改动即时生效（每 tick 重查）
  try {
    _logTimer = setInterval(() => {
      try {
        if (localStorage.getItem('ccv_term_diag') === '1') {
          console.warn('[ccv-diag] ' + JSON.stringify(getTermDiagSnapshot()));
        }
      } catch {}
    }, 5000);
  } catch {}
}

/** 仅测试/热重载用：卸载 observer 与定时器 */
export function uninstallTermDiag() {
  if (_ltObserver) { try { _ltObserver.disconnect(); } catch {} _ltObserver = null; }
  if (_logTimer) { clearInterval(_logTimer); _logTimer = null; }
  if (typeof window !== 'undefined' && window.__ccvTermDiag === getTermDiagSnapshot) {
    try { delete window.__ccvTermDiag; } catch {}
  }
  _installed = false;
}
