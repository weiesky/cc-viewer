# Claude Code CLI Startup Options — Complete Reference

> Target version: **Claude Code 2.1.195** (`claude --version`)
> This document is translated and organized from the `claude --help` output of that version,
> grouped by use case.
> Items marked `--print` only are effective only in non-interactive (print / SDK) mode.

---

## Basic Usage

```
claude [options] [command] [prompt]
```

- Default: starts an **interactive session**.
- Add `-p` / `--print` for **non-interactive mode** (prints result and exits, suitable for pipes / scripts).
- `prompt`: passed directly as the first prompt (positional argument).

```bash
claude                          # Interactive session
claude "帮我看下这个目录"         # 交互式会话 + 首条提示
claude -p "总结 README"          # 非交互，打印后退出
echo "代码内容" | claude -p "审查"  # 管道输入
```

---

## 一、模型与推理

| 参数 | 说明 |
|------|------|
| `--model <model>` | 本次会话使用的模型。可传别名（`fable` / `opus` / `sonnet`，取该系列最新款）或完整名（如 `claude-fable-5`）。 |
| `--fallback-model <model>` | 主模型过载 / 不可用时自动回退到指定模型。支持逗号分隔多个，按顺序尝试；每个用户回合开始时会重试主模型。**仅 `--print`**。 |
| `--effort <level>` | 本次会话的推理强度：`low` / `medium` / `high` / `xhigh` / `max`。 |
| `--agent <agent>` | 本次会话使用的 agent，覆盖 `agent` 设置。 |
| `--agents <json>` | 用 JSON 内联定义自定义 agent，例：`'{"reviewer": {"description": "Reviews code", "prompt": "You are a code reviewer"}}'`。 |

---

## 二、System Prompt（系统提示词）

| 参数 | 说明 |
|------|------|
| `--system-prompt <prompt>` | 本次会话使用的 system prompt（**整段替换**默认 prompt）。 |
| `--append-system-prompt <prompt>` | 在默认 system prompt 之后**追加**一段（保留 Claude Code 默认能力）。 |
| `--system-prompt-file <file>` | 从文件读取，**整段替换**默认 system prompt。隐藏参数（不在 `--help` 主列表，但实测可用）。 |
| `--append-system-prompt-file <file>` | 从文件读取，**追加**到默认 system prompt 之后。隐藏参数（同上）。 |
| `--exclude-dynamic-system-prompt-sections` | 把 per-machine 段（cwd、env 信息、memory 路径、git status）从 system prompt 挪到首条 user 消息，提升跨用户的 prompt-cache 复用。**仅对默认 prompt 生效**，配 `--system-prompt` 时忽略。默认 `false`。 |

> 注：`--system-prompt-file` / `--append-system-prompt-file` 为隐藏参数，`--help` 主列表未单独列出（仅在 `--bare` 描述中以 `--system-prompt[-file]` 形式带过），但已实测有效（commander 报 `argument missing` 而非 `unknown option`），用于较长 / 可复用的 prompt 内容。

```bash
claude --append-system-prompt "始终用中文回答"
claude --system-prompt-file ./my-system.txt
```

---

## 三、工具与权限

| 参数 | 说明 |
|------|------|
| `--tools <tools...>` | 指定可用的内置工具集。`""` 禁用全部，`default` 启用全部，或指定名称如 `"Bash,Edit,Read"`。 |
| `--allowedTools, --allowed-tools <tools...>` | 允许的工具名列表（逗号或空格分隔），例：`"Bash(git *)" Edit`。 |
| `--disallowedTools, --disallowed-tools <tools...>` | 拒绝的工具名列表，格式同上。 |
| `--permission-mode <mode>` | 本次会话的权限模式：`acceptEdits` / `auto` / `bypassPermissions` / `default` / `dontAsk` / `plan`。 |
| `--dangerously-skip-permissions` | 绕过**所有**权限检查。仅建议在无网络的沙箱中使用。 |
| `--allow-dangerously-skip-permissions` | 把「绕过所有权限检查」作为一个**可选项**开启（默认不启用）。仅建议无网络沙箱。 |

---

## 四、目录、会话与恢复

| 参数 | 说明 |
|------|------|
| `--add-dir <directories...>` | 额外允许工具访问的目录。 |
| `-c, --continue` | 继续当前目录下**最近一次**对话。 |
| `-r, --resume [value]` | 按 session ID 恢复对话；不带值则打开交互选择器（可附搜索词）。 |
| `--fork-session` | 恢复时新建 session ID 而非复用原 ID（配合 `--resume` / `--continue`）。 |
| `--from-pr [value]` | 恢复与某 PR 关联的会话（PR 号 / URL），或打开交互选择器（可附搜索词）。 |
| `--session-id <uuid>` | 指定本次对话的 session ID（须为合法 UUID）。 |
| `--no-session-persistence` | 关闭会话持久化：不写盘、不可恢复。**仅 `--print`**。 |
| `-n, --name <name>` | 设置本会话显示名（显示在提示框、`/resume` 选择器、终端标题）。 |

---

## 五、非交互 / 打印模式（`--print` 相关）

| 参数 | 说明 |
|------|------|
| `-p, --print` | 打印响应后退出（便于管道）。非交互模式会跳过工作区信任弹窗；校验失败的 settings 文件会被静默忽略。务必只在可信目录用。 |
| `--output-format <format>` | 输出格式（**仅 `--print`**）：`text`（默认）/ `json`（单条结果）/ `stream-json`（实时流）。 |
| `--input-format <format>` | 输入格式（**仅 `--print`**）：`text`（默认）/ `stream-json`（实时流式输入）。 |
| `--include-partial-messages` | 输出中包含到达的部分消息块。**仅 `--print` 且 `--output-format=stream-json`**。 |
| `--include-hook-events` | 输出流中包含所有 hook 生命周期事件。**仅 `--output-format=stream-json`**。 |
| `--replay-user-messages` | 把 stdin 的 user 消息回显到 stdout 用于确认。**仅 `--input-format=stream-json` 且 `--output-format=stream-json`**。 |
| `--json-schema <schema>` | 用于结构化输出校验的 JSON Schema。例：`{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}`。 |
| `--max-budget-usd <amount>` | API 调用花费的美元上限。**仅 `--print`**。 |
| `--prompt-suggestions [value]` | 启用提示建议；print/SDK 模式下每回合后发一条 `prompt_suggestion` 预测下一条用户提示。取值：`true/false/1/0/yes/no/on/off`，preset 为 `true`。 |

---

## 六、MCP、插件与配置来源

| 参数 | 说明 |
|------|------|
| `--mcp-config <configs...>` | 从 JSON 文件或字符串加载 MCP 服务器（空格分隔多个）。 |
| `--strict-mcp-config` | 只用 `--mcp-config` 提供的 MCP 服务器，忽略其它所有 MCP 配置。 |
| `--plugin-dir <path>` | 仅本次会话从目录或 `.zip` 加载插件（可重复：`--plugin-dir A --plugin-dir B.zip`）。默认 `[]`。 |
| `--plugin-url <url>` | 仅本次会话从 URL 拉取插件 `.zip`（可重复）。默认 `[]`。 |
| `--settings <file-or-json>` | 加载额外设置：可传 settings JSON 文件路径或 JSON 字符串。 |
| `--setting-sources <sources>` | 逗号分隔的设置来源：`user` / `project` / `local`。 |
| `--betas <betas...>` | API 请求中附带的 beta header（仅 API key 用户）。 |

---

## 七、调试与诊断

| 参数 | 说明 |
|------|------|
| `-d, --debug [filter]` | 开启 debug，可按类别过滤，例：`"api,hooks"` 或 `"!1p,!file"`。 |
| `--debug-file <path>` | 把 debug 日志写到指定文件路径（隐式开启 debug）。 |
| `--verbose` | 覆盖 config 里的 verbose 设置。 |
| `-v, --version` | 输出版本号。 |
| `-h, --help` | 显示帮助。 |

---

## 八、特殊启动模式

| 参数 | 说明 |
|------|------|
| `--bare` | 极简模式：跳过 hooks、LSP、插件同步、署名、auto-memory、后台预取、keychain 读取、CLAUDE.md 自动发现。设置 `CLAUDE_CODE_SIMPLE=1`。Anthropic 鉴权严格限定为 `ANTHROPIC_API_KEY` 或经 `--settings` 的 apiKeyHelper（不读 OAuth / keychain）；第三方供应商（Bedrock/Vertex/Foundry）用各自凭据。Skills 仍可经 `/skill-name` 解析。需显式提供上下文：`--system-prompt[-file]`、`--append-system-prompt[-file]`、`--add-dir`、`--mcp-config`、`--settings`、`--agents`、`--plugin-dir`。 |
| `--safe-mode` | 关闭所有自定义（CLAUDE.md、skills、插件、hooks、MCP、自定义命令与 agent、output styles、workflows、自定义主题、键位等），用于排查损坏的配置。Admin（policy）设置仍生效；鉴权、模型选择、内置工具、权限正常工作。设置 `CLAUDE_CODE_SAFE_MODE=1`。 |
| `--bg, --background` | 以后台 agent 启动会话并立即返回（用 `claude agents` 管理）。 |
| `--remote-control [name]` | 启动启用了 Remote Control 的交互会话（可命名）。 |
| `--remote-control-session-name-prefix <prefix>` | 自动生成的 Remote Control 会话名前缀（默认主机名）。 |
| `--disable-slash-commands` | 禁用所有 skills。 |

---

## 九、集成与环境

| 参数 | 说明 |
|------|------|
| `--ide` | 启动时若恰好有一个可用 IDE，则自动连接。 |
| `--chrome` | 启用 Claude in Chrome 集成。 |
| `--no-chrome` | 禁用 Claude in Chrome 集成。 |
| `--brief` | 启用 `SendUserMessage` 工具，用于 agent→user 通信。 |
| `--ax-screen-reader` | 渲染对屏幕阅读器友好的输出（纯文本、无装饰边框 / 动画）。 |
| `--file <specs...>` | 启动时下载的文件资源。格式 `file_id:relative_path`，例：`--file file_abc:doc.txt file_def:img.png`。 |

---

## 十、Git Worktree / tmux

| 参数 | 说明 |
|------|------|
| `-w, --worktree [name]` | 为本会话新建一个 git worktree（可指定名称）。 |
| `--tmux` | 为 worktree 创建 tmux 会话（需配合 `--worktree`）。有 iTerm2 时用其原生分屏；`--tmux=classic` 用传统 tmux。 |

---

## 子命令（Commands）

| 命令 | 说明 |
|------|------|
| `agents [options]` | 管理后台 agent。 |
| `auth` | 管理鉴权。 |
| `auto-mode` | 查看 auto 模式分类器配置。 |
| `doctor` | 检查 Claude Code 自动更新器的健康状况（会跳过信任弹窗并启动 `.mcp.json` 的 stdio 服务做健康检查，只在可信目录用）。 |
| `gateway [options]` | 运行企业版鉴权 / 遥测网关。 |
| `install [options] [target]` | 安装 Claude Code 原生构建。`[target]` 指定版本（`stable` / `latest` / 具体版本号）。 |
| `mcp` | 配置与管理 MCP 服务器。 |
| `plugin` \| `plugins` | 管理 Claude Code 插件。 |
| `project` | 管理 Claude Code 项目状态。 |
| `setup-token` | 设置长期有效的鉴权 token（需 Claude 订阅）。 |
| `ultrareview [options] [target]` | 云端多 agent 代码评审当前分支（或 PR 号 / 基准分支）并打印结果。 |
| `update` \| `upgrade` | 检查更新并安装。 |

---

## 附录 A：`--agent` / `--agents` 详解

这两个参数都围绕 **subagent（子代理）**，但作用层级不同：

- **`--agents <json>`**：在命令行**临时定义**一批 agent（仅本次会话有效），不落盘。
- **`--agent <name>`**：让**主会话本身以某个 agent 身份运行**（整段替换默认 system prompt），相当于把整个 Claude Code 变成那个定制 agent。

### A.1 `--agents <json>` —— 内联定义 agent

JSON 结构：**顶层 key = agent 名称**，value = 该 agent 的配置对象。`prompt` 字段对应文件版的 markdown 正文（即 system prompt）。

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on quality, security, best practices.",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  },
  "debugger": {
    "description": "Debugging specialist for errors and test failures.",
    "prompt": "You are an expert debugger. Find root causes and provide fixes."
  }
}'
```

**支持字段**（与文件版 frontmatter 一致，外加 `prompt`）：

| 字段 | 必填 | 类型 | 作用 |
|------|------|------|------|
| `description` | ✓ | string | 何时该委派给此 agent，Claude 据此决定自动委派 |
| `prompt` | — | string | system prompt / 指令（`--agents` JSON 专用；文件版放在 markdown 正文） |
| `tools` | — | string[] | 可用工具，省略则继承全部。如 `["Read","Grep","Bash"]`、MCP 形如 `["mcp__github"]` |
| `disallowedTools` | — | string[] | 从继承列表中**剔除**的工具，如 `["Write","Edit"]`、`["mcp__*"]` |
| `model` | — | string | `sonnet`/`opus`/`haiku`/`fable` 别名、完整 ID（`claude-opus-4-8`）或 `inherit`（默认） |
| `permissionMode` | — | string | `default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan` |
| `maxTurns` | — | number | agent 停止前的最大回合数 |
| `skills` | — | string[] | 启动时预加载进上下文的 skill 全文 |
| `mcpServers` | — | (string\|object)[] | 该 agent 可用的 MCP server（引用名或内联定义） |
| `hooks` | — | object | 生命周期 hook（`PreToolUse`/`PostToolUse`/`Stop`），格式同 settings.json |
| `memory` | — | string | 持久记忆作用域：`user`/`project`/`local`，支持跨会话学习 |
| `background` | — | boolean | `true` 则始终作为后台任务运行（默认 `false`） |
| `effort` | — | string | `low`/`medium`/`high`/`xhigh`/`max`，覆盖会话推理强度 |
| `isolation` | — | string | 设为 `worktree` 则在临时 git worktree（仓库隔离副本）中运行 |
| `color` | — | string | 显示颜色：`red`/`blue`/`green`/`yellow`/`purple`/`orange`/`pink`/`cyan` |
| `initialPrompt` | — | string | 当此 agent 作为主会话运行（`--agent` 或 `agent` 设置）时自动提交的首回合 |

> `name` 在 `--agents` 里不用单独写——JSON 的 key 就是 name。

### A.2 `--agent <name>` —— 让主会话作为某 agent 运行

```bash
claude --agent code-reviewer
```

- 整个会话接管该 agent 的：**system prompt（完全替换默认 Claude Code 提示词）**、工具限制、模型、以及 hooks/memory/permissionMode 等配置。
- 启动头部会显示 `@<name>` 表示已生效；恢复会话时保持。
- 也可写进 settings.json 持久化：`{"agent": "code-reviewer"}`（`--agent` 即覆盖此设置）。
- 插件提供的 agent 用带作用域的名字：`claude --agent my-plugin:security-reviewer`。

### A.3 agent 名称解析优先级（高 → 低）

1. **Managed settings**（组织管理员下发）
2. **`--agents` CLI 参数**（仅本次会话）
3. **`.claude/agents/`**（项目级，随仓库共享）
4. **`~/.claude/agents/`**（用户级，所有项目）
5. **插件 agent**（最低）

同名时取优先级最高的来源。

### A.4 文件版定义（`.claude/agents/*.md`）

```markdown
---
name: code-reviewer
description: Reviews code for correctness, security, and maintainability
tools: Read, Grep, Glob, Bash      # 文件版用逗号分隔；--agents JSON 用数组
model: sonnet
permissionMode: default
color: blue
---

You are a senior code reviewer. Review for:
1. Correctness: logic errors, edge cases, null handling
2. Security: injection, auth bypass, data exposure
3. Maintainability: naming, complexity, duplication
每条结论必须给出具体修复方案。
```

- **frontmatter（YAML）**：配置元数据；**markdown 正文**：该 agent 的 system prompt。
- 字段与 `--agents` JSON 完全一致，区别仅在 `prompt`（JSON 字段）↔ markdown 正文。

### A.5 会话中如何调用 subagent（针对非主会话的子代理）

- **自然语言委派**：`用 code-reviewer 检查我的改动`，Claude 读 `description` 自动委派。
- **@ 提及强制指定**：`@agent-code-reviewer review the auth module`；插件 `@agent-my-plugin:code-reviewer`。
- **整会话运行**：`--agent <name>` 或 settings.json `{"agent":"..."}`（即 A.2）。
- 子代理经 **Agent 工具**（旧称 Task）启动，只看到自己的 prompt，看不到完整的 Claude Code 默认 system prompt。

### A.6 两者关系小结

| | `--agents` | `--agent` |
|--|-----------|-----------|
| 作用 | **定义** agent（提供候选） | **选用** agent 作为主会话身份 |
| 落盘 | 否（仅本次会话） | 自身不落盘；可被 settings.json `agent` 持久化 |
| 典型搭配 | `claude --agents '{...}' --agent reviewer`（内联定义 + 立刻以它运行） | 单独用时引用文件/插件里已存在的 agent |

---

## 常用组合示例

```bash
# 指定模型 + 高推理强度
claude --model opus --effort high

# 非交互、JSON 输出、限定预算，跑脚本
claude -p "审查改动" --output-format json --max-budget-usd 0.5

# 自定义 system prompt + 仅允许部分工具
claude --system-prompt-file ./sys.txt --tools "Read,Bash"

# 计划模式 + 追加规则
claude --permission-mode plan --append-system-prompt "先出方案再动手"

# 内联定义一个 agent 并立刻以它身份运行整会话
claude --agents '{"reviewer":{"description":"code reviewer","prompt":"You are a senior code reviewer.","tools":["Read","Grep","Bash"]}}' --agent reviewer

# 在 worktree 里开一个会话
claude --worktree feature-x

# 极简 / 排障
claude --bare        # 跳过大部分自动行为
claude --safe-mode   # 关闭所有自定义，排查配置问题

# 恢复最近会话 / 按选择器恢复
claude -c
claude -r
```

---

> 备注：以上为 2.1.195 版本快照，不同版本参数可能增删。随时用 `claude --help` 查看本机实际支持的参数，用 `claude <command> --help`（如 `claude mcp --help`）查看子命令详情。
