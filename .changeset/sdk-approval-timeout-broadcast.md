---
"cc-viewer": patch
---

fix(server): **SDK 模式审批超时后弹窗自动关闭** — 此前 `_waitForApproval` 超时静默 deny，各端 ask/plan/perm 弹窗永挂；现超时统一广播 dismiss（ask→`sdk-ask-timeout`、plan→`sdk-plan-resolved{reason:'timeout'}`、perm→`perm-hook-timeout`，前端 handler 均已就绪），并接通 canUseTool 的 `options.signal`（CLI 侧 abort 时同路 dismiss + deny）。Coverage: `branch-lib-sdk-manager.test.js`.
