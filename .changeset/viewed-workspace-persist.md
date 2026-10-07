---
"cc-viewer": patch
---

feat(web): **刷新后记住并行工作区视图** — 切换到的并行项目（chip/tab 点击或并行 /resume）现持久化到 `localStorage`（`ccv_viewedWorkspace`：project + instanceKey + cwd），刷新时先对 `/api/live-processes` 校验再恢复，不再总是回落到绑定项目。instanceKey 失效（进程/服务器重启重铸）时按 cwd 重解析新实例；同名项目歧义一律回落绑定，绝不按名猜测。真实用户动作（detach / bound resume / launch / return-to-list）统一清除记录；`workspace_started/stopped` 为全客户端广播，刻意不在此处清除（避免误删其他标签页刚持久化的工作区）。name-only 恢复时优先带上存活实例的 instanceKey，保持服务端 instance-no-session 守卫生效、避免瞬态串项目。Coverage: `viewed-workspace-storage.test.js`.
