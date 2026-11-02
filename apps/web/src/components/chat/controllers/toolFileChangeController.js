// 工具文件变更监听控制器（从 ChatView 抽出，纯逻辑、可单测）。
//
// 扫描 mainAgentSessions + requests 里的 tool_result，反查 tool_use 索引拿 toolName/input，
// 判断是否有文件改动 → 防抖触发 FileExplorer / Git 面板 / 当前文件内容刷新。
// 用 FIFO LRU 去重已处理的 tool_use_id。state 留 ChatView，经 host 读写。
//
// host 接口：
//   getState()             → currentFile / fileExplorerOpen / gitChangesOpen
//   setState(updater)      → 转发宿主 this.setState（refresh 计数用 functional updater）
//   getProps()             → mainAgentSessions / requests
//   getProjectDir()        → 宿主 this._projectDirCache（可能为 null）
//   setPendingFileRefresh()→ 面板关闭期记 pending（宿主 _pendingFileRefresh = true，由开面板时消费）
//   setPendingGitRefresh() → 同上（_pendingGitRefresh）

import { isMutatingCommand } from '../../../utils/commandValidator.js';

// 文件修改类工具：触发文件浏览器与 Git 面板刷新
const FILE_MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// _processedToolIds 去重 Set 上限与砍头后的保留量；FIFO LRU 实现
//
// 数学依据：
//   - MAX = 20000：典型用法 ~25 tool_use/h，连续 800h（≈ 数日不间断对话）才触发
//   - KEEP = 15000：砍头一次移除 5000 条最旧 id，避免逼近上限时频繁小批量砍头抖动
//   - 内存开销：20000 × ~30 字符 toolu_xxx ≈ 600KB（Set + Queue），可接受
//
// 设计意图（vs 旧的暴力 clear）：
//   清空整个 Set 后，仍残留在 sessions/requests 中的旧 tool_use block 会被重新认作
//   "新事件"再触发一次刷新（用户感知"忽刷忽不刷"）。FIFO 砍头保证最新的事件 id
//   仍在 Set 内不被误识，只丢弃确实过老的（用户已不关心的）id。
const PROCESSED_TOOL_IDS_MAX = 20000;
const PROCESSED_TOOL_IDS_KEEP = 15000;

// tool_use_id 防御性长度上限；防御异常长 id 占用内存（正常 toolu_xxx 长度 ~30 字符）
const TOOL_USE_ID_MAX_LEN = 256;

// 收集 tool_use 块到 toolUseMap（id → {name, input}）的纯函数。
export function collectToolUseBlocks(blocks, toolUseMap) {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (block.type === 'tool_use' && block.id && block.name) {
      let input = block.input;
      if (typeof input === 'string') {
        // 流式过程中 input 字段可能是 "[object Object]{...}" 残片：上游 toString 污染
        // 把已有的 [object Object] 前缀剥掉再 parse；解析失败兜底空对象，不影响 toolName 路径
        try { input = JSON.parse(input.replace(/^\[object Object\]/, '')); } catch { input = {}; }
      }
      toolUseMap.set(block.id, { name: block.name, input });
    }
  }
}

export class ToolFileChangeController {
  constructor(host) {
    this.host = host;
    this._processedToolIds = new Set();
    // 与 _processedToolIds 同步的插入顺序队列（FIFO 砍头用）。
    this._processedToolIdQueue = [];
    this._fileRefreshTimer = null;
    this._gitRefreshTimer = null;
    this._contentRefreshTimer = null;
    // ── 增量扫描游标（性能修复：原为每帧全量重扫所有 sessions/requests 的全部
    // messages —— 长会话里每个 request.body.messages 都是累积前缀，求和即
    // O(上下文²)，且每个 SSE tick 都触发 → 切换长上下文后发消息长时间迟滞）──
    // tool_use 的 id→{name,input} 映射跨调用累积（_processToolResult 反查 tool_use
    // 拿 toolName/input；tool_use 出现在早期 assistant message，若每次重建 map 只扫
    // 新增量会漏掉它 → 漏判文件修改）。
    this._toolUseMap = new Map();
    // 游标用 WeakMap<session/request 对象, 该对象 messages 已扫长度>。为何用对象引用
    // 而非数组索引/字符串 key：传给 check() 的 mainAgentSessions/requests 是被
    // filter(visibleRequests)/slice(resolveDisplaySessions) 过的派生数组，索引随过滤/pin
    // 变化、不可靠；但元素对象引用跨帧稳定 —— merge 复用同一 session 对象
    // (sessionMerge.js:283 只 mutate 不重建)，request 被 reconstruct 替换时是新对象
    // (AppBase:3563)。WeakMap 随对象移除自动 GC，无泄漏；新对象未命中 → 从 0 扫（正确：
    // 新会话/被替换的 entry 需全扫其前缀）。
    this._sessScanned = new WeakMap();
    this._reqScanned = new WeakMap();
  }

  /** 整体重置增量游标（冷加载/切会话/切项目）。由 ChatView 在 sessionsActuallyChanged
   *  （session 元素引用真变化）时调用 —— 换新 WeakMap 即整体失效，旧游标随旧对象 GC。 */
  resetCursors() {
    this._toolUseMap = new Map();
    this._sessScanned = new WeakMap();
    this._reqScanned = new WeakMap();
  }

  _processToolResult(block, toolUseMap, flags) {
    if (block.type !== 'tool_result' || !block.tool_use_id) return;
    // 防御性长度上限，防止异常 id 污染内存（正常 toolu_xxx ~30 字符）
    if (typeof block.tool_use_id !== 'string' || block.tool_use_id.length > TOOL_USE_ID_MAX_LEN) return;
    if (this._processedToolIds.has(block.tool_use_id)) return;
    // 即使失败 / 无 meta 也要标记为已处理，避免后续 cdU 重复扫
    this._processedToolIds.add(block.tool_use_id);
    this._processedToolIdQueue.push(block.tool_use_id);

    if (block.is_error) return;
    const meta = toolUseMap.get(block.tool_use_id);
    if (!meta) return;
    const { name: toolName, input } = meta;

    if (FILE_MUTATING_TOOLS.has(toolName)) {
      flags.needFileRefresh = true;
      flags.needGitRefresh = true;
    } else if (toolName === 'Bash' && input && input.command && isMutatingCommand(input.command)) {
      flags.needFileRefresh = true;
      flags.needGitRefresh = true;
    }

    // Auto-refresh FileContentView when the currently open file is modified.
    // 仅文件修改类工具才读 currentFile —— 保持原短路：只读工具（占多数）不触碰 host.getState。
    if (FILE_MUTATING_TOOLS.has(toolName)) {
      const currentFile = this.host.getState().currentFile;
      if (currentFile) {
        const fp = input && input.file_path;
        // typeof guard：Pass 1 JSON.parse 兜底为 {} 时 fp 为 undefined；流式异常 input
        // 也可能让 fp 为 number/object，rel.startsWith 会抛 TypeError 中断整个 _processToolResult
        if (typeof fp === 'string' && fp) {
          let rel = fp;
          const projectDir = this.host.getProjectDir();
          if (rel.startsWith('/') && projectDir && rel.startsWith(projectDir + '/')) {
            rel = rel.slice(projectDir.length + 1);
          }
          if (rel === currentFile || (rel.startsWith('/') && rel.endsWith('/' + currentFile))) {
            flags.needContentRefresh = true;
          }
        }
      }
    }
  }

  check() {
    // 扫描所有数据源（mainAgentSessions + props.requests 中的 subAgent/teammate），
    // 基于 tool_result 触发刷新（确保工具已执行完且未失败），反查 tool_use 索引拿 toolName/input。
    //
    // 为什么改成 tool_result 触发：
    // - tool_use 写入 jsonl 时工具尚未执行（特别是 Bash 长命令、需 permission 审批的工具）
    // - tool_result 写入 = 工具已执行完；is_error=true 时跳过避免无谓刷新
    //
    // 为什么扫 props.requests：subAgent / teammate（Task 工具调用、Agent Team）
    // 的修改不会出现在 mainAgentSessions，必须从 requests 直接扫

    // INVARIANT: _processedToolIds 与 _processedToolIdQueue 长度必须始终相等。
    // 仅 development 校验（vite prod build 会 dead-code-eliminate 整个分支；test 环境也跳过避免噪声）
    if (process.env.NODE_ENV === 'development' &&
        this._processedToolIds.size !== this._processedToolIdQueue.length) {
      console.warn('[ChatView] processed-tool-ids invariant broken',
                   { setSize: this._processedToolIds.size, queueLen: this._processedToolIdQueue.length });
    }

    const { mainAgentSessions, requests: reqProp } = this.host.getProps();
    const sessions = mainAgentSessions || [];
    const requests = reqProp || [];
    if (sessions.length === 0 && requests.length === 0) return;

    // 用 FIFO 队列做 LRU 砍头：上限 20000（≈ 持续多日对话），砍头一次保留 15000 条；
    // 普通会话几乎不触发。避免暴力 clear() 导致残留旧 id 被重新认作新事件。
    // 同步从 _toolUseMap 删除被砍掉的 id —— 该 map 存每个 tool_use 的 {name, input}
    // （Write 的 input 是整个文件内容），不随砍头清理会在长会话里无界增长。
    if (this._processedToolIds.size > PROCESSED_TOOL_IDS_MAX) {
      const trimCount = this._processedToolIds.size - PROCESSED_TOOL_IDS_KEEP;
      const toRemove = this._processedToolIdQueue.splice(0, trimCount);
      for (const id of toRemove) {
        this._processedToolIds.delete(id);
        this._toolUseMap.delete(id);
      }
    }

    const toolUseMap = this._toolUseMap;

    // ── 两阶段增量（与原全量两 Pass 语义一致：先把本批增量的 tool_use 全部收进持久 map，
    // 再扫本批增量的 tool_result，杜绝「tool_result 先于其 tool_use 被处理 → 永久漏判」）。
    // 游标推进到 msgs.length，但对「最后一条已扫 message」重扫一次 —— 流式/v2 分流合并会把
    // 新 block 合进尾部那条已扫 message（message 数不变、content 增长），尾部重扫以 O(尾部
    // 一条) 的代价覆盖该情形，其余 message 纯增量。_processedToolIds 幂等兜底重复 block。 ──

    // 阶段 1：收集增量 tool_use（assistant messages + response.content）
    for (const session of sessions) {
      if (session.response?.body?.content) collectToolUseBlocks(session.response.body.content, toolUseMap);
      if (Array.isArray(session.messages)) {
        const msgs = session.messages;
        const scanned = this._sessScanned.get(session) || 0;
        // 长度回缩（/clear 重建该 session 的 messages）→ 从 0 重扫；否则尾部重扫一条
        // （from = scanned-1）覆盖流式/v2 分流合并进尾部那条已扫 message 的 content 增长。
        const from = scanned > msgs.length ? 0 : Math.max(0, scanned - 1);
        for (let i = from; i < msgs.length; i++) {
          const msg = msgs[i];
          if (msg.role === 'assistant') collectToolUseBlocks(msg.content, toolUseMap);
        }
      }
    }
    for (const req of requests) {
      if (req.response?.body?.content) collectToolUseBlocks(req.response.body.content, toolUseMap);
      if (Array.isArray(req.body?.messages)) {
        const msgs = req.body.messages;
        const scanned = this._reqScanned.get(req) || 0;
        const from = scanned > msgs.length ? 0 : Math.max(0, scanned - 1);
        for (let i = from; i < msgs.length; i++) {
          const msg = msgs[i];
          if (msg.role === 'assistant') collectToolUseBlocks(msg.content, toolUseMap);
        }
      }
    }

    // 阶段 2：扫增量 tool_result（user messages）触发刷新；游标在此推进
    const flags = { needFileRefresh: false, needGitRefresh: false, needContentRefresh: false };
    for (const session of sessions) {
      if (!Array.isArray(session.messages)) continue;
      const msgs = session.messages;
      const scanned = this._sessScanned.get(session) || 0;
      const from = scanned > msgs.length ? 0 : Math.max(0, scanned - 1);
      for (let i = from; i < msgs.length; i++) {
        const msg = msgs[i];
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          for (const block of msg.content) this._processToolResult(block, toolUseMap, flags);
        }
      }
      this._sessScanned.set(session, msgs.length);
    }
    for (const req of requests) {
      if (!Array.isArray(req.body?.messages)) continue;
      const msgs = req.body.messages;
      const scanned = this._reqScanned.get(req) || 0;
      const from = scanned > msgs.length ? 0 : Math.max(0, scanned - 1);
      for (let i = from; i < msgs.length; i++) {
        const msg = msgs[i];
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          for (const block of msg.content) this._processToolResult(block, toolUseMap, flags);
        }
      }
      this._reqScanned.set(req, msgs.length);
    }

    const { needFileRefresh, needGitRefresh, needContentRefresh } = flags;
    const state = this.host.getState();

    if (needFileRefresh) {
      if (state.fileExplorerOpen) {
        clearTimeout(this._fileRefreshTimer);
        this._fileRefreshTimer = setTimeout(() => {
          this.host.setState(prev => ({ fileExplorerRefresh: prev.fileExplorerRefresh + 1 }));
        }, 500);
      } else {
        // 面板关闭期间记 pending，由 _setFileExplorerOpen(true) 消费
        this.host.setPendingFileRefresh();
      }
    }
    if (needGitRefresh) {
      if (state.gitChangesOpen) {
        clearTimeout(this._gitRefreshTimer);
        this._gitRefreshTimer = setTimeout(() => {
          this.host.setState(prev => ({ gitChangesRefresh: prev.gitChangesRefresh + 1 }));
        }, 500);
      } else {
        this.host.setPendingGitRefresh();
      }
    }
    if (needContentRefresh) {
      clearTimeout(this._contentRefreshTimer);
      this._contentRefreshTimer = setTimeout(() => {
        this.host.setState(prev => ({ fileVersion: prev.fileVersion + 1 }));
      }, 500);
    }
  }

  dispose() {
    if (this._fileRefreshTimer) clearTimeout(this._fileRefreshTimer);
    if (this._gitRefreshTimer) clearTimeout(this._gitRefreshTimer);
    if (this._contentRefreshTimer) clearTimeout(this._contentRefreshTimer);
  }
}
