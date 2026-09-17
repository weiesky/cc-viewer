---
"cc-viewer": patch
---

fix(sse): **客户端写失败时上报并关闭连接以触发前端重连** — `_safeSseWrite` 的写入异常此前只把该客户端从广播数组里静默剔除，既不结束响应也不上报：连接与 30s ping 仍在，浏览器心跳看门狗被 ping 持续续期 → 前端永不重连、对话数据永久停更（终端 WebSocket 独立故不受影响）。现写异常经 `reportSwallowed('sse.safe-write')` 上报并 `end()` 关闭连接，前端按既有自动重连流程恢复。
