---
"cc-viewer": patch
---

fix(server): `--sdk` 活跃 agent 列表在 WS 闪断/换 session 后不再滞留或丢失 —— sdk-manager 新增有界 sdk-task 任务表（per sessionId，cap 64，session 切换/复位即清空），WS 重连时经 `sdk-task-snapshot` 帧回放；web 端 `sdkTaskTracker.applySnapshot` 以服务端表为权威对账，既能复活 started 帧丢失的 agent，也能丢弃服务端已不再跟踪的 agent（终态帧丢失或已切走的 session），头像条不再常驻。Coverage: `sdk-task-table.test.js`, `sdkTaskTracker.test.js`(applySnapshot).
