---
"cc-viewer": patch
---

feat(web): `--sdk` 模式 [对话] 右上角新增活跃 SubAgent/Teammate 头像条 —— 由 WS `sdk-task` 帧派生的 taskStore 快照维护非终态 `local_agent`/`in_process_teammate`；磨砂玻璃 28px 浮条、24px 圆形头像（teammate 复用 `getTeammateAvatar`、匿名 subagent 用 `getSvgAvatar` sub-* 图标，身份经 toolUseId/prompt 前缀 join 主会话 Agent tool_use 解析真实 name/subagent_type）；点头像仅显示该 agent 对话、再点或尾部 (ALL) 恢复全部，与角色筛选条互斥、代理全部结束自动隐藏并复位筛选。Coverage: `activeAgents.test.js`, `active-agents-bar.test.js`, `chat-active-agents-wiring.test.js`, `sdkTaskTracker.test.js`.

fix(web): 窄窗口下 [对话] 区被固定宽度终端分栏压成 0 宽消失 —— `.chatSection` 由 `min-width:0` 改为 `min-width:280px`（对话区下限，永不被压没），`.splitContainer` 由 `overflow:hidden` 改为 `overflow-x:auto`（总宽超窗口时横向滚动、终端被挤到右侧可滚动查看，而非压扁对话）。Coverage: `chat-active-agents-wiring.test.js`.
