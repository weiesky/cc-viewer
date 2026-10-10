---
"cc-viewer": patch
---

feat(server): **SDK 模式接通后台任务消息广播** — `_processMessage` 新增 `task_started/task_progress/task_notification/task_updated` 四类 system subtype 分支，无损透传（snake→camel）为 terminal WS 的 `{type:'sdk-task', ...}` 帧；`task_updated.patch` 保持 merge 增量语义留给客户端、`skip_transcript` 原样转发、纯转发不触碰回合结算（`_queryBusy`/`_pendingTurns` 不变）。说明：所接 4 类是 SDK 公开契约（sdk.d.ts SDKMessage union）；SDK 另有 @internal 的 `task_summary`/`post_turn_summary` 两类 system subtype，本轮已知且暂弃，待真机观察是否含可透传信号。本轮仅 server 打通通道（无 server 端任务表 → 不做 WS 重连回放，断连窗口错过的 delta 不可恢复；接受易失 vs 建有界 last-state map 留待 UI 阶段决策）。UI 落点待真机观察后定。Coverage: `sdk-manager-query.test.js`.
