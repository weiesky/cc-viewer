---
"cc-viewer": patch
---

fix(web+sdk): 慢上游提示与 SDK 任务 HUD 审查修复 — `server.js` 补 `setSlowUpstreamListener` 缺失 import（否则模块加载即崩）。慢上游提示改为作用域精确匹配（按请求自带的 `x-ccv-project-dir`/`x-ccv-instance`，而非进程级绑定项目，多工作区不再串台），经 `broadcastWsMessage` 做服务端视图路由；toast 改为常驻直到请求完结（新增 `sdk-slow-upstream-resolved` 帧主动关闭），`waitingMs` 用真实已等待时长。SDK 任务 HUD：sessionId 变更时立即清空旧清单；任务失败/被杀/停止（failed/killed/stopped）渲染为失败态（红色 ✕）而非"已完成"；SDK 模式下忽略 hook 空快照避免覆盖 HUD。
