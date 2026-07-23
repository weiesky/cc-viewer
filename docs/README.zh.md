# CC-Viewer

🌐 **官网与功能一览: [weiesky.github.io/cc-viewer](https://weiesky.github.io/cc-viewer/)** — 支持 18 种语言。


基于 Claude Code，蒸馏自身开发经验， 沉淀的 Vibe Coding 工具：

1. 提升能力上限，可本地化运行/ultraPlan、/ultraReview，同时避免把项目代码完全暴露给Claude云端；
2. 多端同时适配，可以实现移动端编程(局域网内)，web版自适应各种场景，方便嵌入浏览器插件、操作系统分屏，并提供native安装包；
3. 完整日志留痕，提供claude code 完整报文拦截分析的能力，方便记录日志、分析问题、学习借鉴、逆向研发；
4. 学习经验分享，沉淀了很多学习资料以及开发经验（详见系统中各处的“?”中）；
5. 保持原生体验，仅对claude code 能力上增强，对内核无任何实质性修改，保持原生体验；
6. 适配三方模型，适配 deepseek-v4-\*、GLM 5.1、Kimi K2.6，内置cc-switch能力，可以随时热切三方工具；

<img width="860" alt="cc-viewer — deploy once, share with every device" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-share.svg" />

[English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

### 前提

* 确保已经安装好nodejs 20.0.0+；[下载安装](https://nodejs.org)
* 确保已经安装好claude code；[安装教程](https://github.com/anthropics/claude-code)

### 安装ccv

#### 通过 npm 安装

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

#### 通过 Homebrew 安装（macOS / Linux 推荐）

```bash
brew tap weiesky/cc-viewer
brew install cc-viewer
brew upgrade cc-viewer   # 升级用这个，brew 安装的 ccv 不要用 npm install -g 升级
```

### 启动方式

ccv 是 claude 的直接替身，所有参数透传给 claude，同时启动 Web Viewer。

```bash
ccv                    # == claude（交互模式）
```

作者本人最常用的命令是

```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
                       # ccv 透传所有claude code 的启动参数，你可以自己任意组合使用
```

编程模式启动以后，会主动打开web页面。

cc-viewer提供了客户端的版本：[下载地址](https://github.com/weiesky/cc-viewer/releases)

### 选择 Claude 可执行文件

在本机 CCV 页面打开 **全局设置 → Claude 可执行文件**，可以选择 CLI、
`ccv run -- claude` 和桌面应用共同使用的 Claude Code。CCV 会列出在 CodeFuse、
`PATH`、npm 及常见原生安装目录中发现的候选项，也可以手动填写绝对路径或 `~/...`
路径。配置以 `claudeExecutablePath` 保存在
`~/.claude/cc-viewer/preferences.json`，下次启动时生效。

非空配置具有强制性：如果文件之后被移动、删除或不可执行，CCV 会明确报错并停止，
不会静默改用其他版本。清空该字段即可恢复自动发现。无界面环境也可以直接在上述
`preferences.json` 中写入同名配置。本配置仅允许本机管理员读写，不会向局域网客户端
暴露。CCV 启动 Claude 时会禁用 Claude Code 自身的自动升级，由所选安装来源或包管理器
负责升级。

### 升级到 1.7.0（日志格式 v2）

自 1.7.0 起，日志以「每会话目录」格式（wire-format v2）存储，不再使用单个 `.jsonl` 文件——磁盘占用约减少 90%。已有的 v1 `.jsonl` 文件不会被修改或删除；日志对话框默认会列出 v2 会话，并提供一个小的「查看旧版（v1）日志」入口（只要旧文件仍存在便会显示），点击后会打开 v1 视图，可在其中查看、迁移或删除它们。启动时，如果发现旧版日志，cc-viewer 会提供一键迁移（在使用 `claude -c` 继续旧对话时强烈建议迁移，因为这类对话的前半部分保存在旧文件中）。你也可以在终端中迁移：

```bash
ccv convert <project>   # 迁移单个项目
ccv convert --all       # 迁移所有项目
ccv verify <v1-file>    # 对照转换后的会话校验某个 v1 文件
```

某个会话未通过 golden 校验时，会被暂存到 `sessions-quarantine/` 待检查，而不会让整次迁移失败——其余会话照常迁移。

### 日志模式

如果你仍然习惯使用claude 原生工具，或者VS code插件，请使用该模式。

这个模式下面启动 `claude`

会自动启动一个日志进程自动记录请求日志到 \~/.claude/cc-viewer/*yourproject*/sessions/ 下的每会话目录（wire-format v2）

启动日志模式：

```bash
ccv -logger
```

在控制台无法打印具体端口的时候，默认第一个启动端口是127.0.0.1:7008。同时存在多个末尾顺延，如7009、7010

卸载日志模式：

```bash
ccv --uninstall
```

### 常见问题排查 (Troubleshooting)

如果你遇到无法启动的问题，有一个终极排查方案：
第一步：任意目录打开 claude code；
第二步：给claude code下指令，内容如下:

```
我已经安装了cc-viewer这个npm包，但是执行ccv以后仍然无法有效运行。查看cc-viewer的cli.js 和 findcc.js，根据具体的环境，适配本地的claude code的部署方式。适配的时候修改范围尽量约束在findcc.js中。
```

让Claude Code自己检查错误是比咨询任何人以及看任何文档更有效的手段！

以上指令完成后，会更新findcc.js。如果你的项目工程经常需要本地部署。或者fork出去的代码要经常解决安装问题，保留这个文件就可以。下次直接copy 文件。现阶段很多项目和公司用claude code都不是mac部署，而是服务端托管部署，所以作者剥离了findcc.js 这个文件，方便后续跟踪cc-viewer的源代码更新。

注意：本应用跟 claude-code-switch、cluade-code-router是冲突的，存在proxy竞争的问题，所以使用的时候务必关闭claude-code-switch、cluade-code-router，在cc-viewer内部有提供代理热更新的更能可以平替。

### 其他辅助指令

查阅

```bash
ccv -h
```

### 静默模式 (Silent Mode)

默认情况下，`ccv` 在包裹 `claude` 运行时处于静默模式，确保您的终端输出保持整洁，与原生体验一致。所有日志都在后台捕获，并可通过 `http://localhost:7008` 查看。

配置完成后，正常使用 `claude` 命令即可。访问 `http://localhost:7008` 查看监控界面。

## 附录 (本段不需要翻译成其他语言)

推荐中国🇨🇳的用户在无法使用claude 模型的情况下优先选择 deepseek 官方版本的 deepseek V4-Pro。

经过博主的验证，官方版本API提供的 deepseek V4-Pro 水位可以接近claude sonnet 4.6模型的能力。接口的调教也非常到位。

在cc-viewer中，大家可以尝试使用“代理热切换”的能力直接使用，或者把默认直接配置成 deepseek。

<img height="714" width="1500" alt="image" src="https://github.com/user-attachments/assets/425452fe-d167-42b0-b339-a05a877ef493" />

## 功能

### 编程模式

在使用 ccv 启动以后可以看见：

<img height="765" width="1500" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />

你可以直接在在编辑完成以后直接查看代码diff：

<img height="728" width="1500" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

虽然你可以打开文件手动编程，但是并不推荐使用手动编程，那是古法编程！

### 移动端编程

你甚至可以扫码，实现在移动端设备上编程：

<img height="1460" width="3018" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />

<img height="790" width="1700" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

满足你对移动端编程的想象，另外还有插件机制，如果你需要针对自己的编程习惯定制，后续可以跟进插件的hooks更新。

### 按模型定制系统提示词

**编辑系统提示词**模态框（汉堡菜单 → 编辑系统提示词）采用标签页设计：

* **默认**标签页保留经典行为：它将 `CC_SYSTEM.md`（覆盖）或 `CC_APPEND_SYSTEM.md`（追加）写入当前工作区，并在下次 ccv 启动时通过 `--system-prompt-file` / `--append-system-prompt-file` 注入。
* **模型标签页**：点击 **+ 添加模型**，输入名称（例如 `opus` 或 `Gemini3`），并选择作用域——**全局**（`~/.claude/cc-viewer/system_prompt/`，对所有工作区生效）或**工作区**（`<project>/system_prompt/`）。每个标签页都有自己的追加/覆盖开关和 Markdown 预览。
* 条目以大写文件名存储：`OPUS_SYSTEM.md`（覆盖）或 `OPUS_APPEND_SYSTEM.md`（追加）。匹配是模糊的——按「当前生效配置」解析出的模型 ID 做不区分大小写子串匹配（激活的三方 proxy profile 模型映射 > 启动环境变量 `ANTHROPIC_MODEL`/`CLAUDE_MODEL` > `settings.json` 配置的 `model`；无任何配置信号则不注入条目），因此无论版本如何，`opus` 都能匹配 `claude-opus-4-8[1m]`。已知限制：会话中途切换 proxy profile 需重启 claude 会话才会重新匹配；经额外参数透传的 `--model` 不参与解析。工作区匹配优先于全局匹配；同一作用域内名称最长者胜出；匹配到的条目会在该次启动中完全取代默认标签页的文件。
* 将标签页保存为空即可删除该条目。会话中途切换模型将在下次重新启动时生效。设置 `CCV_DISABLE_AUTO_SYSTEM_PROMPT=1` 可禁用所有自动注入。你可以将 `<project>/system_prompt/` 提交到版本库与团队共享提示词，也可以将其加入 `.gitignore` 保持私有。

### 日志模式（查看claude code 完整会话）

<img width="860" alt="cc-viewer — wire-level capture and packet decomposition" src="https://raw.githubusercontent.com/weiesky/cc-viewer/main/docs/cc-viewer-proxy.svg" />

* 实时捕获 Claude Code 发出的所有 API 请求，确保是原文，而不是被阉割之后的日志（这很重要！！！）
* 自动识别并标记 Main Agent 和 Sub Agent 请求（子类型：Plan、Search、Bash）
* MainAgent 请求支持 Body Diff JSON，折叠展示与上一次 MainAgent 请求的差异（仅显示变更/新增字段）
* 每个请求内联显示 Token 用量统计（输入/输出 Token、缓存创建/读取、命中率）
* 兼容 Claude Code Router（CCR）及其他代理场景 — 通过 API 路径模式兜底匹配请求

<a href="https://www.star-history.com/?repos=weiesky%2Fcc-viewer&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&theme=dark&legend=top-left" />

    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left" />

    ![Star History Chart](https://api.star-history.com/chart?repos=weiesky/cc-viewer&type=date&legend=top-left)
  </picture>
</a>


## License

MIT
