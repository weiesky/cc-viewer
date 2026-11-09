---
"cc-viewer": patch
---

fix(server): `--sdk` 活跃 agent 列表在 WS 闪断/换 session 后不再滞留或丢失 —— sdk-manager 新增有界 sdk-task 任务表（per sessionId，cap 64，session 切换/复位即清空），WS 重连时经 `sdk-task-snapshot` 帧回放；web 端 `sdkTaskTracker.applySnapshot` 以服务端表为权威对账，既能复活 started 帧丢失的 agent，也能丢弃服务端已不再跟踪的 agent（终态帧丢失或已切走的 session），头像条不再常驻。Coverage: `sdk-task-table.test.js`, `sdkTaskTracker.test.js`(applySnapshot).

fix(sdk+web): **F5 刷新后活跃 agent 头像条不再消失** —— 根因是 `applySnapshot` 只回填任务、不种子 `_ownerKey`/`_sessionId`：刷新后快照先复活 strip，下一个 live 帧因 `owner !== null` 误判为视图切换而全量清空，后续 progress 帧对已清空 taskId 提前返回，strip 永远空到下个 task_started。修复：`applySnapshot` 从快照自带 cwd/instanceKey 种子 `_ownerKey`；服务端 `/clear`(sdk-init 换 sessionId)即清空任务表、空表也发权威 `tasks:[]` 快照、重放按 view 锚定（instance>project）、`skipTranscript` 后台任务折叠时保留标记并在此快照中过滤、`patch.description` 并入折叠。Coverage: `sdkTaskTracker.test.js`(applySnapshot owner/skipTranscript), `sdk-task-table.test.js`(空表/边界/skipTranscript/patch 合并), `branch-server.test.js`(WS 重放).

fix(web): **多工作区下后台 session 心跳不再清空前台头像条/focus** —— `sdk-session-state` 的 sessionId 变化重置此前未做视图过滤，后台工作区帧会误清前台 tracker 与 focus；现重置块经 `_sdkFrameMatchesView` 门控、视图切换时复位 `_lastSdkSessionStateSid`。Coverage: `chat-active-agents-wiring.test.js`.
