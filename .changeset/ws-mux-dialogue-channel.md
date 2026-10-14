---
"cc-viewer": patch
---

feat(sse): **对话实时通道改为「单条 WebSocket 多路复用」，SSE 自动降级兜底** — 每作用域（bound/project/project+instance/sid）原本各占一条常驻 SSE 连接，受浏览器 HTTP/1.1 每域约 6 连接上限挤压。现把对话通道迁到一条共享 `/ws/mux` WebSocket：每条逻辑流按 `streamId` 复用同一连接（open/close/open-ack/frame/error/close 帧，qs 原始 query 直通、per-stream seq 游标不回退、25s 应用层心跳），HTTP 连接压力自此解除（应用层通道上限 maxChannels=3 暂不变，抬上限留待后续）。SSE 路径完整保留为兜底：握手失败/无 `/ws/mux` 路由（旧服务端）/运行中断线预算耗尽时，按能力探测自动回落——握手/能力失败回落同一 URL 的原生 EventSource（携带 since/cc 游标）；运行中断线先按预算重连 WS，耗尽则交还通道管理器走心跳路径用新游标重建（可能再选回 WS）。用户无感知、数据不丢；瞬时抖动只触发重连而非永久降级，能力缺失才页级回落（不落盘、刷新重探）。服务端发射面经 sink 抽象泛化（WS 逻辑流伪装成 SSE res 入 `clients`，广播/过滤/直写点零改动），`serveEventStream` 抽为 SSE/WS 共享的唯一播出实现，单工作区下两者帧载荷逐字节一致（等价性测试钉死）。WS 握手开启 `perMessageDeflate`（ws 内建 zlib，无新依赖），补上 mux 通道相对 SSE brotli 的压缩差距（实测可追回大部分字节放大）。顺带修复：桌面端增量 URL 同连重放时的视口截断（`_onLoadEnd` 合并条件放宽为「基线非空即合并」，合并按 timestamp|url 幂等）。Coverage: `ws-mux.test.js`, `ws-mux-equivalence.test.js`, `ws-mux-channel.test.js` + 既有 SSE/通道回归网。
