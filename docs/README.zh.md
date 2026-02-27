# CC-Viewer

Claude Code 请求监控系统，实时捕获并可视化展示 Claude Code 的所有 API 请求与响应(原始文本，不做阉割)。方便开发者监控自己的 Context，以便于 Vibe Coding 过程中回顾和排查问题。

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

如果你遇到无法启动的问题，有一个终极排查方案：
第一步：任意目录打开 claude code；
第二步：给claude code下指令，内容如下:
```
我已经安装了cc-viewer这个npm包，但是无法启动，查看cc-viewer的cli.js 和 findcc.js，根据具体的时间适配本地的claude code的部署方式。适配的时候修改范围尽量约束在findcc.js中。
```
让Claude Code自己检查错误是比问任何人以及看任何文档更有效的手段！

以上指令完成后，会更新findcc.js。如果你的项目工程经常需要本地部署。或者fork出去的代码要经常解决安装问题，保留这个文件就可以。下次直接copy 文件。现阶段很多项目和公司用claude code都不是mac部署，而是服务端托管部署，所以作者剥离了findcc.js 这个文件，方便后续跟踪cc-viewer的源代码更新。

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
<img width="1500" height="720" alt="image" src="https://github.com/user-attachments/assets/519dd496-68bd-4e76-84d7-2a3d14ae3f61" />
- 实时捕获 Claude Code 发出的所有 API 请求，确保是原文，而不是被阉割之后的日志（这很重要！！！）
- 自动识别并标记 Main Agent 和 Sub Agent 请求（子类型：Bash、Task、Plan、General）
- MainAgent 请求支持 Body Diff JSON，折叠展示与上一次 MainAgent 请求的差异（仅显示变更/新增字段）
- 每个请求内联显示 Token 用量统计（输入/输出 Token、缓存创建/读取、命中率）
- 兼容 Claude Code Router（CCR）及其他代理场景 — 通过 API 路径模式兜底匹配请求

### 对话模式

点击右上角「对话模式」按钮，将 Main Agent 的完整对话历史解析为聊天界面：
<img width="1500" height="730" alt="image" src="https://github.com/user-attachments/assets/c973f142-748b-403f-b2b7-31a5d81e33e6" />


- 暂不支持Agent Team的展示
- 用户消息右对齐（蓝色气泡），Main Agent 回复左对齐（深色气泡）
- `thinking` 块默认折叠，以 Markdown 渲染，点击展开查看思考过程；支持一键翻译（功能还不稳定）
- 用户选择型消息（AskUserQuestion）以问答形式展示
- 双向模式同步：切换到对话模式时自动定位到选中请求对应的对话；切回原文模式时自动定位到选中的请求
- 设置面板：可切换工具结果和思考块的默认折叠状态


### 统计工具

Header 区域的「数据统计」悬浮面板：
<img width="1500" height="729" alt="image" src="https://github.com/user-attachments/assets/b23f9a81-fc3d-4937-9700-e70d84e4e5ce" />

- 显示 cache creation/read 数量及缓存命中率
- 缓存重建统计：按原因分组（TTL、system/tools/model 变更、消息截断/修改、key 变更）显示次数和 cache_creation tokens
- 工具使用统计：按调用次数排序展示各工具的调用频率
- Skill 使用统计：按调用次数排序展示各 Skill 的调用频率
- 概念帮助 (?) 图标：点击可查看 MainAgent、CacheRebuild 及各工具的内置文档

### 日志管理

通过左上角 CC-Viewer 下拉菜单：
<img width="1200" height="672" alt="image" src="https://github.com/user-attachments/assets/8cf24f5b-9450-4790-b781-0cd074cd3b39" />

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
