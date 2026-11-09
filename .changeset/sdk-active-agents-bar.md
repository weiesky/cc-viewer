---
"cc-viewer": patch
---

feat(web): `--sdk` 模式 [对话] 右上角新增活跃 SubAgent/Teammate 头像条 —— 由 WS `sdk-task` 帧派生的 taskStore 快照维护非终态 `local_agent`/`in_process_teammate`；磨砂玻璃 28px 浮条、24px 圆形头像（teammate 复用 `getTeammateAvatar`、匿名 subagent 用 `getSvgAvatar` sub-* 图标，身份经 toolUseId/prompt 前缀 join 主会话 Agent tool_use 解析真实 name/subagent_type）；点头像仅显示该 agent 对话、再点或尾部 (ALL) 恢复全部，与角色筛选条互斥、代理全部结束自动隐藏并复位筛选。Coverage: `activeAgents.test.js`, `active-agents-bar.test.js`, `chat-active-agents-wiring.test.js`, `sdkTaskTracker.test.js`.

fix(web): 窄窗口下 [对话] 区被固定宽度终端分栏压成 0 宽消失 —— `.chatSection` 由 `min-width:0` 改为 `min-width:280px`（对话区下限，永不被压没），`.splitContainer` 由 `overflow:hidden` 改为 `overflow-x:auto`（总宽超窗口时横向滚动、终端被挤到右侧可滚动查看，而非压扁对话）。Coverage: `chat-active-agents-wiring.test.js`.

fix(web): 修复头像条点击后 [对话] 不按 agent 过滤 —— 过滤行改用 `transcriptRowMatchesAgent` 经 spawn tool_use（toolUseId 精确、prompt 前缀兜底）一次性绑定，不再用两次独立字符串匹配（此前 task 帧 prompt 与 transcript 包装首条文本前缀失配时返回 false 硬过滤、且无类型级回落）；`_zeroHit` 兜底改为只数消息行（分隔符/banner 不再顶住兜底）；focus 身份改为渲染时按 taskId 从 taskStore 实时重解析（避免点击时 avatarType/toolUseId 未解析导致陈旧快照失配）。Coverage: `activeAgents.test.js`(transcriptRowMatchesAgent 行为套件), `chat-active-agents-wiring.test.js`.

fix(web): 同工作区 `/clear`/就地 resume 换 session 但暂不发 task 帧时，旧 session 的 `in_progress` agent 不再滞留 taskStore（头像条不再常驻、focus 不再卡死）—— `sdk-session-state` 检测到 sessionId 变化即 `resetForSession()` 并清空 focus。Coverage: `chat-active-agents-wiring.test.js`.
