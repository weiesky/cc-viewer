---
"cc-viewer": patch
---

fix(content): 统一 UltraReview 提示词为无 TeamCreate 的新版 — codeExpert 评审段改为「用 Agent 工具构建 team(teammate 有 name,subagent 没有）→ 多角色评审 → P0/P1 修复、P2 辩证处理 → 完成后逐一通知 teammate 退出」；同步清除 codeExpert/customContent 预填样板及 CustomUltraplanExpert 内嵌提示词工具清单里残留的 `TeamCreate` 引用（该工具不存在）。覆盖 18 个 locale 的 UltraPlan.md / CustomUltraplanExpert.md、`code-expert.json`、`ultraplanTemplates.js` 与 i18n 预填骨架（`ultraplan-origin.md` 整体重写为新版）。
