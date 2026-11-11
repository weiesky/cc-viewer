---
"cc-viewer": patch
---

feat(header): 系统提示词生效后不再自动固定到顶部导航栏 — 移除「系统提示词修改」入口的自动露出机制(含 Electron 原生 tab bar)，入口统一走汉堡菜单或手动钉住。

feat(chat): 「查看用户 Prompt」入口从汉堡菜单移除，迁移到左侧头像导航的「用户 Prompt 导航」气泡标题栏「more」按钮，弹窗内容与原汇总弹窗一致。
