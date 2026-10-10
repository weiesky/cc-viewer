---
"cc-viewer": patch
---

fix(server): **SDK 模式改为常驻 streaming-input 进程** — 每回合 spawn 新子进程 + resume 的旧模型废弃，改为一次构造 `query({prompt: 输入队列})` 长驻、回合边界向流内推一条消息：Stop 从杀进程升级为真 `interrupt()`（会话与进程都保留），解锁 SDK 流式输入模式的完整控制面；观测面（proxy/v2/SSE）与 turn_end 链路不变。死亡重建惰性化（下一条消息以 `options.resume` 续接），中断回合的迟到 result 经墓碑机制不错位 settle 后续回合。Coverage: `sdk-manager-query.test.js`, `sdk-manager-extra.test.js`, `branch-lib-sdk-manager.test.js`.
