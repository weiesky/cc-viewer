/**
 * Native Teammate 检测器
 *
 * 识别 Claude Code 同进程内通过 Agent 工具启动的 native teammate。
 * 与外部进程 teammate（通过 --agent-name 参数启动）不同，native teammate
 * 的 API 请求没有 req.teammate 字段，需要通过 system prompt 特征检测。
 *
 * 特征：system prompt 中包含 "You are a Claude agent" 标记
 * （主 agent 的 system prompt 是 "You are Claude Code"）
 *
 * 版本兼容：
 * - Claude Code v2.1.81+: system block[1] = "You are a Claude agent, built on Anthropic's Claude Agent SDK."
 * - 未来版本如果特征变化，在此文件中添加新的检测规则即可
 */

// 内联 getSystemText 避免与 contentFilter 循环依赖
function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(s => (s && s.text) || '').join('');
  return '';
}

// Native teammate 特征：system prompt 包含 "You are a Claude agent"
// 注意区分 "You are Claude Code"（主 agent）
const NATIVE_TEAMMATE_RE = /You are a Claude agent/i;

// WeakMap cache 避免重复检测
const _cache = new WeakMap();

/**
 * 判断请求是否为 native teammate（同进程内的 Agent 子代理）
 * @param {object} req - 请求对象
 * @returns {boolean}
 */
export function isNativeTeammate(req) {
  if (!req) return false;
  const cached = _cache.get(req);
  if (cached !== undefined) return cached;

  // 已有 teammate 字段（外部进程 teammate）→ 不是 native teammate
  if (req.teammate) {
    _cache.set(req, false);
    return false;
  }

  const sysText = getSystemText(req.body || {});
  const result = NATIVE_TEAMMATE_RE.test(sysText);
  _cache.set(req, result);
  return result;
}

/**
 * 从 native teammate 请求中提取名字
 * 优先从首条 user message 中匹配 "You are XXX" 模式
 * @param {object} req - 请求对象
 * @returns {string|null}
 */
export function extractNativeTeammateName(req) {
  if (!req?.body) return null;

  const msgs = req.body.messages || [];
  if (msgs.length === 0) return null;

  // 搜索所有 user 消息（上下文压缩后 hook 可能不在 msg[0] 中）
  for (const m of msgs) {
    if (m.role !== 'user') continue;
    const content = m.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter(c => c && c.type === 'text')
        .map(c => c.text || '')
        .join(' ');
    }
    if (!text) continue;

    // 匹配名字模式（按优先级尝试）
    const nameMatch =
      // OMC hook: "Agent oh-my-claudecode:code-reviewer started"
      text.match(/Agent\s+(?:oh-my-claudecode:)?(\S+)\s+started/i)
      // 任务提示: "You are CRer2, ..."
      || text.match(/You are (\w+)[,.]/)
      // 显式名字: "name: CRer2"
      || text.match(/name[：:]\s*["']?(\w+)/i);
    if (nameMatch) return nameMatch[1];
  }

  return null;
}

/**
 * 从 billing header 中提取 Claude Code 版本号
 * v2.1.90+ system prompt 中包含 x-anthropic-billing-header: cc_version=X.Y.Z
 * @param {object} req - 请求对象
 * @returns {string|null} 版本号如 "2.1.90" 或 null
 */
export function extractCcVersion(req) {
  const system = req?.body?.system;
  if (!Array.isArray(system)) return null;
  for (const block of system) {
    if (!block?.text) continue;
    const m = block.text.match(/cc_version=([\d.]+)/);
    if (m) return m[1];
  }
  return null;
}
