---
"cc-viewer": patch
---

fix(web): **修复流式中切换 viewed 项目导致对话区串扰（终端对、对话错）** — 在某项目 tab 发起对话流式进行中立即切到另一项目 tab 时，旧项目的实时回复会混进新 viewed 项目的对话区。双根因：①前端 `_resetForViewSwitch` 清了 streamingLatest 但漏清 `_pendingEntries`/`_flushRafId`——切换前已入缓冲的旧项目流式 entry 在切换后下一帧被合并进新 viewed 的 requests（对齐 `handleDetachView`/`_teardownTransientLiveState` 补清）。②服务端 `_feedForSessionDir` 找不到对应项目 feed 时曾兜底到绑定项目 feed，把无 feed 项目的 live activity 错投给绑定项目的 viewer——改为"无 feed 即弃"（lazy feed 语义：没人 view 就不广播），仅当会话目录不在任何项目根下才保留绑定兜底。Coverage: `stream-switch-bleed.test.js`.
