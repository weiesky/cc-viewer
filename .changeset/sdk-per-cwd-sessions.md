---
"cc-viewer": patch
---

feat(sdk): **SDK 模式改为「每工作区一个独立常驻会话」(按 cwd 多会话)** — 对齐 PTY:启动/新建工作区即在该 cwd 注册一个独立 SDK 会话并常驻,header 项目区(`/api/live-processes`)把每个 SDK 会话以 `kind:'main'` 真实条目列出(可切换、不可 × 关)。sdk-manager 由单例重构为 `Map<cwd, Session>` 工厂闭包注册表;`_activeKey` 选定当前会话;切 tab/发消息/中断/队列按 cwd(或 sanitized 项目名)anchor 寻址,**切走不拆旧会话**(后台工作区持续运行),切回懒重建并 resume 其 sessionId。每会话子进程注入 `x-ccv-project-dir: <cwd>`(对齐 pty-manager),transcript 按 cwd 正确分流不串写;cwd 标记的 WS 帧只推给正在看该工作区的连接,重连 replay 同滤。SDK 模式 launch 不再 `ensurePtyForCwd` 起幽灵 PTY;launch 注册新会话用 cli.js 注册的进程级 launch 配置模板(`setSdkLaunchConfig`),新工作区会话才有代理 env/transcript 分流;initSdkSession 回调只在显式传入时覆盖(不再误清整进程广播)。workspacesStop 一并 `stopSession()` 回收全部 SDK 会话。修复了「SDK 模式 header [+] 首次新建工作区后项目名区域塌缩只剩新项目」。Coverage: `sdk-session-registry.test.js` + 既有 sdk-manager 系列。
