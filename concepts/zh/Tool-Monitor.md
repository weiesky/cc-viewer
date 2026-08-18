# Monitor

启动一个后台监视器，从长时间运行的脚本中实时推送事件。每一行标准输出都会成为一条通知——继续工作，事件会实时出现在对话中。

## 何时使用

- 在部署运行期间，持续追踪日志文件中的错误、警告或崩溃特征
- 每隔 30 秒轮询远程 API、PR 或 CI 流水线，获取最新状态事件
- 实时监视文件系统目录或构建输出的变化
- 在多次迭代中等待特定条件（例如训练步骤里程碑或队列清空）
- **不适用于**简单的"等待完成"场景——请改用带 `run_in_background` 的 `Bash`，它会在进程退出时发送一次完成通知

## 启用方式

- 默认关闭（服务端功能开关）。
- 在 Amazon Bedrock、Google Cloud 和 Microsoft Foundry 上不可用。
- 当设置了 `DISABLE_TELEMETRY` 或 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 时关闭。
- WebSocket 源需要 Claude Code 2.1.195+。

## 参数

- `command`（字符串，必填）：要运行的 shell 命令或脚本。写入标准输出的每一行都会成为独立的通知事件。进程退出后监视器结束。
- `description`（字符串，必填）：在每条通知中显示的简短可读标签。请尽量具体——"deploy.log 中的错误"比"监视日志"更清晰。此标签用于识别触发通知的监视器。
- `timeout_ms`（数字，默认 `300000`，最大 `3600000`）：终止时限（毫秒）。超过此时长后进程将被强制终止。当 `persistent: true` 时此参数无效。
- `persistent`（布尔值，默认 `false`）：设为 `true` 时，监视器在整个会话期间持续运行，不受超时限制。可通过 `TaskStop` 显式停止。

## 示例

### 示例 1：追踪日志文件中的错误和崩溃

此示例覆盖所有终止状态：成功标记、回溯信息、常见错误关键词、OOM 终止以及意外进程退出。

```bash
tail -F /var/log/deploy.log | grep -E --line-buffered \
  "deployed|Traceback|Error|FAILED|assert|Killed|OOM"
```

每个管道中都必须使用 `grep --line-buffered`。若不使用，操作系统会以 4 KB 块为单位缓冲输出，事件可能延迟数分钟。交替匹配模式同时覆盖成功路径（`deployed`）和失败路径（`Traceback`、`Error`、`FAILED`、`Killed`、`OOM`）。只监视成功标记的监视器在崩溃时会保持静默——静默与"仍在运行"无法区分。

### 示例 2：每 30 秒轮询一次远程 API

```bash
while true; do
  curl -sf "https://api.example.com/status" || true
  sleep 30
done | grep --line-buffered -E "completed|failed|error"
```

`|| true` 防止偶发的网络故障中断循环。远程 API 建议采用 30 秒以上的轮询间隔，以避免触发频率限制。调整 grep 模式，同时捕获成功和失败响应，避免 API 侧错误被静默掩盖。

## 注意事项

- **管道中必须始终使用 `grep --line-buffered`。** 若不使用，管道缓冲会将事件延迟数分钟，因为操作系统会累积输出直到填满 4 KB 块。`--line-buffered` 强制在每行后刷新缓冲。
- **过滤器必须同时覆盖成功和失败特征。** 只监视成功标记的监视器在崩溃、挂起或意外退出时会保持静默。扩大匹配范围：在成功关键词之外，还应包含 `Error`、`Traceback`、`FAILED`、`Killed`、`OOM` 等终止状态标记。
- **远程 API 的轮询间隔不少于 30 秒。** 对外部服务进行高频轮询可能触发频率限制或封禁。对于本地文件系统或进程检查，0.5–1 秒的间隔是合适的。
- **对于会话级长期监视，使用 `persistent: true`。** 默认 `timeout_ms` 为 300 000 毫秒（5 分钟），超时后进程会被终止。若希望监视器持续运行直至手动停止，请设置 `persistent: true`，并在完成后调用 `TaskStop`。
- **事件过多时自动停止。** 每行标准输出都是一条对话消息。如果过滤器太宽泛、产生过多事件，监视器会被自动停止。请使用更精确的 `grep` 模式重新启动。200 毫秒内到达的多行会合并为一条通知。
