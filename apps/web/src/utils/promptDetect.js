/**
 * promptDetect —— PTY prompt 检测（ChatView._detectPrompt 的提取 + 线性化重写）。
 *
 * 为什么存在：旧实现的 Pattern 1/2 多行正则带嵌套量词
 *   /([^\n]*\?)\s*\n((?:\s*[❯>]?\s*\d+\.\s+[^\n]+\n?){2,})(?:\n[^\d❯>\n][^\n]*|\n)*$/
 * 中 `\s*` 可吃换行、`[^\n]+` 可吃空格、行内 `\d+\.`（版本号）提供多重切分点，
 * 失配时回溯组合数按行数指数爆炸——实测 /plugins 菜单形态文本 4 行 84ms、
 * 6 行 2.2s、8 行 >90s；_ptyBuffer 4KB ≈ 40~80 行 → 单次同步 match 永久占死
 * 主线程（Windows /plugins 菜单整页卡死的根因）。
 *
 * detectPromptInBuffer 用「行式扫描」复刻旧正则语义，可证 O(n·行长)：
 * 全程只对单行跑 `^...$` 锚定、无嵌套量词的正则。语义对齐要点（以
 * test/prompt-detect.test.js 的等价回归 fixture 为准绳）：
 *   - 按 /\r?\n/ 分行：Windows ConPTY 输出 CRLF，行尾 \r 必须在分行时吃掉
 *     （单行正则的 `.`/`$` 都不容忍 \r，legacy 靠 [^\n] 容忍——此处对齐）；
 *   - leftmost：与 JS regex 一致，自上而下取第一个结构成立的 question 行；
 *   - Pattern 1 question 行须以 `?` 结尾（容尾随空白）；选项块=连续编号行，
 *     块内/块前允许空行；块后所有行须为 trailing（空行或首字符 ∉ {数字,❯,>}）；
 *   - Pattern 2 question 为任意非空行；选项块成员=两段空白结构
 *     `\s+[❯>]?\s+内容` 的行（与旧块正则同构，单段空白如 " X" 不是成员）；
 *     须 ≥2 项且含 ❯/> 选中项；trailing 定义不同（空行或首字符 ∉ {空白,❯,>}）；
 *     与旧实现一致，结构首次匹配后验证失败即整体放弃（不向后重试）；
 *   - 输出形状 {question, options:[{number,text,selected}]} 与旧实现逐字段一致。
 *
 * The original regex implementation (detectPromptLegacy) and its
 * ccv_legacy_prompt_detect escape hatch were removed after the linear rewrite
 * (first shipped in 1.6.308) proved stable in the field; its behavior is
 * pinned by the golden-master corpus in test/prompt-detect.test.js.
 *
 * 纯 JS、无浏览器全局依赖（node:test 可直接 import）。
 */
import { now } from './monotime.js';

// 与 ChatView._stripAnsi 同源（4 个正则均线性安全）。单一实现：ChatView 与
// test/permission-detect.test.js 均从这里 import，消除多份拷贝漂移。
export function stripAnsi(str) {
  // Remove CSI sequences (ESC [ ... final byte), OSC sequences (ESC ] ... ST), and other escape sequences
  return str
    .replace(/\x1b\[[?0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[^[\]](.|$)/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

// 跨 write 撕裂防护：把 data 切成 [可安全 strip 的前段, 尾部未终结的 CSI/OSC 半截]。
// ANSI 序列被 PTY 分片切断时（"\x1b[3" | "6m…"）按单次 write strip 会让两半都剥不掉、
// 残字污染 buffer 致漏检；调用方把 carry 缓带到下一片拼接后再 strip。
// maxCarry 上限防畸形流（如 OSC 永不终结）让 carry 无限囤积——超限放弃缓带按原样剥。
export function splitTrailingAnsiCarry(data, maxCarry = 512) {
  const m = data.match(/\x1b(?:\[[?0-9;]*|\][^\x07\x1b]*)?$/);
  if (m && m[0].length < maxCarry) return [data.slice(0, m.index), m[0]];
  return [data, ''];
}

// false-positive 过滤（从 ChatView 平移，单行正则、线性）。返回 true = 应忽略。
export function isFalsePositiveQuestion(question) {
  // 形如文件/目录路径或状态栏输出
  if (/^[■\s]*[~\/.:]/.test(question) && /\//.test(question)) return true;
  // Claude Code 计时/状态输出（如 "*Crunchedfor2m18s"）
  if (/^[*■✦⏎]/.test(question)) return true;
  return false;
}

// ── 单行判定正则（均 ^...$ 锚定、无嵌套量词，单行长度有界 → 线性）──
// Pattern 1 选项行：可缩进 + 可选 ❯/> 光标 + 编号 + ". " + 文本
const P1_OPTION_RE = /^\s*([❯>])?\s*(\d+)\.\s+(.+)$/;
// Pattern 2 块成员准入：与 legacy 块正则 \s+[❯>]?\s+[^\n]+ 同构——
// ≥1 空白 + 可选光标 + ≥1 空白 + ≥1 字符。单段空白行（" X"）不是成员。
const P2_MEMBER_RE = /^\s+[❯>]?\s+./;
// Pattern 2 选项行解析（与旧 ChatView 的 per-line 解析一致）
const P2_OPTION_PARSE_RE = /^\s*([❯>])?\s+(.+)$/;
// trailing 合法性为「反向」判定：match = 首字符打断 trailing → 该 prompt 不成立。
// Pattern 1 合法 trailing 行 = 空行或首字符 ∉ {数字,❯,>}
const P1_TRAILING_BREAK_RE = /^[\d❯>]/;
// Pattern 2 合法 trailing 行 = 空行或首字符 ∉ {空白,❯,>}
const P2_TRAILING_BREAK_RE = /^[\s❯>]/;

// overrun 监测阈值：超过仅告警 + 计数（无熔断、无降级——线性实现 4KB 封顶
// 实践上不会触发，留作 Windows 实机回报的哨兵指标）
const OVERRUN_MS = 50;

// 诊断统计（termDiag 接线读取；>OVERRUN_MS 计 overrun）
const _stats = { calls: 0, lastMs: 0, maxMs: 0, overruns: 0 };
export function getPromptDetectStats() {
  return { ..._stats };
}

function parseP1Option(line) {
  const m = line.match(P1_OPTION_RE);
  if (!m) return null;
  return { number: parseInt(m[2], 10), text: m[3].trim(), selected: !!m[1] };
}

/**
 * Pattern 1：编号选项 — "Question?\n  ❯ 1. Option A\n    2. Option B"
 * 允许尾随空行与 hint 行（如 "\n\nEsc to cancel · Tab to amend"）。
 */
function detectPattern1(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    const q = lines[i].trimEnd();
    if (!q.endsWith('?')) continue;
    // 问句行下方：跳过空行后须紧跟编号选项块（块内允许夹空行）
    const options = [];
    let j = i + 1;
    let lastOptionEnd = j; // 选项块后第一行（trailing 起点）
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) continue;          // 空行：块前/块内均容忍
      const opt = parseP1Option(line);
      if (!opt) break;                     // 非选项非空行：块结束
      options.push(opt);
      lastOptionEnd = j + 1;
    }
    if (options.length < 2) continue;
    // 块后全部行须为 trailing（空行或首字符 ∉ {数字,❯,>}），否则该问句不成立
    let trailingOk = true;
    for (let k = lastOptionEnd; k < lines.length; k++) {
      if (P1_TRAILING_BREAK_RE.test(lines[k])) { trailingOk = false; break; }
    }
    if (!trailingOk) continue;
    return { question: q.trim(), options };
  }
  return null;
}

/**
 * Pattern 2：无编号光标选项（Ink Select）— "Some prompt text\n  ❯ Allow once\n    Deny"
 * 问句行可不带 "?"；须 ≥2 项且含 ❯/> 选中项。与旧实现一致：结构首次匹配后
 * 验证（项数/选中）失败即整体放弃，不向后重试。
 */
function detectPattern2(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].length === 0) continue;   // question 须非空行（与旧 [^\n]+ 一致，纯空白行也算）
    // 块成员：两段空白结构（P2_MEMBER_RE，与 legacy 块正则同构）；块内允许夹空行
    const memberLines = [];
    let j = i + 1;
    let lastOptionEnd = j;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) continue;
      if (!P2_MEMBER_RE.test(line)) break;
      memberLines.push(line);
      lastOptionEnd = j + 1;
    }
    if (memberLines.length < 2) continue;
    let trailingOk = true;
    for (let k = lastOptionEnd; k < lines.length; k++) {
      if (P2_TRAILING_BREAK_RE.test(lines[k])) { trailingOk = false; break; }
    }
    if (!trailingOk) continue;
    // 结构成立（leftmost）→ 解析验证；失败则与旧实现一致整体放弃
    const parsed = [];
    for (const line of memberLines) {
      const m = line.match(P2_OPTION_PARSE_RE);
      if (m && m[2].trim()) {
        parsed.push({ number: parsed.length + 1, text: m[2].trim(), selected: !!m[1] });
      }
    }
    if (parsed.length >= 2 && parsed.some(p => p.selected)) {
      const question = lines[i].trim();
      // 纯空白问句行：与旧实现等价——结构成立但 question 为空即整体放弃（不向后重试）
      if (!question) return null;
      return { question, options: parsed };
    }
    return null;
  }
  return null;
}

/**
 * 检测 PTY buffer 尾部是否呈现交互式 prompt。
 * @param {string} buf - ANSI-stripped PTY buffer（≤4KB）
 * @returns {{question: string, options: Array<{number:number,text:string,selected:boolean}>} | null}
 *   不含 false-positive 过滤（调用方按需用 isFalsePositiveQuestion，
 *   ChatView 对「过滤」与「未检出」有不同的 dismiss 语义）。
 */
export function detectPromptInBuffer(buf) {
  const t0 = now();
  let result = null;
  const trimmed = (buf || '').trimEnd();
  if (trimmed) {
    // /\r?\n/ 分行吃掉 CRLF 行尾的 \r（Windows ConPTY），否则单行正则的
    // `.`/`$` 均不容忍 \r → 选项行整行失配 → 目标平台全量漏检
    const lines = trimmed.split(/\r?\n/);
    result = detectPattern1(lines) || detectPattern2(lines);
  }
  const ms = now() - t0;
  _stats.calls++;
  _stats.lastMs = ms;
  if (ms > _stats.maxMs) _stats.maxMs = ms;
  if (ms > OVERRUN_MS) {
    _stats.overruns++;
    try { console.warn(`[cc-viewer] promptDetect overrun: ${ms.toFixed(1)}ms (buf ${trimmed.length}B)`); } catch {}
  }
  return result;
}
