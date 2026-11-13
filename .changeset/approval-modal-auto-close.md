---
"cc-viewer": patch
---

修复服务端自动审批（Plan 自动批准 / 问答题自动托管）实质推进后，客户端弹窗与待审批/待回答状态不关闭的问题。instant 档下 pending 与 resolved 帧同一 tick 连发，React 18 批处理使 resolved 分支读到未提交的 pending（null）而空操作；现改为函数式 setState 在最新 state 内按 id 匹配清除。同时让带 id 的审批终态帧（resolved/timeout）绕过视图收窄全量广播，避免连接戳失配时丢失唯一关闭信号。
