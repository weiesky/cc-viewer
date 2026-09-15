---
"cc-viewer": patch
---

feat(cli): 终端集成可观测与裸续接检测(静默)。安装/升级输出提示 shell hook 需新终端生效;`/api/claude-settings` 暴露 shell hook 安装状态(只读探针,绝不自动改用户 rc),hook 缺失/损坏时仅在浏览器控制台记一条诊断日志(不弹窗);新增 resume watchdog —— 检测到「transcript 在写但请求未经 ccv」的裸 `claude -c` 续接时(注入丢失、前缀缓存将全量重写)仅控制台记录,不打扰用户。README 补充「从终端继续会话的正确姿势」(hook 生效条件、绕过后果、~5 分钟缓存 TTL)。
