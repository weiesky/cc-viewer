---
"cc-viewer": patch
---

feat(web): 定时任务支持 UltraPlan 模版与图片/附件 —— 任务内容改为复用 UltraPlan 输入面板（默认选中「空模版」tab，可选代码专家/调研专家/自定义专家），支持粘贴/上传附件（存持久路径，随任务保存 ≤20 个）。任务存的仍是原始文本，模版包裹与路径前缀由执行器在触发时经 @ccv/core `assembleScheduledPrompt` 组装（摘要/toast 不再回显模版壳，重编辑无双重包裹）；自定义专家内容保存时快照 `templateContent`，后续删改专家不影响已存任务。Coverage: `scheduled-task-store.test.js`, `scheduled-task-routes.test.js`, `scheduled-task-executor.test.js`, `ultraplan-templates.test.js`, `ultraplan-panel-embedded.test.js`, `schedule-modal-anchor.test.js`.
