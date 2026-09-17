---
"cc-viewer": patch
---

fix(chat): **[对话] 面板偶发冻结（冷摄取闸门异常闩死）** — load_end 分帧管线（reconstruct → slim → process）此前没有异常兜底，任一条目在 batch 路径抛错（如 batch 侧缺 null 守卫的 `entry.timestamp` 解引用）都会让 `_ingestRunning` 永久保持 true，此后所有 live 条目堆进 `_liveGateBuffer` 永不泄洪——对话停止刷新且内存持续增长；同时服务端 30s ping 持续续期前端 45s 心跳看门狗，自动重连路径永不触发，只能刷新页面恢复（[终端] 走独立 WebSocket 不受影响）。现两个管线入口加 try/catch 并按 token 校验复位闸门、按到达序泄洪缓冲、按已提交基线重建去重索引并解除 loading；batch 路径补 null 条目守卫（与 live 路径对称）；v3 delta 改为 buildEntry 成功后才标记去重 key（此前抛错则该 seq 永久丢失）；v3 冷装配窗口抛错时泄洪已缓冲帧而非搁浅。
