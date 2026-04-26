# CC-Viewer

基于 Claude Code，蒸馏自身开发经验， 沉淀的 Vibe Coding 工具：

1. 提供本地化运行/ultraPlan、/ultraReview的能力，提升Claude Code 能力上限，同时避免把项目代码完全暴露给Claude云端；
2. 可以局域网内实现移动端编程(用户自行扩展)，web版本自适应各种尺寸模式，方便嵌入各种场景、包括浏览器插件，操作系统分屏中开发，同时提供native安装包；
3. 提供claude code 完整报文拦截分析的能力，方便记录日志、分析问题、学习借鉴、逆向研发；
4. 沉淀了很多学习资料以及开发经验（详见系统中各处的“?”中）；
5. 仅对claude code 能力上增强，对内核无任何实质性修改，保持原生体验；
6. 适配 deepseek-v4-*、GLM 5.1、Kimi K2.6，内置cc-switch能力，可以随时热切三方工具；

[English](../README.md) | [繁體中文](./README.zh-TW.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [Français](./README.fr.md) | [Italiano](./README.it.md) | [Dansk](./README.da.md) | [Polski](./README.pl.md) | [Русский](./README.ru.md) | [العربية](./README.ar.md) | [Norsk](./README.no.md) | [Português (Brasil)](./README.pt-BR.md) | [ไทย](./README.th.md) | [Türkçe](./README.tr.md) | [Українська](./README.uk.md)

## 使用方法

### 前提

确保已经安装好nodejs 22.0.0+；[下载安装](https://nodejs.org)
确保已经安装好claude code；[安装教程](https://github.com/anthropics/claude-code)

### 安装ccv

```bash
npm install -g cc-viewer --registry=https://registry.npmjs.org
```

### 编程模式

ccv 是 claude 的直接替身，所有参数透传给 claude，同时启动 Web Viewer。

```bash
ccv                    # == claude（交互模式）
ccv -c                 # == claude --continue（继续上次对话）
ccv -r                 # == claude --resume（恢复对话）
ccv -p "hello"         # == claude --print "hello"（打印模式）
ccv --d                # == claude --dangerously-skip-permissions（快捷方式）
ccv --model opus       # == claude --model opus
```

作者本人常用的命令是
```
ccv -c --d             # == claude --continue --dangerously-skip-permissions
```

编程模式启动以后，会主动打开web页面。

cc-viewer提供了客户端的版本：[下载地址](https://github.com/weiesky/cc-viewer/releases)


### 日志模式

如果你仍然习惯使用claude 原生工具，或者VS code插件，请使用该模式。

这个模式下面启动 ```claude```

会自动启动一个日志进程自动记录请求日志到~/.claude/cc-viewer/*yourproject*/date.jsonl

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


### 其他辅助指令

查阅
```bash
ccv -h
```

### 静默模式 (Silent Mode)

默认情况下，`ccv` 在包裹 `claude` 运行时处于静默模式，确保您的终端输出保持整洁，与原生体验一致。所有日志都在后台捕获，并可通过 `http://localhost:7008` 查看。

配置完成后，正常使用 `claude` 命令即可。访问 `http://localhost:7008` 查看监控界面。


## 功能


### 编程模式

在使用 ccv 启动以后可以看见：

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/ab353a2b-f101-409d-a28c-6a4e41571ea2" />


你可以直接在在编辑完成以后直接查看代码diff：

<img width="1500" height="728" alt="image" src="https://github.com/user-attachments/assets/2a4acdaa-fc5f-4dc0-9e5f-f3273f0849b2" />

虽然你可以打开文件手动编程，但是并不推荐使用手动编程，那是古法编程！

### 移动端编程

你甚至可以扫码，实现在移动端设备上编程：

<img width="3018" height="1460" alt="image" src="https://github.com/user-attachments/assets/8debf48e-daec-420c-b37a-609f8b81cd20" />
<img width="1700" height="790" alt="image" src="https://github.com/user-attachments/assets/da3e519f-ff66-4cd2-81d1-f4e131215f6c" />

满足你对移动端编程的想象，另外还有插件机制，如果你需要针对自己的编程习惯定制，后续可以跟进插件的hooks更新。


### 日志模式（查看claude code 完整会话）

<img width="1500" height="768" alt="image" src="https://github.com/user-attachments/assets/a8a9f3f7-d876-4f6b-a64d-f323a05c4d21" />


- 实时捕获 Claude Code 发出的所有 API 请求，确保是原文，而不是被阉割之后的日志（这很重要！！！）
- 自动识别并标记 Main Agent 和 Sub Agent 请求（子类型：Plan、Search、Bash）
- MainAgent 请求支持 Body Diff JSON，折叠展示与上一次 MainAgent 请求的差异（仅显示变更/新增字段）
- 每个请求内联显示 Token 用量统计（输入/输出 Token、缓存创建/读取、命中率）
- 兼容 Claude Code Router（CCR）及其他代理场景 — 通过 API 路径模式兜底匹配请求

### 对话模式

点击右上角「对话模式」按钮，将 Main Agent 的完整对话历史解析为聊天界面：

<img width="1500" height="764" alt="image" src="https://github.com/user-attachments/assets/725b57c8-6128-4225-b157-7dba2738b1c6" />

- 暂不支持Agent Team的展示
- 用户消息右对齐（蓝色气泡），Main Agent 回复左对齐（深色气泡）
- `thinking` 块默认折叠，以 Markdown 渲染，点击展开查看思考过程；支持一键翻译（功能还不稳定）
- 用户选择型消息（AskUserQuestion）以问答形式展示
- 双向模式同步：切换到对话模式时自动定位到选中请求对应的对话；切回原文模式时自动定位到选中的请求
- 设置面板：可切换工具结果和思考块的默认折叠状态
- 手机端对话浏览：在手机端 CLI 模式下，点击顶部栏的「对话浏览」按钮，即可滑出只读对话视图，在手机上浏览完整对话历史

### 日志管理

通过左上角 CC-Viewer 下拉菜单：

<img width="1500" height="760" alt="image" src="https://github.com/user-attachments/assets/33295e2b-f2e0-4968-a6f1-6f3d1404454e" />

**日志的压缩**
关于日志这个部分，作者需要声明，作者保证没有修改anthropic的官方定义，以确保日志的完整性。
但是由于1M的opus后期长生的单条日志过于庞大，得益于作者采取了对MainAgent的一些日志优化，在没有gzip的情况下，可以降低至少66%的体积。
这个压缩日志的解析方法，可以从当前仓库中抽取。

### 更多便捷有用的功能

<img width="1500" height="767" alt="image" src="https://github.com/user-attachments/assets/add558c5-9c4d-468a-ac6f-d8d64759fdbd" />

你可以通过侧边栏工具快速定位你的prompt

--- 

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/82b8eb67-82f5-41b1-89d6-341c95a047ed" />

有趣的KV-Cache-Text，能帮你看见 Claude 看到的东西是什么

---

<img width="1500" height="765" alt="image" src="https://github.com/user-attachments/assets/54cdfa4e-677c-4aed-a5bb-5fd946600c46" />

你可以上传图片说出你的需求，Claude 对图片的理解能力非常强大，同时你知道，你可以截图直接ctrl + V直接黏贴图片，对话里面可以显示你的完整内容

---

<img width="600" height="370" alt="image" src="https://github.com/user-attachments/assets/87d332ea-3e34-4957-b442-f9d070211fbf" />

你可以直接自定义插件、管理cc-viewer所有进程以及cc-viewer拥有对第三方接口的热切换能力（没错，你可以使用GLM、Kimi、MiniMax、Qwen、DeepSeek，虽然作者认为他们现在都很弱）

---

<img width="1500" height="746" alt="image" src="https://github.com/user-attachments/assets/b1f60c7c-1438-4ecc-8c64-193d21ee3445" />

更多功能等你发现...比如：本系统支持Agent Team，以及内置了Code Reviewer。马上就要适配Codex 的Code Reviewer引入（作者很推崇使用Codex 给Claude Code Reivew 代码）

## License

MIT
