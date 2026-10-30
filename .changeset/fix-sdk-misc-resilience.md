---
"cc-viewer": patch
---

fix(server+web): 韧性小修 —— WS 断开时发送消息给出失败提示且保留草稿；审批类插件 hook 加 15s 超时回落正常审批弹窗；SSE 预算耗尽后每 30s 慢重连并提示；off 模式 LLM 流加空闲看门狗（默认 5 分钟，可配 0 关闭）。
