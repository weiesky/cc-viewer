---
"cc-viewer": minor
---

feat(system-prompt): 内置 preset 族系合并与别名扩展。Qwen-3.7-Max preset 合并为族系条目 Qwen-3（`match: qwen-3`，覆盖 qwen-3.5/3.7/3.8/coder 等整个 Qwen-3.* slug 家族）；新增 `deepseek-flash` 模型 id 别名（等同 deepseek-v4-flash，与 k3 同机制，用户条目与内置层同时生效），`deepseek-flash` 的上下文窗口档位同步对齐 1M；7 个内置 preset 增补通用条款（write-code-reads-like-surrounding-code / report-outcomes-faithfully / deepseek-v4-flash 补 system-reminder 说明）。改名兼容：旧墓碑 `QWEN-3.7-MAX` 自动归一为 `QWEN-3`，此前禁用该 preset 的用户 opt-out 继续生效；别名表查询改为原型安全（`constructor` 等模型 id 不再使匹配静默失效）。另修复 proxy 路径（ccv run / Electron tab）角色分类不读 `x-claude-code-agent-id` 头的缺陷——header-only 子代理（body 无角色标记的 SDK 身份行形态）此前会被误判 main 并注入主 persona，现与 fetch hook 判据对齐（named→teammate / anon→subagent）。
