---
"cc-viewer": patch
---

fix(web): **SDK 模式代理热切换隐藏 Teammate 角色** — `ccv --sdk` 无 PTY、无法唤起 Teammate，角色分工区与其徽章在该模式下不再渲染 Teammate 行，仅保留主 Agent / 子 Agent；PTY 模式行为不变。
