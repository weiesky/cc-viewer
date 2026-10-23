---
"cc-viewer": patch
---

feat(server+web): **新增「设置定时任务」** — 「+」菜单（聊天输入栏与终端工具栏）新增定时任务管理弹窗：按预设（每小时/每天/工作日/每周）、自定义 cron 或一次性时间，到点把一条 prompt 注入当前活会话，或新建独立 headless SDK 会话运行。任务定义与调度状态持久化在 `preferences.json`（`scheduledTasks` 键，strict 写 + prefs GET/POST/fork 全路径剥离 + 文件 API/IM 拒读拒写），运行历史独立存 `scheduled-task-runs.json`（每任务最近 20 条，claimRunId 幂等）；服务端 10s tick 调度、跨进程文件锁认领防重复、重启/睡眠后 7 天内补跑最近一次；支持 Run now、暂停/恢复、删除（独立会话任务可跳转对应会话）。触发静默进行，失败/完成经 SSE 弹 toast。Coverage: `cron.test.js`, `schedule-model.test.js`, `scheduled-task-store.test.js`, `scheduled-task-scheduler.test.js`, `scheduled-task-executor.test.js`, `scheduled-task-routes.test.js`, `scheduled-task-runs-store.test.js`, `sdk-manager-ephemeral.test.js`, `schedule-description.test.js`, `schedule-i18n.test.js`, `schedule-modal-anchor.test.js`, `json-store.test.js`, `file-access-policy.test.js`, `api-preferences-gap.test.js`, `project-prefs.test.js`, `im-deny.test.js`.
