---
"cc-viewer": patch
---

fix(im): 修复 Linux 容器内钉钉 IM 已连接但 Claude 停在目录信任页导致回复超时 —— 新增 `ensureOnboardingAndTrust`（预写 `hasCompletedOnboarding` + `trustedFolders` + `projects.hasTrustDialogAccepted` 到 `.claude.json`）+ CodeFuse 配置目录回退（IM worker 启动时自动选择含 `.claude.json` 的 CodeFuse cc 目录）+ `getPtyBootState`（PTY 启动状态检测，卡在信任页时 IM 立即返回明确错误而非等 120 秒超时）+ `.cjs` npm 启动器支持（`resolveExplicitClaudePath`/`resolveClaudeFromPath`/`pty-manager`/`cli.js` 均识别 `.cjs` 入口）。Coverage: `ensure-hooks.test.js`, `pty-manager-gap.test.js`, `im-bridge-core.test.js`, `findcc-gap.test.js`.
