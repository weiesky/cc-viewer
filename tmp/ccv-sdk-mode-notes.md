# CC-Viewer SDK Mode — 研究笔记与待办

> 最后更新：2026-04-04
> 状态：实验性（`ccv -SDK` 显式启用，默认仍为 PTY 模式）

## 1. 当前架构

```
PTY 模式（默认 ccv）:
  cli.js → proxy.js → server.js → pty-manager.js → PTY
  权限审批: hooks → perm-bridge.js → HTTP long-poll → WS → ToolApprovalPanel
  AskUserQuestion: hooks → ask-bridge.js → HTTP long-poll → WS → 聊天卡片

SDK 模式（ccv -SDK）:
  cli.js → server.js → sdk-manager.js → @anthropic-ai/claude-agent-sdk query()
  权限审批: canUseTool() → WS → ToolApprovalPanel
  AskUserQuestion: canUseTool() → WS → 聊天卡片
  无终端、无代理、无 interceptor
```

## 2. 已完成

- [x] `lib/sdk-manager.js` — 核心 SDK 封装（query、canUseTool、streaming）
- [x] `lib/sdk-adapter.js` — SDK 消息 → JSONL 条目格式转换
- [x] `cli.js` — `-SDK`/`--sdk` 启动模式，runSdkMode()
- [x] `server.js` — SDK exports（pushSdkEntry、setSdkStreamingState、broadcastWsMessage 等）
- [x] 前端 sdkMode prop 传递（AppBase → App/Mobile → ChatView）
- [x] SDK 模式下 AskUserQuestion 通过 canUseTool → sdk-ask-pending/answer
- [x] SDK 模式下权限审批通过 canUseTool → perm-hook-pending/answer
- [x] ExitPlanMode 通过 canUseTool → sdk-plan-pending/answer
- [x] "本次会话允许" 按钮（updatedPermissions + suggestions）
- [x] bypassPermissions 模式 + allowDangerouslySkipPermissions
- [x] SDK 不可用时自动 fallback 到 PTY 模式
- [x] @anthropic-ai/claude-agent-sdk 在 optionalDependencies

## 3. 已修复的 Bug（5 轮 review）

### Critical
| Bug | 修复 |
|-----|------|
| 每个 entry 的 timestamp 不同导致前端无法去重 | 稳定 `_turnTimestamp` 每轮只生成一次 |
| `body.messages` 包含 assistant 响应导致消息重复 | 先快照 requestMessages 再 push assistant |
| 无并发保护，两个 query 同时运行 | `_queryBusy` + `_messageQueue` 队列 |
| `interrupt()` 在非 streaming 模式无效 | 改为 `close()` |
| `allowDangerouslySkipPermissions` 缺失 | bypass 模式时传递 |

### High
| Bug | 修复 |
|-----|------|
| `--ad` 错误映射为 bypassPermissions | 只有 `--d` 映射，`--ad` 保持 default |
| `is_replay` → `isReplay` | 驼峰命名修正 |
| SDK 43MB 强依赖 | 改为 optionalDependencies |
| WS 断连不清除审批状态 | onclose 清除所有 5 个状态 |

### Medium
| Bug | 修复 |
|-----|------|
| `stopSession()` 不重置状态 | `_resetFullState()` 全清 |
| compact_boundary 不处理 | 收到后清空 `_accumulatedMessages` |
| 连续同 role 消息 | 自动合并 content blocks |
| AskUserQuestion 从 entry 和 canUseTool 双重渲染 | response.body 过滤 + Last Response historyAskIds 去重 |
| 对话历史中过滤 AskUserQuestion 导致孤儿 tool_result | body.messages 不过滤历史，只过滤 response.body |

## 4. 已知限制（SDK 模式）

### 无终端视图
- SDK 通过 stdio JSON 通信，无 ANSI 输出
- xterm.js 无内容可渲染
- 终端切换按钮在 SDK 模式下隐藏

### System Prompt 不可见
- SDKSystemMessage 不暴露真实 system prompt
- entry 的 `body.system` 是 stub：`[{ type: 'text', text: 'You are Claude Code' }]`
- `isMainAgent()` 检测依赖 `mainAgent: true` 标志（不依赖 system prompt 内容）

### Tools 列表
- SDKSystemMessage 暴露 `tools: string[]`（工具名称数组）
- 已转换为 `{ name: string }[]` 格式传入 entry
- 但不包含工具的 input_schema（只有名称）

### 对话历史
- `_accumulatedMessages` 是本地累积，不包含 SDK 内部的完整历史
- resume 后 SDK 自动加载历史，但本地 `_accumulatedMessages` 只有当前运行时的消息
- compact_boundary 后本地历史被清空（正确行为——SDK 内部已压缩）

### 流式输出
- 已实现：`includePartialMessages: true` + `_processStreamEvent` + 100ms 节流
- 但 `maxThinkingTokens` 显式设置时 stream events 不发送（SDK 限制）

## 5. 待研究 / 下一步

### P0 — 基本流程稳定性
- [ ] 多轮对话实际测试（resume 是否稳定？session_id 是否正确传递？）
- [ ] 长对话测试（compact_boundary 触发后是否正常？）
- [ ] 错误恢复（SDK query 抛异常后能否重新 sendUserMessage？）
- [ ] 网络断连恢复（SSE 重连后 SDK 状态是否一致？）

### P1 — 功能完善
- [ ] ExitPlanMode 专用 UI（显示计划内容 + 反馈输入，不只是 Allow/Deny）
- [ ] SDKToolProgressMessage 处理（工具执行进度显示）
- [ ] SDKRateLimitEvent 处理（速率限制提示）
- [ ] SDKToolUseSummaryMessage 处理（工具使用摘要）
- [ ] 浏览器刷新后历史恢复（当前 SDK 模式无日志文件，刷新丢失所有历史）

### P2 — 体验优化
- [ ] SDK 模式下的 /help /compact /model /cost 等终端命令替代方案
- [ ] 进度指示器（替代终端中的 spinner/进度条）
- [ ] 子代理消息显示（parent_tool_use_id 非 null 的 assistant 消息）
- [ ] SDKPromptSuggestionMessage 处理（建议下一条提示）
- [ ] V2 Session API（`unstable_v2_createSession`）评估——更简洁的多轮 API

### P3 — 架构演进
- [ ] SDK 模式作为默认（当足够稳定时）
- [ ] 统一 PTY 和 SDK 的权限审批 UI（当前两套并行）
- [ ] 移除 ask-bridge.js / perm-bridge.js 依赖（全面 SDK 化）
- [ ] SDK 模式下的终端模拟（将 SDK 事件渲染为终端风格输出）

## 6. Agent SDK API 参考

### 包信息
```
npm: @anthropic-ai/claude-agent-sdk
版本: ^0.2.91
类型定义: sdk.d.ts
```

### 核心 API
```typescript
// 启动查询
import { query } from '@anthropic-ai/claude-agent-sdk';
const q = query({ prompt: string, options: Options });
for await (const msg of q) { /* SDKMessage */ }

// 恢复会话
query({ prompt: 'follow up', options: { resume: sessionId } })

// 权限回调
canUseTool: async (toolName, input, options) => {
  // options.toolUseID — 唯一工具调用 ID
  // options.suggestions — PermissionUpdate[] 用于 "记住权限"
  return { behavior: 'allow', updatedInput } | { behavior: 'deny', message }
}

// 终止会话
q.close(); // 所有模式下有效（不用 interrupt()）
```

### SDKMessage 类型（21 种）
```
SDKAssistantMessage      — 完整 assistant 响应（.message: BetaMessage）
SDKUserMessage           — 用户消息 / tool_result
SDKUserMessageReplay     — 重放消息（.isReplay: true）
SDKResultMessage         — 最终结果
SDKSystemMessage         — 初始化（.model, .tools, .session_id）
SDKPartialAssistantMessage — 流式事件（.event: BetaRawMessageStreamEvent）
SDKCompactBoundaryMessage — 压缩边界
SDKStatusMessage         — 状态更新
SDKLocalCommandOutputMessage — 斜杠命令输出
SDKHookStartedMessage    — Hook 开始
SDKHookProgressMessage   — Hook 进度
SDKHookResponseMessage   — Hook 完成
SDKToolProgressMessage   — 工具进度
SDKAuthStatusMessage     — 认证状态
SDKTaskNotificationMessage — 后台任务通知
SDKTaskStartedMessage    — 后台任务开始
SDKTaskProgressMessage   — 后台任务进度
SDKFilesPersistedEvent   — 文件持久化
SDKToolUseSummaryMessage — 工具使用摘要
SDKRateLimitEvent        — 速率限制
SDKPromptSuggestionMessage — 提示建议
```

### SDKSystemMessage 字段
```typescript
{
  type: 'system',
  subtype: 'init',
  session_id: string,
  model: string,
  tools: string[],           // 工具名称数组（不是 schema）
  permissionMode: PermissionMode,
  claude_code_version: string,
  cwd: string,
  mcp_servers: { name, status }[],
  slash_commands: string[],
  skills: string[],
  plugins: { name, path }[],
}
// 注意：没有 system prompt 字段
```

### PermissionMode
```typescript
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
```

### Options 关键字段
```typescript
{
  cwd?: string,
  includePartialMessages?: boolean,
  permissionMode?: PermissionMode,
  canUseTool?: CanUseTool,
  allowDangerouslySkipPermissions?: boolean,  // bypassPermissions 时必须
  resume?: string,                             // session ID
  allowedTools?: string[],
  disallowedTools?: string[],
  tools?: string[] | { type: 'preset', preset: 'claude_code' },
  systemPrompt?: string | { type: 'preset', preset: 'claude_code', append?: string },
  maxTurns?: number,
  maxBudgetUsd?: number,
  model?: string,
  hooks?: HookConfig,
  mcpServers?: Record<string, McpServerConfig>,
  agents?: Record<string, AgentDefinition>,
}
```

## 7. 文件清单

| 文件 | 用途 | 模式 |
|------|------|------|
| `lib/sdk-manager.js` | SDK 会话生命周期管理 | SDK only |
| `lib/sdk-adapter.js` | SDK 消息 → JSONL 转换 | SDK only |
| `lib/ask-bridge.js` | AskUserQuestion hook bridge | PTY only |
| `lib/perm-bridge.js` | 权限审批 hook bridge | PTY only |
| `cli.js` | 入口：runCliMode / runSdkMode | 共用 |
| `server.js` | HTTP/SSE/WS 服务 + SDK exports | 共用 |
| `src/components/ToolApprovalPanel.jsx` | 权限审批面板组件 | 共用 |
| `src/components/ChatView.jsx` | 聊天视图（含 SDK 路由） | 共用 |
