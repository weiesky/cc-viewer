---
"cc-viewer": patch
---

feat(sse): **多工作区并发改为「每工作区一条常驻独立 SSE 通道」** — 原「一条连接按查看作用域撕了重建」在多工作区并发下让 spinner/streaming/任务清单/血条/打字机等「特殊状态」跨工作区纠缠。服务端：streaming/turn 状态由进程级单例改为按 scope 键控的 Map（bound 归一化为 `''` 哨兵），`turn_end`/`task_update`/`stream-progress`/`session_pin`/`workflow_update` 全部按 scope 路由（hook 负载统一经 sid→cwd→bound 解析器定 scope；stream chunk 的 project 过滤原是投射错误的死代码，本次顺带真正生效——这是唯一的非等价点）。前端：AppBase 的单 EventSource 换成 `createChannelManager`——每作用域（bound/project/project+instance/sid）一条常驻通道（上限 2 条规避 HTTP/1.1 连接上限），渲染视图只从「渲染中通道」的独立 vm 取数，切回暖通道瞬时渲染零网络零遮罩。单工作区下只剩一条通道、一个状态桶，行为与旧版等价。
