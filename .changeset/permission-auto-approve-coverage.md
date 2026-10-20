---
"cc-viewer": patch
---

fix(server): **权限自动审批覆盖目录外 Read/Glob/Grep** — 新增 `PermissionRequest` hook 处理越过启动目录的读取/ glob / grep 权限提示。`perm-bridge` 对目录内 `Read`/`Glob`/`Grep` 直接放行，目录外不再强行 allow（避免被 Claude Code ask 规则覆盖），改由新注册的 `PermissionRequest` hook（`perm-request-bridge.js`）在弹窗前查询当前项目 `autoApproveSeconds`，开启自动审批时静默返回 `allow` + `updatedPermissions.addDirectories` 会话级目录信任；未开启时正常弹窗。SDK 模式对齐返回 `allow` + `addDirectories`。PTY 模式 `ExitPlanMode` 保持静默放行，避免与既有计划审批卡片冲突。Coverage: `perm-bridge.test.js`, `perm-request-bridge.test.js`, `branch-routes-ask-perm.test.js`, `ensure-hooks.test.js`, `sdk-manager-query.test.js`.
