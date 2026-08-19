/**
 * Read tool_result content intern pool.
 *
 * 1.6.237 后实测：同一 .jsx 文件被 87 个 SubAgent / 父 user message 各持一份完整副本（30MB+ 重复）。
 * 对 Read 工具的 resultText 做 content-addressed dedup，让相同内容共享同一字符串引用。
 * hash 仅用 length + 前 64 / 后 64 字符避免大字符串 O(n) hash；当 length > 512
 * 再加采中段 64 字符（共三段 192 字节），令仅中段不同的长串也能区分；碰撞概率极低。
 *
 * 抽到独立模块（无外部依赖）便于 node --test 直接 import，避免被
 * toolResultBuilder.js 的传递依赖（./helpers 无 .js 后缀）污染。
 */

// 容量上限设计：1000 vs entry-slim.js 的 _toolsPool/_systemPool 上限 200，差异源自流量域不同。
// tools/system 是 entry-level 配置数组，全 session 命中分布稳定，实测 pool size <5（200 极宽松）；
// readResultPool 池化的是 tool_result 字符串（v4 派生层 + v5 raw payload），
// 单 session 唯一字符串数量与 tool 调用次数同阶（v4 实测 4400 calls / pool size 363）。
// B 项加入 raw payload 后预期再 +20-40%，1000 留 ~30% 余量；超阈值由 _poolEvictions 暴露。
const _MAX_READ_POOL_SIZE = 1000;
const _MIN_DEDUP_LEN = 256;
const _SIG_MID_THRESHOLD = 512;
const _readResultPool = new Map();
let _poolEvictions = 0;

// v5: sig 增加 mid-slice（当 length > 512）。对齐 entry-slim.js _systemSig 的边界增强模式。
// B 项把 raw payload tool_result block.content 也接入此 pool（含 Bash tab-padded / log 类
// 长度+前后缀重合的结构化输出），暴露面变大。length+first 64+last 64 在该场景对碰撞抗性
// 不足，加 mid-64 后要求"长度+三段共 192 字节"全匹配才视为同串。
function _readResultSig(s) {
  if (s.length > _SIG_MID_THRESHOLD) {
    const midIdx = Math.floor(s.length / 2);
    return s.length + ':' + s.slice(0, 64) + ':' + s.slice(midIdx, midIdx + 64) + ':' + s.slice(-64);
  }
  return s.length + ':' + s.slice(0, 64) + ':' + s.slice(-64);
}

/**
 * 把 Read 工具的 resultText 替换为 pool 中的共享引用（命中时）或注册新值。
 * 短字符串（< 256）跳过 dedup（不值得 sig 开销）。
 *
 * @param {string} s - resultText 原文
 * @returns {string} 池化后的字符串引用
 */
export function internReadResult(s) {
  if (typeof s !== 'string' || s.length < _MIN_DEDUP_LEN) return s;
  const sig = _readResultSig(s);
  const pooled = _readResultPool.get(sig);
  if (pooled !== undefined) return pooled;
  if (_readResultPool.size >= _MAX_READ_POOL_SIZE) {
    _readResultPool.delete(_readResultPool.keys().next().value);
    _poolEvictions++;
  }
  _readResultPool.set(sig, s);
  return s;
}

/** 测试辅助：清空 Read intern pool 和 eviction counter。 */
export function _resetReadPoolForTest() {
  _readResultPool.clear();
  _poolEvictions = 0;
}

/** 测试辅助：观察 pool 当前 size。 */
export function _getReadPoolSizeForTest() {
  return _readResultPool.size;
}

/** 诊断：FIFO 淘汰累计次数。典型 session <50；>200 提示 _MAX_READ_POOL_SIZE 需上调。 */
export function _getReadPoolEvictionsForTest() {
  return _poolEvictions;
}

/**
 * 通用版：Read 之外的所有 tool_result（Bash/Grep/Glob/MCP/...）也走同一 pool。
 * 算法与 internReadResult 完全相同（同 _readResultSig + 同 _readResultPool），
 * 名字区分只是语义上的扩展，便于 toolResultBuilder.js 默认全 intern。
 *
 * @param {string} s - tool_result 的 resultText 原文
 * @returns {string} 池化后的字符串引用
 */
export function internToolResult(s) {
  return internReadResult(s);
}

/**
 * 命中-aware 变体：仅在 pool 已有相同 sig 时返回共享 ref，否则注册并返回 null。
 *
 * 设计动机：JS string `===` 是值比较，调用方拿到 internReadResult 的返回值无法判断"这是
 * pool 命中（应替换 block.content 节省内存）"还是"刚注册（保持原 ref 即可）"。
 * 此函数把命中信号显式上抛——`null` = 未命中或短结果（无需替换），非 null = 命中（应替换）。
 * v5 entry-slim.js 的 lazy-clone 路径依赖这个信号决定是否触发 messages 浅克隆。
 *
 * @param {string} s - tool_result 内容原文
 * @returns {string|null} 命中时返回 pool 共享 ref；未命中（已注册）或短结果（< 256）返回 null
 */
export function internToolResultIfPooled(s) {
  if (typeof s !== 'string' || s.length < _MIN_DEDUP_LEN) return null;
  const sig = _readResultSig(s);
  const pooled = _readResultPool.get(sig);
  if (pooled !== undefined) return pooled;
  if (_readResultPool.size >= _MAX_READ_POOL_SIZE) {
    _readResultPool.delete(_readResultPool.keys().next().value);
    _poolEvictions++;
  }
  _readResultPool.set(sig, s);
  return null;
}
