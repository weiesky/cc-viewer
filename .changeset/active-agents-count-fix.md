---
"cc-viewer": patch
---

fix(web): 活跃代理卡片显示修复——(1) `deriveActiveAgents` 新增防御性过滤，无 `promptSnippet` 的 agent task 不计入活跃集合；(2) `buildAgentToolUseMap` 索引整个 transcript 的 Agent/Task tool_use（含 teammate 派生的嵌套 subagent），嵌套 subagent 现在显示真实名字而非短 description。
