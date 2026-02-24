# TaskOutput

## 定义

获取正在运行或已完成的后台任务的输出。适用于后台 shell、异步 agent 和远程会话。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `task_id` | string | 是 | 任务 ID |
| `block` | boolean | 是 | 是否阻塞等待任务完成，默认 `true` |
| `timeout` | number | 是 | 最大等待时间（毫秒），默认 30000，最大 600000 |

## 使用场景

**适合使用：**
- 检查通过 Task（`run_in_background: true`）启动的后台 agent 的进度
- 获取后台 Bash 命令的执行结果
- 等待异步任务完成并获取输出

**不适合使用：**
- 前台任务——前台任务直接返回结果，无需此工具

## 注意事项

- `block: true` 会阻塞直到任务完成或超时
- `block: false` 用于非阻塞检查当前状态
- 任务 ID 可通过 `/tasks` 命令查找
- 适用于所有任务类型：后台 shell、异步 agent、远程会话

## 在 cc-viewer 中的意义

TaskOutput 调用本身不产生 API 请求，它是 Claude Code 内部的任务管理操作，不会出现在请求日志中。
