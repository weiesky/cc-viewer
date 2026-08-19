// Windows Ctrl+C 退出链三层防御（macOS/Linux 行为不变）。
// 背景：cli.js / server.js 的 SIGINT handler 都是 `doCleanup → .finally(process.exit)` 形态，
// 注册 handler 后 Node 不再默认退出 —— 链上任何一环挂住（node-pty ConPTY kill 同步挂起、
// IM bridge teardown await 无超时、SIGINT 事件被 ConPTY 吞掉）进程就永不退出，
// 即 Windows 用户报告的 "Ctrl+C 完全无反应"。
// 三函数全部依赖注入（仿 log-watcher __setWatchFileImplForTests 惯例），纯逻辑可单测。

import { spawnSync as _spawnSync } from 'node:child_process';
import { emitKeypressEvents as _emitKeypressEvents } from 'node:readline';

// 把 `doCleanup → exit` 包装成幂等 + 双保险的 cleanup：
//   首次触发：先武装 watchdog（watchdogMs 后强制 exit(130)，unref 不滞留事件循环），
//             再 try/catch 跑 doCleanup（同步抛错不阻断退出），完成后 exit()。
//   二次触发（用户连按 Ctrl+C）：立即 exit(130)，不再等优雅收尾。
// watchdogMs 默认 5s：_doStop 内 IM teardown + serverStopping hook 共用一个 3s 总预算
// （见 server.js _doStop 的合并 race），其后还有 rename temp jsonl（用户数据）要顺序
// 执行 —— watchdog 必须 > 3s 总预算 + rename 余量，避免中途截断。
export function createHardenedCleanup({ doCleanup, exit = process.exit, setTimeoutImpl = setTimeout, watchdogMs = 5000 }) {
  let invoked = false;
  return function hardenedCleanup() {
    if (invoked) { exit(130); return; }
    invoked = true;
    const watchdog = setTimeoutImpl(() => exit(130), watchdogMs);
    if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
    try {
      const r = doCleanup();
      if (r && typeof r.then === 'function') {
        r.then(() => exit(), () => exit(130));
      } else {
        // 同步 doCleanup：完成即退（统一契约"doCleanup 结束 → exit"；当前所有调用方
        // 都返回 promise 走上面分支，此分支为前向兼容）
        exit();
      }
    } catch {
      exit(130);
    }
  };
}

// Windows 下 ConPTY/控制台事件链偶发吞掉 Ctrl+C（SIGINT 永不送达）的兜底：
// 把本地终端 stdin 切 raw mode 监听 keypress，\x03(Ctrl+C)/\x04(Ctrl+D) 直连 onInterrupt。
// 注意：raw mode 下控制台**不再产生 SIGINT**，onInterrupt 必须直接是 hardened cleanup
// 本体（不能 re-emit SIGINT —— 那条路在 raw mode 下已死）。
// 仅 win32 且 stdin 是 TTY 时安装（silent/PTY 与 SDK 模式本地终端本就无人读 stdin，
// 无副作用；proxy 模式 stdio:'inherit' 子进程持有控制台，调用方不得安装）。
// 进程退出时通过 'exit' 同步钩子恢复 cooked mode，防 Windows 终端残留 raw 态
// （watchdog 的 exit(130) 同样触发 'exit' 钩子）。
export function installWinKeypressFallback({ stdin = process.stdin, onInterrupt, platform = process.platform, emitKeypressEvents = _emitKeypressEvents }) {
  if (platform !== 'win32' || !stdin || !stdin.isTTY) return null;
  emitKeypressEvents(stdin);
  try { stdin.setRawMode(true); } catch { return null; }
  const restore = () => { try { stdin.setRawMode(false); } catch { /* noop */ } };
  process.on('exit', restore);
  const onKeypress = (str, key) => {
    const isCtrlC = (key && key.ctrl && key.name === 'c') || str === '\u0003';
    const isCtrlD = (key && key.ctrl && key.name === 'd') || str === '\u0004';
    if (isCtrlC || isCtrlD) onInterrupt();
  };
  stdin.on('keypress', onKeypress);
  stdin.resume();
  return () => {
    stdin.off('keypress', onKeypress);
    restore();
    process.off('exit', restore);
  };
}

// Windows 下杀掉 PTY 进程树（ConPTY agent + claude）。
// 用 spawnSync taskkill 而非 ptyProcess.kill()：后者在 ConPTY 下有已知同步挂起问题
// （microsoft/node-pty#454 等），且 killPty 的 respawn 调用方（spawnClaude 内部
// kill→立即重启、workspaces stop→launch）需要"返回时进程已死"的同步语义 ——
// taskkill /F 通常 <200ms，timeout 2s 兜底有界，不会废掉 5s watchdog。
// 非 win32 返回 false，调用方走原 ptyProcess.kill() 路径。
export function killPtyTree(pid, { platform = process.platform, spawnSyncImpl = _spawnSync } = {}) {
  if (platform !== 'win32' || !pid) return false;
  try {
    spawnSyncImpl('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 2000, windowsHide: true });
  } catch { /* taskkill 不在 PATH 等极端情况，调用方仍有 watchdog 兜底 */ }
  return true;
}
