---
"cc-viewer": patch
---

fix(web): **Git 变更面板刷新后保持开关状态** — 与文件浏览器同套 localStorage 持久化(`ccv_gitChangesOpen`,桌面 + iPad pad 模式默认关);互斥关闭(点文件浏览器/搜索图标)也落盘,刷新后不再出现双面板同开。Coverage: `git-changes-open-persist.test.js`.
