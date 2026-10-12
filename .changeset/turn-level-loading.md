---
"cc-viewer": patch
---

fix(ui): 对话面板 loading 在本地工具执行期间不再误熄。原信号是「单个 API 请求的发出/返回」,粒度为每次 API 调用 —— 两次调用间隙跑本地工具(Bash/Edit 等)时 spinner 熄灭,看起来像任务已结束。新增回合级状态:PTY 模式由 UserPromptSubmit hook 亮起、Stop hook 原始 POST 到达即灭(不再等 10s 语音防抖)、停止按钮/终端 Esc(嗅探「Request interrupted」条目)主动灭;SDK 模式转发 CLI 原生 session_state_changed(idle/running/requires_action,注入 CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1 解锁),并以 push→running、result→idle、中断/会话死亡→idle 为全版本兜底;帧带 cwd 按工作区路由、前端按当前查看会话过滤,多工作区互不串扰。spinner 灭灯改为「回合级信号把关 2s 防抖」,亮灯时机不变;hook 缺失时精确退化为旧行为;另有 30s 双无(无 API 活动且无回合级信号)自调度陈旧兜底防卡死。行为变化:工具执行间隙按 Enter 现在走入队而非立即发送。Coverage: `turn-active.test.js`, `sdk-session-state.test.js`, `cli-sdk-session-state-env.test.js`, `turn-active-gating.test.js`, `sse-connection-gen.test.js`。
