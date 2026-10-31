---
"cc-viewer": patch
---

fix(server): **修复丢失 result 兜底误吞下一回合 result** — v1.9.18 的丢失 result 兜底在强制结算时用计数器 `_lateResultTombstones` 记「迟到的 result 待丢弃」，但它只在 teardown/reset 时清零、开新回合不清。result 真丢（永不到）时，这个计数残留并吞掉下一回合的正常 result（不发 turn_end），5 秒后该回合又被误判 turn-stuck 提示重试——尽管内容已落盘。改为代际 guard：被强制结算的回合记录其 epoch，迟到 result 只在无活回合可归属时丢弃；新回合的 result 正常配对、旧债即时作废。Coverage: `sdk-manager-lost-result.test.js`.

fix(server): **修复首次 `ccv --sdk` 首回合对话卡渲染、刷新才恢复** — `/events` 冷加载刻意等历史发完才把客户端加进广播列表（防闪烁），但「冷读冻结快照 → 注册」这段窗口内的 live 增量既不在快照也不广播给该客户端，且无重放；首回合独占「冷加载慢 + 首数据晚」恰好落入窗口，只能刷新补。现加 attach buffer：冷加载期间挂一个带相同视图戳的缓冲代理入广播列表，窗口增量入队，load_end 后按序回放再换真实客户端；`v3_conv` 按冷包 coverage 去重（客户端 conv 重放非幂等）。Coverage: `sse-attach-buffer.test.js`, `events-attach-buffer.test.js`.
