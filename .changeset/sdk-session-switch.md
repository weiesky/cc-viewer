---
"cc-viewer": patch
---

fix(server): **SDK 模式支持会话中途切换（历史会话 resume 不再是死控件）** — `POST /api/resume-session` 新增 SDK 分支：不再硬依赖存活 PTY，经 `sdk-manager.switchToSession` 拆除旧常驻 query、切换 `_sessionId`，下一条消息以 `options.resume=<目标会话>` 惰性重建；回合在途返回 409 busy，SDK 不可用返回 409 unavailable，前端链路零改动复用。Coverage: `resume-route.test.js`.
