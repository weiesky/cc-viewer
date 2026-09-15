---
"cc-viewer": patch
---

feat(proxy): system 文本随主模型热切换并按 (sessionId, model) 静态化。代理热切换主模型后无需重启 claude 会话：fetch hook 与重试引擎在模型替换后按生效模型重选 system 文本（workspace/global 模型条目 > builtin preset > CC_SYSTEM.md/CC_APPEND_SYSTEM.md sentinel，override 与 append 并存），并按 (project, session, model) 固化——同 session 同模型文本字节级不变，KV-cache 前缀仅在切换那一刻重建一次。启动模型条目 seed 自启动期注入字节（不重渲染，保住 Bind A/resume pin），切到非启动模型走异步旁路生成；改写保持 system 数组形态、billing-header 与 cache_control 不丢，剥离已知注入保证 proxy+hook 双写幂等（override+append 并存时不动点剥离，不累积）；仅 main 角色生效，默认开启，`CCV_DISABLE_LIVE_SYSTEM_PROMPT=1` 可单独关闭。
