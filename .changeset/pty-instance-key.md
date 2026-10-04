---
"cc-viewer": patch
---

feat(server): **PTY Map 改按 instanceKey 键控，同一 cwd 可起多个并发进程** — 原以 cwd 为 Map key，同 cwd 再 spawn 会顶掉旧 record（旧进程还在跑但 server 失去管理句柄）。现 spawn 时 mint 独立 instanceKey 作 key、cwd 降为 record 字段（`_resolveKey`/`listLivePtys` 改读 record.cwd）；同 cwd 不再互顶、各自存活。自愈重试（-c/thinking-display/system-prompt）经内部 `_respawnInto` 复用同 record 同 key（不 mint 新 key，避免 sidToKey 悬空断 chat 路由）；spawn 注入 `x-ccv-instance` header，interceptor 提取为 `_ccvInstance` 并在转发前剥离，v2-writer 解析出 sid 后经新增的 `setPtySessionIdForInstance` 按 instanceKey 精确反挂（同 cwd 双进程可区分），缺 header 退回旧 basename 路由兼容。launch 路由改接新增的 `ensurePtyForCwd`：同 cwd 已有 live claude 则 attach 复用而非新建（防重复进程泄漏）。Coverage: `pty-manager-instance.test.js`, `interceptor-instance-header.test.js`, `pty-manager.test.js`.
