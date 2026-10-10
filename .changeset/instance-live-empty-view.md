---
"cc-viewer": patch
---

fix(server): **新建工作区（claude 已启动、尚未发出首个请求）点击其标签不再误报「切换超时」并串流绑定项目对话** — `/events?project=<p>&instance=<i>` 无会话目录时钉死空冷源（`load_start{total:0,empty:true}` → `load_end`）：legacy 与 v3 wire（`_v3Src`）两处回退一律钉空串，实例存活与否都不再回退到绑定项目当前会话；空视图跳过全局 `context-window.json` 兜底。实例存活 → 不发 `sid-not-found`，视图停留新工作区空态，per-project live feed 在其首个会话目录出现时从 byte 0 实时补上；实例已死 → 维持 `sid-not-found` → 前端 toast + detach。`empty:true` 信号让客户端失效该 scope 的视图缓存快照（修复"增量恢复已删会话"残留）。前端 `sid-not-found` 按 payload `reason` 显示新键 `ui.resume.noSession`（18 语言）取代误导性的「切换超时」。Coverage: `events-instance-live-empty.test.js`, `sid-not-found-live-empty.test.js`.
