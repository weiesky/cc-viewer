---
"cc-viewer": patch
---

修复 SSE 请求进行中刷新页面导致「对话」空白或只显示旧对话直到本轮结束：批量合并路径放行 messages 已知全量的 in-flight 载体（v3 wire `_v3Assembled` / v2 transcript `_syntheticV2`，legacy v1 delta 占位仍拦截），in-flight 条目合并不再抹掉上一轮的 Last Response，冷加载源在首轮进行中时直接 serve 当前会话目录而不再回退上一段对话（v3 wire 限定，legacy `CCV_WIRE_V3=0` 行为完全不变）。注意：修复后刷新看到的是当前会话的完整前缀（含刚发出的提问），上一段旧对话不再随冷加载返回（单会话冷包语义）；移动端 `?since=` 增量重连在 IndexedDB 缓存恢复竞态输掉时仍可能短暂只显示增量窗口（预存竞态，非本次引入）。
