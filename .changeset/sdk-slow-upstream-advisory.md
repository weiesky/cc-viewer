---
"cc-viewer": patch
---

feat(sdk): **慢上游在途提示** — 修复“发出去后界面死寂数分钟”的可观测缺口。LLM 请求等上游首字节超过 30s 时，代理经 proxy-stats 监听器发信号，server.js（已合法持有 sdk-manager 访问器与 terminal WS，不新增跨层 import）在该工作区有活跃 SDK 会话时广播作用域化 `sdk-slow-upstream` 帧，前端 toast“模型响应缓慢，已等待 Ns，仍在等待…”。utility 探针（count_tokens / sdk 心跳）豁免；PTY/proxy-only 进程无监听器时为零成本 no-op。背景：一个 ECONNRESET 前的请求曾挂 164s 无任何 UI 反馈——CLI 重试只针对已完结的失败、代理重试只针对已完结的响应，两层都合法地空闲，用户只能干看。
