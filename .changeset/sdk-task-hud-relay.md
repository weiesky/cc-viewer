---
"cc-viewer": patch
---

feat(web): **SDK 模式接通任务清单 HUD** — `--sdk` 下 TaskProgressHud 不再缺席。新增 `sdkTaskTracker` 消费 server 转发的 WS `sdk-task` 帧（task_started/progress/updated/notification），客户端归并为 taskStore 兼容快照，HUD 直接复用现有渲染。含 `_sdkFrameMatchesView` 视图守卫、sessionId 变更自动重置、task_started re-fire 状态复位。PTY 模式零影响（sdk-task 帧仅 SDK 模式产生）。
