---
"cc-viewer": patch
---

feat(web): **新建工作区弹窗加「什么是工作区」帮助入口** — 副标题末尾 `(?)` 图标点击弹出说明窗（Markdown 渲染），覆盖工作区定义、按文件夹工作的安全/上下文收益、Git 项目建议（非必选）及日志清理提示；图标样式抽进 `sharedChrome.module.css`（`.helpIconBtn`）供其他标签行复用。

feat(web): **新建工作区弹窗毛玻璃背景** — antd Modal 与 Electron 浮层卡片统一改 `var(--bg-glass)` + `backdrop-filter: blur(20px) saturate(180%)`，遮罩从 `rgba(0,0,0,.45)` 降到 `.18` 让 blur 真正透出后方内容；标题栏强制 transparent，box-shadow 改浅+1px inset 高光避免发灰。
