/**
 * ANSI 转义序列安全边界工具（纯函数、零依赖，乱码残片不变量的语义基准）。
 * 两个导出：
 *   findSafeSliceStart(buf, rawStart)  —— 缓冲区"掐头"裁剪的安全起点（锚点扫描）
 *   splitTrailingIncomplete(buf)       —— 批边界"截尾"缓带：[安全前段, 半截序列尾巴]
 * 共同保证：xterm 收到的字节流中，任何删除/分批的续点都是合法解析起点，
 * 半截序列永不以字面渲染。端到端验证见 test/terminal-pipeline-oracle.test.js。
 */

/**
 * findSafeSliceStart：在输出缓冲区从头部截断时，找到安全的截断起点，
 * 避免切片落在 ANSI 转义序列中间——丢掉 ESC[ 前缀后剩余字节
 * 会被 xterm.js 当普通文本渲染（表现为 `[9m`、`?2026l`、`6;136;136m` 类乱码）。
 *
 * 算法：从 rawStart 向后扫描，锚到下一个无歧义的解析重启点：
 * - 硬锚点 ESC (0x1b)：从 ESC 起始永远是合法序列起点（CSI/SGR/OSC/DCS 通吃）；
 *   最坏情况锚到 OSC 终止符 ST（ESC \）自身，ground state 下是无害 no-op。
 * - 软锚点 LF (0x0a)：仅当窗口内无 ESC 时使用（纯文本流如 shell 日志），
 *   返回 LF 之后的位置。不与 ESC 平级是因为 OSC payload 理论上可含 LF。
 * - 都没有且窗口未覆盖尾部：返回 scanLimit（多丢 ≤scanWindow 字节，发生在
 *   滚动缓冲头部，可忽略）。
 * - 都没有且窗口覆盖尾部：回看一小窗判断 rawStart 是否落在某 CSI/OSC 内部
 *   （前方无 ESC/LF 意味着该序列的终止符只能在 rawStart 之后）——是则前跳到
 *   终止符之后，否则返回 rawStart——绝不清空保留数据（洪泛限流的 last-wins
 *   语义依赖这一点）。fallback 起点若落在 UTF-16 低代理上则 +1，避免孤儿化
 *   代理对（高代理起点配对仍完整，无需处理）。
 *
 * 注意：只保 ANSI 序列边界，不保 DEC 2026 同步标记的配对——头部截断只可能
 * 孤儿化 END（?2026l，xterm 下无害 no-op），不可能产生无 END 的 BEGIN；
 * 跨 2026 块截断的配平由调用方负责（见 pty-flood-coalescer.js 的标记剥离）。
 */
// 前向锚点扫描窗：TUI 流 ESC 密集（几十字节内必中锚点），上限只在纯文本流生效——
// 多丢 ≤4KB 且发生在 ≥45KB 保留尾部的头部，不可感知。
const DEFAULT_SCAN_WINDOW = 4096;
// 回看判定窗：CSI 实际长度有界（最长常见真彩 SGR ≈20 字节），64 足以覆盖
// "rawStart 是否落在某序列内部"的判定；OSC 超长场景由前向 ESC 锚兜住。
const BACK_SCAN = 64;
// 缓带上限：正常序列远小于此；超限视为畸形流（永不终结的 OSC/DCS），
// 放弃缓带按原样发出，防半截尾巴无界滞留内存/延迟。
const DEFAULT_MAX_CARRY = 4096;

/**
 * 把 buf 切成 [可安全发出的前段, 尾部未终结的半截转义序列]。
 * 用途：flushBatch 给每批输出包裹 DEC 2026 SYNC 标记——若批边界劈开一条序列，
 * 注入的标记会吃掉它的 ESC，让后半段以字面渲染（`[9m`/`8;2;102m` 类残片的总根源）。
 * 半截尾巴缓带到下一批（PTY 续写必然补全）即可保证每个被包裹的批序列完整。
 * 尾部孤立高代理同样缓带（不劈 emoji 码点）。超 maxCarry 的悬挂（畸形流如
 * 永不终结的 OSC）放弃缓带按原样发出，防止无界延迟/内存。
 */
export function splitTrailingIncomplete(buf, maxCarry = DEFAULT_MAX_CARRY) {
  if (!buf) return ['', ''];
  const k = buf.lastIndexOf('\x1b');
  if (k !== -1 && buf.length - k <= maxCarry) {
    const intro = k + 1 < buf.length ? buf.charCodeAt(k + 1) : -1;
    let complete;
    if (intro === -1) {
      complete = false;                       // 裸 ESC 收尾
    } else if (intro === 0x5b) {              // CSI：任何 0x40-0x7e 终字节即终结
      complete = false;
      for (let j = k + 2; j < buf.length; j++) {
        const c = buf.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) { complete = true; break; }
      }
    } else if (intro === 0x5d) {              // OSC：k 是最后一个 ESC → ST 不可能，只看 BEL
      complete = buf.indexOf('\x07', k + 2) !== -1;
    } else if (intro === 0x50) {              // DCS：ST 终结需要 ESC，而 k 已是最后一个
      complete = false;
    } else {                                  // 短转义：ESC + 中间字节(0x20-0x2f)* + 终字节
      let j = k + 1;
      while (j < buf.length && buf.charCodeAt(j) >= 0x20 && buf.charCodeAt(j) <= 0x2f) j++;
      complete = j < buf.length;
    }
    if (!complete) return [buf.slice(0, k), buf.slice(k)];
  }
  // 尾部孤立高代理：配对的低代理还在路上
  const last = buf.charCodeAt(buf.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) return [buf.slice(0, -1), buf.slice(-1)];
  return [buf, ''];
}

export function findSafeSliceStart(buf, rawStart, scanWindow = DEFAULT_SCAN_WINDOW) {
  if (rawStart <= 0) return 0;
  if (rawStart >= buf.length) return buf.length;
  const scanLimit = Math.min(rawStart + scanWindow, buf.length);
  let afterLf = -1;
  for (let i = rawStart; i < scanLimit; i++) {
    const ch = buf.charCodeAt(i);
    if (ch === 0x1b) return i;
    if (ch === 0x0a && afterLf === -1) afterLf = i + 1;
  }
  if (afterLf !== -1) return afterLf;
  const idx = scanLimit >= buf.length ? resolveInSequence(buf, rawStart) : scanLimit;
  const c = buf.charCodeAt(idx);
  return (c >= 0xdc00 && c <= 0xdfff) ? idx + 1 : idx;
}

// 前向无任何锚点时的兜底：回看 BACK_SCAN 字节找最近的 ESC，判断 rawStart 是否
// 正落在它引导的 CSI/OSC 内部（引导符与 rawStart 之间无终止符），是则前跳过终止符。
// 注意调用前提：rawStart 之后整个 buf 内都没有 ESC（前向扫描已覆盖到结尾），
// 所以 OSC 只需考虑 BEL 终止形态（ESC\ 形态会被前向锚点拦下，到不了这里）。
function resolveInSequence(buf, rawStart) {
  const backStop = Math.max(0, rawStart - BACK_SCAN);
  for (let k = rawStart - 1; k >= backStop; k--) {
    if (buf.charCodeAt(k) !== 0x1b) continue;
    const intro = buf.charCodeAt(k + 1);
    if (intro === 0x5b) { // CSI：终止符为 0x40-0x7e（引导符之后起算）
      for (let j = k + 2; j < rawStart; j++) {
        const cj = buf.charCodeAt(j);
        if (cj >= 0x40 && cj <= 0x7e) return rawStart; // 序列已终结，rawStart 在纯文本里
      }
      for (let j = Math.max(rawStart, k + 2); j < buf.length; j++) {
        const cj = buf.charCodeAt(j);
        if (cj >= 0x40 && cj <= 0x7e) return j + 1;
      }
      // 序列到结尾仍未终结（还在被 PTY 续写）：保留半截序列头，等续写补全；
      // 若改为丢弃，下一 chunk 送来的序列尾会变成新的孤儿残片。
      return k;
    }
    if (intro === 0x5d) { // OSC：BEL 终止
      for (let j = k + 2; j < rawStart; j++) {
        if (buf.charCodeAt(j) === 0x07) return rawStart;
      }
      for (let j = Math.max(rawStart, k + 2); j < buf.length; j++) {
        if (buf.charCodeAt(j) === 0x07) return j + 1;
      }
      return k;
    }
    return rawStart; // 其他短转义（charset 切换等）≤3 字节，rawStart 已在其后
  }
  return rawStart; // 回看窗口内无 ESC：rawStart 在纯文本里
}
