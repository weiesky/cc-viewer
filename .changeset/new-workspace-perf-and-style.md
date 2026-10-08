---
"cc-viewer": patch
---

perf(server): **新建工作区弹窗打开提速 ~10x** + 样式/UX 调整 — `GET /api/workspaces` 重构:先排序后富化、支持 `?limit=`、复用 stats-worker 磁盘缓存、同步 fs 改异步;前端表格默认只显 5 行 + 末尾「查看更多」`<tr>` 展开;弹窗内容区灰底去除,表格与弹窗底色一致。Coverage: `workspace-registry-limit.test.js`, `workspace-list-modal.test.js`, `new-ui-i18n.test.js`.
