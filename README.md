# CC-Viewer

Claude Code 请求监控系统，实时捕获并可视化展示 Claude Code 的所有 API 请求与响应。方便开发者监控自己的 Context，以便于 Vibe Coding 过程中回顾和排查问题。

[English](./docs/README.en.md) | [繁體中文](./docs/README.zh-TW.md) | [한국어](./docs/README.ko.md) | [日本語](./docs/README.ja.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [Dansk](./docs/README.da.md) | [Polski](./docs/README.pl.md) | [Русский](./docs/README.ru.md) | [العربية](./docs/README.ar.md) | [Norsk](./docs/README.no.md) | [Português (Brasil)](./docs/README.pt-BR.md) | [ไทย](./docs/README.th.md) | [Türkçe](./docs/README.tr.md) | [Українська](./docs/README.uk.md)

## 使用方法

```bash
npm install -g cc-viewer
```

安装完成后运行：

```bash
ccv
```

该命令会自动适配本地安装的 Claude Code。正常使用 Claude Code，打开浏览器访问 `http://localhost:7008` 即可查看监控界面。

### 卸载

```bash
ccv --uninstall
```

## 功能

### 请求监控（原文模式）

- 实时捕获 Claude Code 发出的所有 API 请求，包括流式响应
- 左侧请求列表展示请求方法、URL、耗时、状态码
- 自动识别并标记 Main Agent 和 Sub Agent 请求
- 右侧详情面板支持 Request / Response 两个 Tab 切换查看
- Request Body 中 `messages`、`system`、`tools` 默认展开一层子属性
- Response Body 默认全部展开
- 支持 JSON 视图与纯文本视图切换
- 支持一键复制 JSON 内容
- MainAgent 请求支持 Body Diff JSON，折叠展示与上一次 MainAgent 请求的差异（仅显示变更/新增字段）

### 对话模式

点击右上角「对话模式」按钮，将 Main Agent 的完整对话历史解析为聊天界面：

- 用户消息右对齐（蓝色气泡），Main Agent 回复左对齐（深色气泡），支持 Markdown 渲染
- `/compact` 消息自动识别并折叠展示，点击展开查看完整摘要
- 工具调用结果内联显示在对应的 Assistant 消息内部
- `thinking` 块默认折叠，点击展开查看思考过程
- `tool_use` 显示为紧凑的工具调用卡片（Bash、Read、Edit、Write、Glob、Grep、Task 等均有专属展示）
- 用户选择型消息（AskUserQuestion）以问答形式展示
- 系统标签（`<system-reminder>`、`<project-reminder>` 等）自动折叠
- 自动过滤系统文本，只展示用户的真实输入
- 支持多 session 分段展示（`/compact`、`/clear` 等操作后自动分段）
- 每条消息显示精确到秒的时间戳

### Token 消耗统计

Header 区域的「Token 消耗统计」悬浮面板：

- 按模型分组统计 input/output token 数量
- 显示 cache creation/read 数量及缓存命中率
- Main Agent 缓存失效倒计时

### 日志管理

通过左上角 CC-Viewer 下拉菜单：

- 导入本地日志：浏览历史日志文件，按项目分组，在新窗口打开
- 加载本地 JSONL 文件：直接选择本地 `.jsonl` 文件加载查看（支持最大 200MB）
- 当前日志另存为：下载当前监控的 JSONL 日志文件
- 导出用户 Prompt：提取并展示所有用户输入，支持 system-reminder 折叠查看
- 导出 Prompt 为 TXT：将用户 Prompt 导出为本地 `.txt` 文件

### 多语言支持

CC-Viewer 支持 18 种语言，根据系统语言环境自动切换：

简体中文 | English | 繁體中文 | 한국어 | Deutsch | Español | Français | Italiano | Dansk | 日本語 | Polski | Русский | العربية | Norsk | Português (Brasil) | ไทย | Türkçe | Українська

## License

MIT
