---
"cc-viewer": patch
---

fix(web): **SubAgent 空白 `chat-boxer` 气泡** — 纯空白 text block（`'   '`/`'\n\n'`）为 truthy，能穿过两条共享渲染路径的 `if (tb.text)`/`if (!block.text)` 判断，但 `renderAssistantText` 解析后 segments 为空；wrapper `<div className="chat-boxer">` 仍被无条件创建，而 `.chat-boxer` 无子节点也有背景/边框/padding，遂渲染为可见空气泡。主消息因 `isSystemText` 预过滤掩盖了它，SubAgent/Teammate 的 `respContent` 原样透传才暴露。修复落在共享渲染层：legacy 与 web-search in-order 两条路径都在 `renderAssistantText` 之后、创建 `chat-boxer` 之前按 `segments.length === 0` 跳过——同时覆盖 Main/SubAgent/TeamSessionPanel/Last Response/merged run，且合法空 system-tag（非空 segments）不误删。
