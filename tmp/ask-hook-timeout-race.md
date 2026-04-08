# AskUserQuestion 超时竞争问题

## 现象

用户在 Web UI 点击审批后卡在"提交中..."，无法完成。偶发。

## 根因

5 分钟超时 timer（server.js HOOK_TIMEOUT = 5 * 60 * 1000）与用户点击审批存在时序竞争：

```
T=4:59.990  用户点击"审批" → 前端显示"提交中..."
T=5:00.000  超时 timer 触发 → pendingAskHook = null → 广播 ask-hook-timeout
T=5:00.010  WS 消息 ask-hook-answer 到达服务器 → if(pendingAskHook) 为 false → 丢弃
→ 前端永远卡在"提交中..."
```

## 涉及代码

- server.js ~line 1431: `HOOK_TIMEOUT = 5 * 60 * 1000`
- server.js ~line 2314-2325: ask-hook-answer 处理（无 pendingAskHook 时静默丢弃）
- 前端 AskQuestionForm 组件: 收到 ask-hook-timeout 时未重置"提交中..."状态

## 修复方案

1. **服务器侧**: 当收到 ask-hook-answer 但 pendingAskHook 已为 null 时，通过 WebSocket 回复错误消息 `{ type: 'ask-hook-expired' }`，让前端退出"提交中..."
2. **前端侧**: 收到 ask-hook-timeout 时，如果正在"提交中..."，重置提交状态

## 优先级

P2 — 偶发，仅在超时边界触发。与 1.6.79 的 req→res 修复无关，是原有设计缺陷。
