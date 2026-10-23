---
"cc-viewer": patch
---

feat(server+web): **新增「设置定时任务」** — 「+」菜单（聊天输入栏与终端工具栏）新增定时任务管理弹窗：按预设（每小时/每天/工作日/每周）、自定义 cron 或一次性时间，到点把一条 prompt 注入当前活会话，或新建独立 headless SDK 会话运行。任务按项目持久化（`scheduled-tasks.json`），服务端 10s tick 调度、文件锁跨进程认领防重复、重启/睡眠后 7 天内补跑最近一次；支持 Run now、暂停/恢复、删除与最近 20 条运行历史（独立会话任务可跳转对应会话）。触发静默进行，失败/完成经 SSE 弹 toast。Coverage: `cron.test.js`, `schedule-model.test.js`, `scheduled-task-store.test.js`, `scheduled-task-scheduler.test.js`, `scheduled-task-executor.test.js`, `scheduled-task-routes.test.js`, `sdk-manager-ephemeral.test.js`, `schedule-description.test.js`, `schedule-i18n.test.js`, `schedule-modal-anchor.test.js`.
