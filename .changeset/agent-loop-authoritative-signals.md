---
"cc-viewer": patch
---

feat(server+web): **SDK 模式 Agent-Loop 感知修复与权威轮次边界** — 解决 SDK 模式下「Loop 是否还在执行」体感不准：spinner 此前只靠单次 API 粒度的网络信号+无 turn 关联的会话状态，迟到 idle 会清掉新回合；轮次结束靠 10s 防抖 turn_end，后台任务 `task-notification` 伪 result 会触发幻影结束。

- **活性信号**：SDK 消息流（assistant/user/tool_progress/task_*/api_retry/compact 等非边界消息）按 ≤1/s 合并为 `sdk-session-state` 活性帧（heartbeat+activity），覆盖代理层看不见的工具/压缩阶段；零额外子进程 IPC（未启用逐 token 的 includePartialMessages）。
- **Turn 关联**：`sdk-session-state` 携带 `turnId` + 墙钟 `turnStartedAt`；服务端丢弃 head 回合未被 CLI 确认 running 的迟到 idle（承重门控），前端按 epoch 守卫丢弃传输重排的旧帧；lost-result 兜底在 armed 后有新活动时 disarm（缓解「新回合 running 先于旧 idle」时的误判）。
- **权威 loopEnd**：新增 `agent_loop_start`/`agent_loop_end` SSE 帧；SDK 从真 result（过滤 `origin.kind==='task-notification'`）立即发出、绕过防抖；PTY 从 UserPromptSubmit 上升沿/打断、`_emitTurnEnd`（防抖后）发出，两模式统一。修复伪 result 幻影 turn_end。
- **spinner 即亮**：prompt/push 即刻点亮，不等首个 API 调用。
- **语音播报**：新增 `agentLoopStart`/`agentLoopEnd` 事件（默认关闭，opt-in）；`agentLoopEnd` 复用各语音包 turnEnd 录音，`agentLoopStart` 为新生成短提示音；18 语言；按 turnId 去重，实际播放后抑制同边界 `turnEnd` 语音（防双响）。
- **插件**：新增 `onAgentLoopStart`/`onAgentLoopEnd` parallel hook（PTY+SDK 双路径同点触发，payload 含 mode/turnId/turnStartedAt/reason）；service 插件 `ctx.events.on` 增加 `agent_loop_start`/`agent_loop_end`。

Coverage: `sdk-agent-loop.test.js`, `agent-loop-server-events.test.js`, `agent-loop-voice.test.js`, `sdk-session-state.test.js`, `plugin-runtime.test.js`, `voice-pack-events.test.js`, `voice-pack-manager.test.js`, `turn-active-gating.test.js`, `stop-button-turn-active.test.js`.
