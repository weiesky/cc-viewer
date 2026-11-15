---
"cc-viewer": patch
---

style(web): **统一 Git 变更 / 文件浏览器刷新按钮样式** — 两处头部刷新按钮从自绘 SVG 的 RefreshIcon 换成与「上下文消耗」同款的 antd text 小按钮 + ReloadOutlined，压缩至 16×16 贴合 11px 标题栏；点击后无限旋转 loading 直到刷新完成（仅手动点击时转，工具/重命名等其它触发源不触发按钮 loading）。
