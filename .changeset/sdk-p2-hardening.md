---
"cc-viewer": patch
---

fix(sdk): 三处健壮性/文案修正 — ① `_runWaterfallHook` 的 plan/ask/perm 三处静默 `catch {}` 改 `reportSwallowed('sdk-manager.waterfall.{plan|ask|perm}')`(对齐 CLAUDE.md 吞错规约);② `_messageQueue` 加 `MAX_QUEUE_ITEMS=50` 上限(chat-queue.js MAX_ITEMS / im-bridge-core MAX_QUEUE parity),超限只发 `queue-rejected{reason:'full'}` 不再发 `queue-state`,前端 `queueFull` toast 从死监听接通;③ README `ccv -SDK` 笔误改 `ccv --sdk`,"no terminal panel" 改为承认 Header 的 scratch 多 tab 终端存在(与 SDK 会话无关)。Coverage: `sdk-manager-query.test.js`(队列上限用例).
