---
"cc-viewer": patch
---

feat(web): 「当前在用 Skill」按作用域分行展示 — 血条弹层中的 skill chip 列表从单条合并行拆分为「全局 Skill」/「项目级 Skill」/「插件 Skill」三个带标签的分组（数据来自 `/api/skills` 的 `source` 字段）。历史 system-reminder 回退路径（fsSkills 未加载完成时）保持原有单条合并行。新增 `groupActiveSkillsByScope()` 纯函数分桶，`mergeActiveSkills()` 返回值保留 `source` 字段。新增 i18n keys `ui.skillScopeRow.global/project/plugin`（×18 locales）。Coverage: `skill-display-name.test.js`, `new-ui-i18n.test.js`.
