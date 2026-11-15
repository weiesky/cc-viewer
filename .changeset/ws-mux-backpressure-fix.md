---
"cc-viewer": patch
---

fix(server): **WS-mux 冷加载背压卡死修复（1011 queue-overflow → 会话区空白）** — 冷加载历史经 WS-mux 一次推送数十 MB 突发，触发队列上限导致连接以 1011 关闭、页面收不到 load_end、刷新后仍空白。重构 mux 背压为自包含 pump（排队必有驱动、泵出字节才算进展的双时钟看门狗、有余量才发 drain、ping/pong/open-ack 绕过数据队列）,v3 冷加载/shard/attach-buffer flush 全部改为信用式逐帧 await,attach 缓冲与 mux 队列统一按字节核算；压缩 SSE 路径的 drain 等待同时监听 socket 与 encoder，消除冷加载卡顿。
