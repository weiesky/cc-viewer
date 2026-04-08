# Agent Team 模式调研报告

> 调研日期: 2026-03-17 | cc-viewer 版本: 1.5.44 | Claude Code 版本: 2.1.76

## 1. 核心结论

当 Agent Team 模式开启时，MainAgent 的 API 请求结构**不会发生任何变化**。Leader 和普通 MainAgent 在请求层面完全相同（相同的 system prompt、相同的 61 个工具）。区分只能通过**行为检测**（是否调用了 TeamCreate）和 **Teammate 的 system prompt 标记**。

Teammate 默认通过 **tmux splitpane** 作为独立 Claude Code 进程生成，不在主进程内运行。

## 2. 三层角色模型

```
Solo 模式:
  MainAgent ──→ SubAgent (Explore/Bash/Plan/General)

Team 模式:
  LeaderAgent (= MainAgent 调用了 team 工具)
    ├── SubAgent (Explore/Bash/Plan/General)     ← interceptor 可捕获
    └── Teammate (独立 claude CLI 进程, tmux)     ← 仅 proxy 模式可捕获
          └── SubAgent                            ← 仅 proxy 模式可捕获
```

## 3. Teammate 生成机制

### 3.1 Spawn Dispatcher（源码 cli.js）

```javascript
// 三条路径，默认走 splitpane (tmux)
async function spawnTeammate(A, q) {
  if (isRemoteBackend()) return spawnRemote(A, q);
  if (A.use_splitpane !== false) return spawnSplitpane(A, q);  // ← 默认
  return spawnInProcess(A, q);                                  // fallback
}
```

### 3.2 tmux 启动命令

```bash
tmux send-keys -t "session:window" \
  "cd /path/to/worktree && \
   env CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
       ANTHROPIC_BASE_URL=... \
   claude --agent-id xxx --agent-name worker-1 \
          --team-name fix-ts-errors --agent-color red \
          --parent-session-id yyy" Enter
```

### 3.3 转发的环境变量

```javascript
// getTeammateEnvVars() 转发列表
[
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_BASE_URL",     // ← 关键: proxy 模式的代理地址会被转发
  "CLAUDE_CONFIG_DIR"
]
```

### 3.4 Teammate 的 backendType

| 模式 | backendType | tmuxPaneId | 进程模型 |
|------|-------------|------------|----------|
| splitpane (默认) | `"tmux"` | 实际 pane ID | 独立 claude CLI 进程 |
| in-process | `"in-process"` | `"in-process"` | 同进程内 |

## 4. Teammate 的 System Prompt 标记

Teammate 的 system prompt = 标准 "You are Claude Code" + 以下 addendum:

```
# Agent Teammate Communication

IMPORTANT: You are running as an agent in a team. To communicate with anyone on your team:
- Use the SendMessage tool with `to: "<name>"` to send messages to specific teammates
- Use the SendMessage tool with `to: "*"` sparingly for team-wide broadcasts

Just writing a response in text is not visible to others on your team -
you MUST use the SendMessage tool.

The user interacts primarily with the team lead.
Your work is coordinated through the task system and teammate messaging.
```

**检测正则**: `/You are running as an agent in a team/i`

## 5. Interceptor 可见性分析

### 5.1 `CCV_PROXY_MODE` 环境变量机制

interceptor.js 中有关键的防重复逻辑：

```javascript
// interceptor.js 第 497 行
if (!_ccvSkip && !process.env.CCV_PROXY_MODE) setupInterceptor();

// interceptor.js 第 501 行
if (!_ccvSkip && !process.env.CCV_PROXY_MODE) {
  _initPromise.then(() => import('./server.js'));  // 启动 web viewer
}
```

`CCV_PROXY_MODE=1` 时，interceptor **既不 patch fetch，也不启动 server**。

设置 `CCV_PROXY_MODE` 的位置：
- `cli.js:232` — proxy 模式 (`ccv run -- claude`) 传给 claude 子进程
- `cli.js:286` — 设置到当前进程
- `pty-manager.js:116` — PTY 模式传给子进程

**关键：`CCV_PROXY_MODE` 不在 teammate 的环境变量转发列表中**，所以 teammate 进程中该变量为 undefined。

### 5.2 两种模式对比（修正版）

~~之前的结论认为 NPM 注入模式下 teammate 不可见，这是错误的。~~

NPM 注入模式通过 `injectCliJs()` 直接修改 `@anthropic-ai/claude-code/cli.js` 文件，在第 3 行插入：

```javascript
import '../../cc-viewer/interceptor.js';
```

这是**文件级别的修改**。当 teammate 通过 tmux 启动新的 `claude` 进程时，加载的是**同一个被修改过的 cli.js**，interceptor 也会被加载。又因为 `CCV_PROXY_MODE` 不在转发列表中，teammate 进程中该变量为 undefined，所以 `setupInterceptor()` 和 `server.js` 都会执行。

| cc-viewer 模式 | Leader | SubAgent | Teammate | Teammate 的 SubAgent |
|----------------|--------|----------|----------|---------------------|
| NPM 注入模式 | ✅ 日志A + server A | ✅ 日志A | ✅ 日志B + server B | ✅ 日志B |
| Native Proxy 模式 | ✅ 统一 proxy 日志 | ✅ 统一 proxy 日志 | ✅ 统一 proxy 日志 | ✅ 统一 proxy 日志 |

**两种模式都能捕获 teammate 请求。** 区别在于：

- **NPM 注入模式**：teammate 的 interceptor 独立运行，会创建**独立的日志文件**（`generateNewLogFilePath()` 基于时间戳生成）和**独立的 web viewer server**（不同端口）。Leader 的 cc-viewer 界面只读 leader 的日志，看不到 teammate 的请求。需要日志合并机制。
- **Native Proxy 模式**：所有请求（leader + teammate）都走同一个 proxy，写入**同一个日志文件**。这是最理想的方案。

### 5.3 NPM 注入模式下 teammate 的完整链路

```
Leader 进程:
  cli.js (已注入 import interceptor.js)
  → CCV_PROXY_MODE 未设置
  → setupInterceptor() 执行 → fetch 被 patch
  → server.js 启动 (端口 A)
  → 日志写入 ~/.claude/cc-viewer/{project}/{project}_{ts_A}.jsonl

Teammate 进程 (tmux spawn, 同一个 cli.js):
  cli.js (同样有 import interceptor.js)
  → CCV_PROXY_MODE 未设置（��在转发列表中）
  → setupInterceptor() 执行 → fetch 被 patch
  → server.js 启动 (端口 B, 不同端口)
  → 日志写入 ~/.claude/cc-viewer/{project}/{project}_{ts_B}.jsonl  ← 不同文件！
```

### 5.4 Native Proxy 模式下 teammate 的完整链路

```
ccv run -- claude (启动 proxy server, 端口 P)
  → ANTHROPIC_BASE_URL=http://127.0.0.1:P
  → CCV_PROXY_MODE=1 传给 claude 子进程
  → claude 子进程的 interceptor 跳过（不 patch, 不启动 server）
  → 所有请求走 proxy → 统一日志

Teammate 进程 (tmux spawn):
  → ANTHROPIC_BASE_URL=http://127.0.0.1:P (从转发列表继承)
  → CCV_PROXY_MODE 未设置（不在转发列表中）
  → 如果是 npm 版本: interceptor 会运行（双重捕获: proxy + 本地 patch）
  → 如果是 native 版本: 无 interceptor，请求走 proxy
  → 两种情况下 proxy 都能捕获 ✅
```

### 5.5 实证数据

扫描所有 interceptor 日志（9 个文件，~970MB）：
- TeamCreate tool_use 实际调用: **0**（工具定义存在但从未调用）
- Teammate 请求（含 addendum 标记）: **0**
- 结论: 尚未在 interceptor 运行时执行过真正的 Agent Team 会话
- **之前看不到 teammate 的原因不是技术限制，而是从未跑过 team 会话**

### 5.6 NPM 注入模式的日志分散问题

NPM 注入模式下 teammate 日志写入独立文件，cc-viewer 需要：
1. 识别同一 team session 的多个日志文件（通过时间窗口 + team_name 关联）
2. 合并展示 leader 和 teammate 的请求时间线
3. 或者考虑让 teammate 的 interceptor 复用 leader 的日志文件（需要文件锁机制）

## 6. 当前 isMainAgent() 的问题

```javascript
// contentFilter.js - 当前逻辑
export function isMainAgent(req) {
  // 1. 检查 mainAgent 标记
  // 2. 检查 "You are Claude Code"
  // 3. 排除 SUBAGENT_SYSTEM_RE
  // 4. 检查工具数量和核心工具
}
```

**问题**: Teammate 会通过所有检查，被错误分类为 MainAgent。

| 检测条件 | Leader | Teammate | Solo MainAgent |
|----------|--------|----------|----------------|
| `"You are Claude Code"` | ✅ | ✅ | ✅ |
| 不匹配 SUBAGENT_SYSTEM_RE | ✅ | ✅ | ✅ |
| tools > 10 + Edit + Bash + Agent | ✅ | ✅ | ✅ |
| `TEAMMATE_SYSTEM_PROMPT_ADDENDUM` | ❌ | ✅ | ❌ |
| 实际调用 TeamCreate | ✅ | ❌ (运行时禁止) | ❌ |

## 7. 建议的分类方案

### 7.1 请求级检测（requestType.js）

```javascript
const TEAMMATE_RE = /You are running as an agent in a team/i;

export function classifyRequest(req, nextReq) {
  const sysText = getSystemText(req.body || {});

  // 新增: Teammate 检测（优先于 MainAgent）
  if (sysText.includes('You are Claude Code') && TEAMMATE_RE.test(sysText)) {
    return { type: 'Teammate', subType: null };
  }

  if (isMainAgent(req)) {
    return { type: 'MainAgent', subType: null };
  }
  // ... 其余逻辑不变
}
```

### 7.2 Session 级 Leader 检测

Leader vs Solo MainAgent 需要在 session 级别追踪行为:

```javascript
// 在 session 状态中追踪
if (response.body?.content?.some(b =>
  b.type === 'tool_use' && b.name === 'TeamCreate'
)) {
  session.isLeader = true;
}
```

### 7.3 完整分类体系

```
type: 'LeaderAgent'  — MainAgent + session 中调用过 TeamCreate
type: 'MainAgent'    — 普通 solo 模式的主 agent
type: 'Teammate'     — system prompt 含 TEAMMATE_SYSTEM_PROMPT_ADDENDUM
type: 'SubAgent'     — 匹配 SUBAGENT_SYSTEM_RE (Bash/Search/Plan/General)
type: 'Count'        — token 计数请求
type: 'Preflight'    — 预检请求
type: 'Plan'         — 计划相关请求
```

## 8. OMC Team Skill 的 Pipeline 架构

```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

| Stage | 核心 Agent | 可选 Agent |
|-------|-----------|-----------|
| team-plan | explore (haiku), planner (opus) | analyst, architect |
| team-prd | analyst (opus) | critic |
| team-exec | executor (sonnet) | debugger, designer, writer, test-engineer |
| team-verify | verifier (sonnet) | security-reviewer, code-reviewer (opus) |
| team-fix | executor (sonnet) | debugger |

## 9. Team 通信机制

- 消息通过**文件系统**持久化，每个 agent 有独立的 inbox 文件
- 存储位置: `~/.claude/teams/{team-name}/`
- Leader 通过 `SendMessage` 工具发送消息，teammate 通过同一工具回复
- `TeamCreate` / `TeamDelete` 仅 leader 可用
- Teammate 不能 spawn 其他 teammate（roster 是扁平的）

## 10. 源码关键位置索引

便于下次继续调研时快速定位：

| 内容 | 文件 | 位置 |
|------|------|------|
| Teammate spawn dispatcher (3条路径) | `@anthropic-ai/claude-code/cli.js` | 搜索 `spawnInProcessTeammate` |
| Teammate 环境变量转发列表 | `@anthropic-ai/claude-code/cli.js` | 搜索 `getTeammateEnvVars` 或 `CLAUDE_CODE_USE_BEDROCK` 附近的数组 |
| TEAMMATE_SYSTEM_PROMPT_ADDENDUM | `@anthropic-ai/claude-code/cli.js` | 搜索 `running as an agent in a team` |
| Teammate 不能 spawn teammate 的限制 | `@anthropic-ai/claude-code/cli.js` | 搜索 `teammates cannot spawn` |
| tmux send-keys 启动命令 | `@anthropic-ai/claude-code/cli.js` | 搜索 `send-keys.*Enter` |
| Team config 文件读写 | `@anthropic-ai/claude-code/cli.js` | 搜索 `config.json` + `members` |
| CCV_PROXY_MODE 防重复逻辑 | `cc-viewer/interceptor.js:497` | `if (!_ccvSkip && !process.env.CCV_PROXY_MODE)` |
| CCV_PROXY_MODE 设置位置 | `cc-viewer/cli.js:232` | `env.CCV_PROXY_MODE = '1'` |
| isMainAgent 分类逻辑 | `cc-viewer/src/utils/contentFilter.js` | `export function isMainAgent(req)` |
| classifyRequest 分类逻辑 | `cc-viewer/src/utils/requestType.js` | `export function classifyRequest(req, nextReq)` |
| SubAgent 类型正则 | `cc-viewer/src/utils/contentFilter.js:7` | `SUBAGENT_SYSTEM_RE` |
| 日志文件路径生成 | `cc-viewer/interceptor.js` | `generateNewLogFilePath()` |

注意：Claude Code 的 cli.js 是混淆后的代码，函数名为随机标识符（如 `mZ6`, `ql6`, `pNY` 等），需要通过搜索关键字符串定位。

## 11. 待验证事项（已完成）

1. ✅ 执行一次真正的 `/team` 命令，验证 teammate 请求是否被 interceptor 捕获
2. ✅ 验证 NPM 注入模式下 teammate 的日志文件位置（预期为独立文件）
3. ✅ 验证 teammate 的 `mainAgent` 标记值（预期为 true，会被误分类为 MainAgent）
4. ~~验证 teammate 的工具集是否与 leader 完全相同（61 个工具）~~（待后续验证）
5. ~~验证 in-process fallback 模式下 teammate 是否写入同一日志文件~~（待后续验证）
6. ✅ 评估 NPM 注入模式下日志合并方案的可行性

## 12. 2026-03-18 实验结果与修复

### 12.1 根因分析

Teammate 的 API 请求在修复前**完全不可见**。排查过程：

1. **初始假设**：teammate 的请求写入了 `_temp.jsonl`（日志继承/resume 逻辑）→ 检查后发现无 temp 文件
2. **二次假设**：teammate 进程未加载 interceptor → 添加调试日志确认 interceptor 已加载
3. **最终根因**：`CCV_PROXY_MODE=1` 环境变量被 tmux teammate 进程继承

当用户通过 `ccv` 命令启动 Claude Code 时，`CCV_PROXY_MODE=1` 被设置在进程环境中。tmux spawn teammate 时继承了该变量。interceptor.js 中的条件：

```javascript
if (!_ccvSkip && !process.env.CCV_PROXY_MODE) setupInterceptor();
```

由于 `CCV_PROXY_MODE=1`，`setupInterceptor()` 被跳过，fetch 拦截器从未安装。

### 12.2 修复方案（interceptor.js，共 5 处改动）

| # | 位置 | 改动 | 目的 |
|---|------|------|------|
| 1 | `_isTeammate` 检测 | `process.argv.includes('--parent-session-id')` | 识别 teammate 进程 |
| 2 | `_teammateName` / `_teamName` 提取 | 从 argv 读取 `--agent-name` 和 `--team-name` | 日志记录中标记 teammate 身份 |
| 3 | `setupInterceptor()` 条件 | `(!process.env.CCV_PROXY_MODE \|\| _isTeammate)` | teammate 绕过 CCV_PROXY_MODE 检查 |
| 4 | `_initPromise` 分支 | teammate 直接写入 leader 的主日志，跳过 temp + resume | 避免数据写入 temp 文件无法可见 |
| 5 | viewer server 启动 | `setupInterceptor()` 内部和外部两处对 teammate 跳过 | 避免端口冲突 |

附加保护：
- teammate 跳过 `cleanupTempFiles()`，避免干扰 leader 的 resume 流程

### 12.3 日志记录格式

Teammate 的请求在 JSONL 中额外携带两个字段：

```json
{
  "teammate": "worker-1",
  "teamName": "fix-ts-errors",
  "mainAgent": true,
  ...
}
```

Solo 模式下的请求不包含这两个字段，完全向后兼容。

### 12.4 前端分类与主链路隔离

#### 角色检测收敛架构

所有角色判断收敛在 `contentFilter.js`，后续修改只需改一处：

```
contentFilter.js（全局唯一入口）
  ├── isTeammate(req)     — 双模式检测
  │     ├── interceptor 模式: req.teammate 字段（process.argv 写入）
  │     └── proxy 模式: TEAMMATE_SYSTEM_RE 正则（system prompt 检测）
  ├── isMainAgent(req)    — 内部调用 isTeammate() 排除 teammate
  └── TEAMMATE_SYSTEM_RE  — 正则只定义一处

requestType.js（消费者）
  └── classifyRequest()   — 调用 isTeammate()，返回 { type: 'Teammate', subType }

interceptor-core.js（interceptor 写入层）
  └── isMainAgentRequest() — 不做 teammate 检测，保持纯净
                             interceptor 模式通过 _isTeammate (argv) 独立处理
```

#### 主链路隔离

`isMainAgent()` 对 teammate 返回 `false`，确保以下主链路不被 teammate 数据污染：
- Prompt 提取（AppHeader）
- 缓存统计（AppHeader cache rebuild）
- 模型选择/缓存（interceptor 模型名缓存）
- Body Diff（DetailPanel）
- ChatView 主会话渲染

#### 分类输出

`formatRequestTag()` 输出格式：
- interceptor 模式：`Teammate:worker-1`（带具体名称）
- proxy 模式：`Teammate`（无名称，因 proxy 无法获取 argv）

### 12.5 Chat 视图支持

#### 问题

Teammate 请求被正确标记后，在 raw 视图中显示为 `Teammate:worker-1`，但 chat 视图中完全不可见（ChatView 只收集 SubAgent 条目）。同时 raw → chat 跳转对 Teammate 会错位到 leader 的 MainAgent。

#### 修复（3 处）

| 文件 | 位置 | 改动 |
|------|------|------|
| `ChatView.jsx` | line 709 | SubAgent 收集逻辑扩展为 `SubAgent \|\| Teammate`，Teammate 条目按时间戳交错插入 MainAgent 时间线 |
| `App.jsx` | `handleViewInChat()` | "View in chat" 按钮对 Teammate 用自身 timestamp 定位 |
| `App.jsx` | 视图切换逻辑 (line 695) | 切换按钮对 Teammate 用自身 timestamp 定位 |

Teammate 在 chat 视图中复用 SubAgent 的 `sub-agent-chat` role 渲染，label 显示为 `Teammate:worker-1`（interceptor 模式）或 `Teammate`（proxy 模式）。

### 12.6 关键发现

- `CCV_PROXY_MODE` 不在 `getTeammateEnvVars()` 转发列表中，但 tmux 的 `send-keys` 方式会继承父进程的完整环境
- Teammate 的 `mainAgent` 标记为 `true`（因为 body 结构与 MainAgent 相同），需要通过 `teammate` 字段区分
- Teammate 进程会尝试启动独立的 viewer server，必须显式跳过

### 12.6 环境变量继承路径

```
ccv CLI 启动
  └── CCV_PROXY_MODE=1 设置在进程环境中
        └── claude (leader 进程) 继承
              └── tmux send-keys 启动 teammate
                    └── teammate 继承 CCV_PROXY_MODE=1  ← 问题根源
                          └── setupInterceptor() 被跳过
```
