---
"cc-viewer": patch
---

fix(sdk+web): **CR 后续修复（慢上游提示健壮性 + 若干 P2）** — 慢上游在途提示：toast 加 90s 兜底时长 + 切工作区/卸载即销毁（不再永不消失）；按 requestId 计数避免并发慢请求互相覆盖；`waitingMs` 由客户端按 5s 自增刷新（不再冻结在 30s）；server 侧 cwd 回退仅当未上报 instance（定时任务 ephemeral 会话不再误判为前台等待）；计时改为收到首个 body chunk 才停表（原来量到 headers 为止）。composer pad 模式 max-height 提到 268px（12 行），JS clamp 不再重复减 padding。sdkTaskTracker 增加工作区 owner 感知（切工作区不再串上个项目清单）+ 全终态时 `task_started` 开新批次（跨轮不再累积）。`Teammate.md` 18 locale ×2 树去除不存在的 `TeamCreate`/`TeamDelete` 引用并加负向断言。mobile 触摸滚动修多指→单指过渡的视口跳动。
