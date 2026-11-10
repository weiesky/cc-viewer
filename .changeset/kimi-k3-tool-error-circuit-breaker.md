---
"cc-viewer": patch
---

fix(kimi-k3): Kimi K3 system prompt 新增「工具错误处理(熔断)」段 — 报错先诊断再行动、参数非法不重发、同工具同参数最多重试 1 次、连续失败 2 次立即停手向用户报告，修复 TaskUpdate 空调用死循环。
