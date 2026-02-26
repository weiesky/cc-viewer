# CC-Viewer

Claude Code 请求监控系统，实时捕获并可视化展示 Claude Code 的所有 API 请求与响应。方便开发者监控自己的 Context，以便于 Vibe Coding 过程中回顾和排查问题。

[English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

### 安装

```bash
npm install -g cc-viewer
```

### 运行与自动配置

```bash
ccv
```

该命令会自动检测本地 Claude Code 的安装方式（NPM 或 Native Install）并进行适配。

- **NPM 安装**：自动向 Claude Code 的 `cli.js` 中注入拦截脚本。
- **Native Install**：自动检测 `claude` 二进制文件，配置本地透明代理，并设置 Zsh Shell Hook 自动转发流量。

### 配置覆盖 (Configuration Override)

如果您需要使用自定义 API 端点（例如企业代理），只需在 `~/.claude/settings.json` 中配置或设置 `ANTHROPIC_BASE_URL` 环境变量。`ccv` 会自动识别并正确转发请求。

### 静默模式 (Silent Mode)

默认情况下，`ccv` 在包裹 `claude` 运行时处于静默模式，确保您的终端输出保持整洁，与原生体验一致。所有日志都在后台捕获，并可通过 `http://localhost:7008` 查看。

配置完成后，正常使用 `claude` 命令即可。访问 `http://localhost:7008` 查看监控界面。

### 常见问题排查 (Troubleshooting)

- **混合输出 (Mixed Output)**：如果您看到 `[CC-Viewer]` 调试日志与 Claude 的输出混杂在一起，请更新到最新版本 (`npm install -g cc-viewer`)。
- **连接被拒绝 (Connection Refused)**：请确保 `ccv` 后台进程正在运行。运行 `ccv` 或 `claude`（安装 Hook 后）应会自动启动它。
- **无 Body (Empty Body)**：如果您在 Viewer 中看到 "No Body"，可能是由于非标准的 SSE 格式。Viewer 现已支持作为兜底方案捕获原始内容。

### 卸载

```bash
ccv --uninstall
```

### 检查版本

```bash
ccv --version
```

## 功能

### 请求监控（原文模式）

- 实时捕获 Claude Code 发出的所有 API 请求，包括流式响应
- 左侧请求列表展示请求方法、URL、耗时、状态码
- 自动识别并标记 Main Agent 和 Sub Agent 请求（子类型：Bash、Task、Plan、General）
- 请求列表自动滚动到选中项（模式切换时居中显示，手动点击时就近滚动）
- 右侧详情面板支持 Request / Response 两个 Tab 切换查看
- Request Body 中 `messages`、`system`、`tools` 默认展开一层子属性
- Response Body 默认全部展开
- 支持 JSON 视图与纯文本视图切换
- 支持一键复制 JSON 内容
- MainAgent 请求支持 Body Diff JSON，折叠展示与上一次 MainAgent 请求的差异（仅显示变更/新增字段）
- Diff 区域支持 JSON/纯文本视图切换和一键复制
- 「展开 Diff」设置：开启后 MainAgent 请求自动展开 Diff 区域
- Body Diff JSON 提示框支持关闭，关闭后服务端持久化偏好，永不再显示
- 敏感请求头（`x-api-key`、`authorization`）在 JSONL 日志文件中自动脱敏，防止凭证泄露
- 每个请求内联显示 Token 用量统计（输入/输出 Token、缓存创建/读取、命中率）
- 兼容 Claude Code Router（CCR）及其他代理场景 — 通过 API 路径模式兜底匹配请求

### 对话模式

点击右上角「对话模式」按钮，将 Main Agent 的完整对话历史解析为聊天界面：

- 用户消息右对齐（蓝色气泡），Main Agent 回复左对齐（深色气泡），支持 Markdown 渲染
- `/compact` 消息自动识别并折叠展示，点击展开查看完整摘要
- 工具调用结果内联显示在对应的 Assistant 消息内部
- `thinking` 块默认折叠，以 Markdown 渲染，点击展开查看思考过程；支持一键翻译
- `tool_use` 显示为紧凑的工具调用卡片（Bash、Read、Edit、Write、Glob、Grep、Task 等均有专属展示）
- Task（SubAgent）工具结果以 Markdown 渲染
- 用户选择型消息（AskUserQuestion）以问答形式展示
- 系统标签（`<system-reminder>`、`<project-reminder>` 等）自动折叠
- Skill 加载消息自动识别并折叠显示 Skill 名称，点击展开查看完整文档（Markdown 渲染）
- Skills reminder 自动识别并折叠
- 自动过滤系统文本，只展示用户的真实输入
- 支持多 session 分段展示（`/compact`、`/clear` 等操作后自动分段）
- 每条消息显示精确到秒的时间戳，基于 API 请求时间推算
- 每条消息提供「查看请求」链接，点击可跳转到原文模式对应的 API 请求
- 双向模式同步：切换到对话模式时自动定位到选中请求对应的对话；切回原文模式时自动定位到选中的请求
- 设置面板：可切换工具结果和思考块的默认折叠状态
- 全局设置：可切换是否过滤无关请求（count_tokens、心跳请求）

### 翻译

- thinking 块和 Assistant 消息支持一键翻译
- 基于 Claude Haiku API，支持 API Key（`x-api-key`）和 OAuth Bearer Token 两种认证方式
- 翻译结果自动缓存，再次点击可切换回原文
- 翻译过程中显示加载旋转动画

### Token 消耗统计

Header 区域的「Token 消耗统计」悬浮面板：

- 按模型分组统计 input/output token 数量
- 显示 cache creation/read 数量及缓存命中率
- 缓存重建统计：按原因分组（TTL、system/tools/model 变更、消息截断/修改、key 变更）显示次数和 cache_creation tokens
- 工具使用统计：按调用次数排序展示各工具的调用频率
- Skill 使用统计：按调用次数排序展示各 Skill 的调用频率
- 概念帮助 (?) 图标：点击可查看 MainAgent、CacheRebuild 及各工具的内置文档
- Main Agent 缓存失效倒计时

### 日志管理

通过左上角 CC-Viewer 下拉菜单：

- 导入本地日志：浏览历史日志文件，按项目分组，在新窗口打开
- 加载本地 JSONL 文件：直接选择本地 `.jsonl` 文件加载查看（支持最大 500MB）
- 当前日志另存为：下载当前监控的 JSONL 日志文件
- 合并日志：将多个 JSONL 日志文件合并为一个会话，统一分析
- 查看用户 Prompt：提取并展示所有用户输入，支持三种查看模式 — 原文模式（原始内容）、上下文模式（系统标签可折叠）、Text 模式（纯文本）；斜杠命令（`/model`、`/context` 等）作为独立条目展示；命令相关标签自动从 Prompt 内容中隐藏
- 导出 Prompt 为 TXT：将用户 Prompt（纯文本，不含系统标签）导出为本地 `.txt` 文件

### 多语言支持

CC-Viewer 支持 18 种语言，根据系统语言环境自动切换：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
