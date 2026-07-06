# Claude Agent SDK 调研报告

> 调研日期：2026-03-22
> 目的：评估 Agent SDK 在 cc-viewer 中的可行性和能力边界

---

## 一、概述

Claude Agent SDK 是 Anthropic 提供的编程接口（TypeScript / Python），用于以代码方式驱动 Claude Code 的全部能力。

**本质实现**：SDK 内部 spawn Claude Code CLI 子进程，通过 stdin/stdout 以 JSON-lines 格式通信。SDK 包内**自带打包了 Claude Code CLI 二进制文件**，无需单独安装。

```
你的代码 → SDK → spawn claude CLI 子进程 → CLI 调 Anthropic API
                    ↑ stdin (JSON)
                    ↓ stdout (JSON-lines)
```

### 安装

```bash
# TypeScript
npm install @anthropic-ai/claude-agent-sdk

# Python
pip install claude-agent-sdk
```

### 认证

```bash
export ANTHROPIC_API_KEY=your-api-key
```

- 仅支持 API Key 认证（API 计费），不支持 Pro/Max 登录态
- 可选：Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`)、Vertex (`CLAUDE_CODE_USE_VERTEX=1`)、Azure (`CLAUDE_CODE_USE_FOUNDRY=1`)

---

## 二、核心 API：`query()`

### 基本用法

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "your task",
  options: { ... }
})) {
  console.log(message);
}
```

```python
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="your task",
    options=ClaudeAgentOptions(...)
):
    print(message)
```

### 完整参数

```typescript
query({
  prompt: string | AsyncIterable<SDKUserMessage>,
  options: {
    // 工具控制
    allowedTools: ["Read", "Edit", "Bash", ...],
    disallowedTools: ["WebSearch"],

    // 权限模式
    permissionMode: "default" | "dontAsk" | "acceptEdits" | "bypassPermissions" | "plan",
    canUseTool: customCallback,    // 自定义权限回调

    // System Prompt
    systemPrompt: string | { type: "preset", preset: "claude_code", append: "额外指令" },

    // 资源限制
    maxTurns: 50,
    maxBudgetUsd: 10.0,

    // 结构化输出
    outputFormat: { type: "json_schema", schema: {...} },

    // 工作目录
    cwd: "/path/to/project",
    addDirs: ["/other/dir"],
    env: { KEY: "value" },

    // Hooks
    hooks: { ... },

    // 子代理
    agents: { ... },

    // MCP 服务器
    mcpServers: { ... },

    // 会话管理
    resume: "session-id",
    forkSession: true,
    continue: true,

    // 流式输出
    includePartialMessages: true,
  }
})
```

### 消息类型

| 类型 | 说明 | 关键字段 |
|---|---|---|
| `SystemMessage` (init) | 会话初始化 | `session_id`, `cwd`, `mcp_servers` |
| `AssistantMessage` | Claude 回复 | text blocks, tool_use blocks, thinking blocks |
| `ToolResultMessage` | 工具执行结果 | tool output |
| `ResultMessage` | 最终结果 | `total_cost_usd`, `usage`, `structured_output`, `subtype` |
| `StreamEvent` | 实时流事件 | 需 `includePartialMessages: true` |
| `CompactBoundaryMessage` | 上下文压缩标记 | |

ResultMessage.subtype 值：`success` | `error_max_turns` | `error_max_budget_usd` | `error_max_structured_output_retries` | `error_during_execution` | `user_interrupted`

---

## 三、Hooks 系统（原生回调）

SDK 的 hooks 是**原生异步函数**（不是 CLI 的 shell 脚本），每次工具调用时实时执行。

### 可用事件

| Hook 事件 | 能力 | Python | TypeScript |
|---|---|---|---|
| **PreToolUse** | 拦截/修改/拒绝工具调用 | ✅ | ✅ |
| **PostToolUse** | 观察结果，追加上下文 | ✅ | ✅ |
| **PostToolUseFailure** | 处理工具失败 | ✅ | ✅ |
| **UserPromptSubmit** | 修改 prompt | ✅ | ✅ |
| **Stop** | 阻止 Claude 停止，强制继续 | ✅ | ✅ |
| **SubagentStart** | 子代理启动 | ✅ | ✅ |
| **SubagentStop** | 子代理完成 | ✅ | ✅ |
| **PermissionRequest** | 自动批准/拒绝权限 | ✅ | ✅ |
| **PreCompact** | 上下文压缩前 | ✅ | ✅ |
| **Notification** | 状态通知 | ✅ | ✅ |
| **SessionStart** | 会话启动 | ❌ | ✅ |
| **SessionEnd** | 会话结束 | ❌ | ✅ |

### Hook 签名

```typescript
async function myHook(
  input: HookInput,              // 事件数据
  toolUseID: string | undefined, // 关联 PreToolUse/PostToolUse
  { signal }: { signal: AbortSignal }
): Promise<HookOutput> {
  return {};
}
```

```python
async def my_hook(
    input_data: dict,
    tool_use_id: str | None,
    context: HookContext
) -> dict:
    return {}
```

### Hook 输入数据

**PreToolUseHookInput**：
- `hook_event_name: "PreToolUse"`
- `tool_name: string` — "Read", "Bash", "Write" 等
- `tool_input: Record<string, unknown>` — 工具参数
- `session_id`, `cwd`, `agent_id?`, `agent_type?`

**PostToolUseHookInput**：
- 同上 + `tool_result: string`

### Hook 输出

```typescript
{
  // 注入消息到对话（模型可见）
  systemMessage?: string,

  // 是否继续执行
  continue?: boolean,

  // Hook 特定输出
  hookSpecificOutput?: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow" | "deny" | "ask",
    permissionDecisionReason?: string,
    updatedInput?: Record<string, unknown>  // 修改工具输入（需 allow）
  }
}
```

PostToolUse 的 hookSpecificOutput：`{ additionalContext?: string }`
UserPromptSubmit 的 hookSpecificOutput：`{ updatedPrompt?: string }`

### 配置方式

```typescript
hooks: {
  PreToolUse: [
    { matcher: "Bash", hooks: [validateCommand] },       // 只拦截 Bash
    { matcher: "Write|Edit", hooks: [logChanges] },      // 拦截写操作
    { matcher: "^mcp__", hooks: [logMcp] },              // 拦截所有 MCP 工具
  ],
  PostToolUse: [
    { hooks: [auditLogger] }                             // 不加 matcher，拦截所有
  ]
}
```

### 动态行为控制

**Hook 注册在初始化时固定，但 hook 内部逻辑可以实时动态**（闭包读外部变量）：

```typescript
let mode = "terminal";  // 外部随时可改

async function handleAskUser(input, toolUseId) {
  // 每次 AskUserQuestion 被调用时实时读取 mode
  if (mode === "terminal") return {};  // 放行内置工具

  // custom-ui 模式：拦截 → 推送前端 → 等回传
  const { question, options } = input.tool_input;
  bridge.emit("ask-user", { toolUseId, question, options });
  const answer = await new Promise(resolve => {
    bridge.once(`user-answer:${toolUseId}`, resolve);
  });
  return {
    systemMessage: `[User responded via custom UI]: ${answer}`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Handled by custom UI"
    }
  };
}
```

### 哪些能动态改，哪些不能

| 配置项 | 能否中途改 | 说明 |
|---|---|---|
| hook 内部逻辑 | ✅ | 闭包读外部变量 |
| `permissionMode` | ✅ | `setPermissionMode()` API |
| `disallowedTools` | ❌ | 初始化固定 |
| `allowedTools` | ❌ | 初始化固定 |
| `mcpServers` | ❌ | 初始化固定 |
| `systemPrompt` | ❌ | 初始化固定 |
| `agents` 定义 | ❌ | 初始化固定 |
| hook 注册 | ❌ | 初始化固定 |

---

## 四、自定义工具（In-process MCP）

```typescript
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const server = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool(
      "query_db",
      "Query the database",
      { sql: z.string() },
      async (args) => {
        const result = await db.execute(args.sql);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
    )
  ]
});

// 使用
query({
  prompt: "...",
  options: {
    mcpServers: { "my-tools": server },
    allowedTools: ["mcp__my-tools__query_db"]
  }
});
```

工具命名格式：`mcp__{server_name}__{tool_name}`

### 外部 MCP 服务器

```typescript
// Stdio 方式
mcpServers: {
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
  }
}

// HTTP 方式
mcpServers: {
  remote: {
    type: "http",
    url: "https://api.example.com/mcp",
    headers: { Authorization: `Bearer ${token}` }
  }
}
```

---

## 五、子代理系统

```typescript
query({
  prompt: "Review the auth module",
  options: {
    allowedTools: ["Read", "Grep", "Agent"],
    agents: {
      "code-reviewer": {
        description: "Code review expert",
        prompt: "Analyze code quality and security",
        tools: ["Read", "Grep", "Glob"],
        model: "opus"    // 可指定不同模型
      },
      "test-runner": {
        description: "Test execution agent",
        prompt: "Run tests and fix failures",
        tools: ["Bash", "Read"],
        model: "sonnet"
      }
    }
  }
});
```

- 多个子代理可**并行执行**
- 子代理**不能嵌套**（不能再 spawn 子代理）
- 可通过 `agentId` 恢复之前的子代理
- 子代理继承 CLAUDE.md 但不继承父对话历史

---

## 六、会话管理

```typescript
// 1. 捕获 session_id
let sessionId;
for await (const msg of query({ prompt: "first task", options })) {
  if (msg.type === "result") sessionId = msg.session_id;
}

// 2. 恢复会话
for await (const msg of query({
  prompt: "follow-up",
  options: { resume: sessionId }
})) { ... }

// 3. Fork 会话（保留历史，创建新分支）
for await (const msg of query({
  prompt: "try differently",
  options: { resume: sessionId, forkSession: true }
})) { ... }

// 4. Continue 最近会话（TypeScript）
for await (const msg of query({
  prompt: "next step",
  options: { continue: true }
})) { ... }

// 5. Python ClaudeSDKClient（自动会话跟踪）
async with ClaudeSDKClient(options=options) as client:
    await client.query("first")
    async for msg in client.receive_response(): ...
    await client.query("follow-up")  # 同一会话
```

---

## 七、结构化输出

```typescript
const schema = {
  type: "object",
  properties: {
    bugs: { type: "array", items: {
      type: "object",
      properties: {
        file: { type: "string" },
        line: { type: "number" },
        severity: { type: "string", enum: ["low", "medium", "high"] },
        description: { type: "string" }
      }
    }}
  }
};

for await (const msg of query({
  prompt: "Find bugs in src/",
  options: {
    outputFormat: { type: "json_schema", schema }
  }
})) {
  if (msg.type === "result" && msg.structured_output) {
    // msg.structured_output 保证符合 schema
  }
}
```

**注意**：结构化输出与 extended thinking 互斥。

---

## 八、权限模式

| 模式 | 行为 |
|---|---|
| `default` | 不自动批准，调用 `canUseTool` 回调 |
| `dontAsk` (仅 TS) | 拒绝不在 allowedTools 中的工具 |
| `acceptEdits` | 自动批准文件编辑 |
| `bypassPermissions` | 自动批准所有（除 disallowedTools） |
| `plan` | 禁止工具执行，只输出计划 |

```typescript
// 自定义权限回调
canUseTool: async (toolName, input, context) => {
  if (toolName === "Bash" && /rm/.test(input.command)) {
    return { type: "deny", message: "Dangerous command" };
  }
  return { type: "allow" };
}
```

**注意**：`allowedTools` 在 `bypassPermissions` 模式下无效！要限制工具必须用 `disallowedTools`。

---

## 九、System Prompt 控制

```typescript
// 方式 1：追加到 Claude Code 预设
systemPrompt: {
  type: "preset",
  preset: "claude_code",
  append: "Always write tests for new code."
}

// 方式 2：完全替换
systemPrompt: "You are a Python specialist..."

// 方式 3：CLAUDE.md（需要 settingSources）
options: {
  systemPrompt: { type: "preset", preset: "claude_code" },
  settingSources: ["project"]  // 才会读取 CLAUDE.md
}
```

---

## 十、资源控制与成本追踪

```typescript
options: {
  maxTurns: 50,
  maxBudgetUsd: 10.0,
}

// 成本追踪
for await (const msg of query(...)) {
  if (msg.type === "result") {
    console.log(`Cost: $${msg.total_cost_usd}`);
    console.log(`Usage:`, msg.usage);
    // usage: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
  }
}
```

---

## 十一、Transport 自定义

SDK 默认用 `SubprocessCLITransport`（spawn 内置 CLI）。可自定义：

```python
class Transport(ABC):
    async def connect(self) -> None: ...
    async def write(self, data: str) -> None: ...
    def read_messages(self) -> AsyncIterator[dict]: ...
    async def close(self) -> None: ...
    def is_ready(self) -> bool: ...
    async def end_input(self) -> None: ...
```

可选指定 CLI 路径：`ClaudeAgentOptions(cli_path="/custom/path/to/claude")`

---

## 十二、cc-viewer CLI 模式 vs Agent SDK 对比

| | cc-viewer CLI 模式 (PTY) | Agent SDK |
|---|---|---|
| 子进程 | PTY spawn claude | stdio spawn claude |
| 通信协议 | 终端原始输出 + fetch 拦截 | 结构化 JSON-lines |
| 工具调用可见性 | 通过 fetch 拦截间接获取 | 每个 tool_use/tool_result 都是结构化消息 |
| 控制能力 | 只能观察，难以干预 | hooks 可拦截/修改/拒绝 |
| 用户交互 | Terminal 原生 | 可自定义（如 AskUserQuestion） |
| 认证 | 用户 claude 登录态（Pro/Max） | 必须 ANTHROPIC_API_KEY（API 计费） |
| Terminal 体验 | ✅ 完整保留 | ❌ 无 Terminal |

### 推荐路线：混合模式

```
ccv run --mode cli   → 现有 PTY 模式（Pro/Max，终端体验）
ccv run --mode sdk   → Agent SDK 模式（API Key，完全自定义 UI）
```

---

## 十三、能力边界（任何机制都做不到的）

1. **无法控制推理** — 不能强制 Claude 用特定工具或做特定决策
2. **无法改对话历史** — 消息一旦发出不可修改
3. **无法从 hook 内注入 system prompt** — 只能通过初始化参数
4. **无法热更新配置** — allowedTools/disallowedTools/mcpServers/systemPrompt/agents 均初始化固定
5. **无法保证工具执行** — 只能拒绝，不能强制使用
6. **无法跨会话同步状态** — memory 是本地的
7. **子代理不能嵌套** — 只有一层

---

## 十四、参考链接

- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [Hooks Guide](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [MCP Integration](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Structured Outputs](https://platform.claude.com/docs/en/agent-sdk/structured-outputs)
- [Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [System Prompts](https://platform.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [Streaming Output](https://platform.claude.com/docs/en/agent-sdk/streaming-output)
- [npm: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [PyPI: claude-agent-sdk](https://pypi.org/project/claude-agent-sdk/)
- [GitHub: claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python)
- [GitHub: claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
