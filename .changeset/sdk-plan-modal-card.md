---
"cc-viewer": patch
---

fix(web): SDK 模式 Plan 审批改用独立 plan 卡片弹窗 —— ExitPlanMode 审批复用 PTY 的 planModeBox 卡片样式 + 全局 ApprovalModal 弹窗，与权限审批面板彻底分离；决议仍走 sdk-plan-answer 协议不变。卡片兜底确保 plan 弹窗在 transcript 卡片未挂载时也可操作。
