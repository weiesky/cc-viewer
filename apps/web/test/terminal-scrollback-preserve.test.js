/**
 * 复位保留 scrollback —— 用真实 xterm.js(headless,非模型)论证不变量。
 *
 * 背景:cc-viewer 在 ws 重连 / 反压 resync 时向 xterm 写入 INBAND_RESET 复位解析器状态。
 * 历史曾用 \x1bc(RIS)→ 连 scrollback 一起清空 → 用户重连后"只剩一页、上拉不到历史"。
 * 现改为 \x07\x18\x1b[2J\x1b[H\x1b[!p:中止半截序列 + 清可视区 + 软复位属性,但**不清 scrollback**。
 *
 * 本测试直接喂真实 @xterm/xterm 6.0 的 buffer,断言:
 *   1. 现 INBAND_RESET 复位后 scrollback(历史行)仍在;
 *   2. 回归守卫:RIS(\x1bc)会清空 scrollback —— 证明病根 & 防有人改回去;
 *   3. 现 INBAND_RESET 对半截 ANSI 序列仍能零残片接管(与 oracle 模型互证)。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import xtermPkg from '@xterm/xterm';
import { INBAND_RESET } from '../src/utils/terminalWriteQueue.js';

const { Terminal } = xtermPkg;
// 旧版完整 INBAND_RESET 值(BEL+CAN+RIS),仅用于回归对照——病根是末尾 RIS(\x1bc)清空 scrollback。
const LEGACY_INBAND_RESET = '\x07\x18\x1bc';

const ROWS = 10;
const mkTerm = () => new Terminal({ rows: ROWS, cols: 40, scrollback: 1000, allowProposedApi: true });
const writeP = (t, s) => new Promise((r) => t.write(s, r));
const scrollbackLines = (t) => t.buffer.active.length - t.rows;
function allText(t) {
  const out = [];
  const b = t.buffer.active;
  for (let i = 0; i < b.length; i++) {
    const ln = b.getLine(i);
    if (ln) { const s = ln.translateToString(true); if (s) out.push(s); }
  }
  return out;
}
async function buildHistory(t, n = 50) {
  for (let i = 1; i <= n; i++) await writeP(t, `line-${i}\r\n`); // n > ROWS → 旧行滚入 scrollback
}

describe('终端复位保留 scrollback(真实 xterm)', () => {
  it('现 INBAND_RESET 复位后 scrollback 历史仍在(主目标)', async () => {
    const t = mkTerm();
    await buildHistory(t);
    assert.ok(scrollbackLines(t) > 0, '前置:历史应已滚入 scrollback');
    await writeP(t, INBAND_RESET);
    await writeP(t, 'AFTER-RESET\r\n');
    assert.ok(scrollbackLines(t) > 0, '复位后 scrollback 必须仍非空(历史可上拉)');
    const text = allText(t);
    assert.ok(
      text.some((l) => l.includes('line-1') || l.includes('line-2') || l.includes('line-30')),
      `复位后历史行应仍在 buffer,实际:${JSON.stringify(text.slice(0, 5))}`,
    );
  });

  it('回归守卫:RIS(\\x1bc)会清空 scrollback —— 正是"只剩一页"病根,INBAND_RESET 不得用它', async () => {
    const t = mkTerm();
    await buildHistory(t);
    assert.ok(scrollbackLines(t) > 0);
    await writeP(t, LEGACY_INBAND_RESET);
    assert.equal(scrollbackLines(t), 0, 'RIS 应清空 scrollback(此即被修复的行为)');
    // 双保险:确保生产常量确实不含 RIS
    assert.ok(!INBAND_RESET.includes('\x1bc'), 'INBAND_RESET 绝不能含 RIS');
  });

  it('现 INBAND_RESET 对半截 ANSI 序列零残片接管', async () => {
    const t = mkTerm();
    await writeP(t, 'hello\r\n');
    await writeP(t, '\x1b[38;2;1');     // 半截真彩色序列(被截断)
    await writeP(t, INBAND_RESET);      // 带内复位
    await writeP(t, 'OK-CLEAN\r\n');
    const text = allText(t);
    assert.ok(text.some((l) => l.includes('OK-CLEAN')), 'OK-CLEAN 应正常渲染');
    assert.ok(
      !text.some((l) => /38;2;1|^\d+;\d+m/.test(l)),
      `不得出现半截序列残片,实际:${JSON.stringify(text)}`,
    );
  });
});
