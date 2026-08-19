# RemoteTrigger

调用 claude.ai 远程触发器 API，用于管理计划任务和按需触发执行。OAuth 令牌由工具内部处理，不会暴露给模型或 shell。

## 何时使用

- 管理 claude.ai 上的远程代理（触发器），包括列出、查看和更新现有触发器
- 创建基于 cron 计划的自动化任务，使 Claude 代理按周期性计划运行
- 按需触发现有触发器，无需等待其下一次计划运行时间
- 列出或审计所有当前触发器，以查看其配置和状态
- 更新触发器设置，例如计划、负载或描述，而无需重新创建触发器

## 启用方式

- 需要 claude.ai Pro、Max、Team 或 Enterprise 套餐。
- 在 Amazon Bedrock、Claude Platform on AWS、Google Cloud 或 Microsoft Foundry 上不可用。
- 需要服务端功能开关以及 `allow_remote_sessions` / `allow_routines` 策略设置。
- 不适用于远程会话本身。

## 参数

- `action` (string, 必填)：要执行的操作 — 可选值为 `list`、`get`、`create`、`update` 或 `run`
- `trigger_id` (string, `get`、`update` 和 `run` 时必填)：要操作的触发器标识符；必须匹配模式 `^[\w-]+$`（仅限单词字符和短横线）
- `body` (object, `create` 和 `update` 时必填；`run` 时可选)：发送到 API 的请求负载

## 示例

### 示例 1：列出所有触发器

```json
{
  "action": "list"
}
```

调用 `GET /v1/code/triggers`，返回与已认证账户关联的所有触发器的 JSON 数组。

### 示例 2：创建每个工作日早晨运行的新触发器

```json
{
  "action": "create",
  "body": {
    "name": "weekday-morning-report",
    "schedule": "0 8 * * 1-5",
    "description": "每个工作日 UTC 08:00 生成每日摘要"
  }
}
```

调用 `POST /v1/code/triggers`，使用提供的请求体，返回新创建的触发器对象，包含其分配的 `trigger_id`。

### 示例 3：按需触发

```json
{
  "action": "run",
  "trigger_id": "my-report-trigger"
}
```

立即调用 `POST /v1/code/triggers/my-report-trigger/run`，绕过计划时间执行。

### 示例 4：获取单个触发器

```json
{
  "action": "get",
  "trigger_id": "my-report-trigger"
}
```

调用 `GET /v1/code/triggers/my-report-trigger`，返回完整的触发器配置。

## 注意事项

- OAuth 令牌由工具在进程内注入 — 切勿手动复制、粘贴或记录令牌；这样做会带来安全风险，且在使用本工具时完全没有必要。
- 对于所有触发器 API 调用，请优先使用本工具而非原始 `curl` 或其他 HTTP 客户端；直接使用 HTTP 会绕过安全令牌注入，可能暴露凭据。
- 工具返回来自 API 的原始 JSON 响应；调用方负责解析响应并处理错误状态码。
- `trigger_id` 的值必须匹配模式 `^[\w-]+$` — 仅允许使用字母数字字符、下划线和短横线；包含空格或特殊字符将导致请求失败。
