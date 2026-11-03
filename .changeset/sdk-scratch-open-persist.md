---
"cc-viewer": patch
---

fix(web): **`--sdk` 模式 [终端] 窗口开关状态跨刷新记住** — SDK scratch 终端此前只在 `App.state.scratchOpen` 内存里翻转（默认 false），刷新即丢；PTY 终端只是默认值 `true` 才"显得"被记住。现按全局 `ccv_` 面板开关惯例（同 `ccv_fileExplorerOpen`/`ccv_gitChangesOpen`）：`App` 构造时从 `localStorage['ccv_scratchOpen']` 恢复，两处 toggle（Header 按钮 + 聊天右缘箭头）统一走 `_setScratchOpen` 写回存储。全局共享一份、首次默认关；刻意不复用 PTY 面板内嵌 scratch 的 `cc-viewer-scratch-open`（不同面板，避免跨模式耦合）。Coverage: `scratch-open-persist.test.js`.
