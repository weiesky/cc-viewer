---
"cc-viewer": patch
---

fix(web): **移除对话侧栏残留的虚线分隔符和"返回当前会话"chip** — chip 与 Header 项目 tab 点击 detach 重复，虚线在 chip 不渲染时成为孤立元素。

fix(web): **星标快捷菜单顺序调整** — 「历史会话」行移到「Plan 自动审批」之后（新顺序：权限自动审批 → Plan 自动审批 → 历史会话 → AgentTeam）。
