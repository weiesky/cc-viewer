---
"cc-viewer": patch
---

fix(web): **关闭项目 tab 后立即刷新 live 列表** — 新增 `liveProcessRefreshToken` 贯穿 AppBase→AppHeader→HeaderProjectSwitcher，close 成功后自增触发一次即时 `/api/live-processes` 重取，最后一个 tab 关闭后 Header 立即回落「当前项目:X」单会话形态，不再等 5s 轮询兜底（轮询保留为 backstop）。Coverage: `live-processes-refresh.test.js`.
