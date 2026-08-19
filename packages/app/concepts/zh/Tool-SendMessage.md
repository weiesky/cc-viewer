# SendMessage

在一个活跃团队内从一名成员向另一名成员发送消息，或一次性广播给所有队友。这是队友能听到的唯一通道——写入普通文本输出的内容对他们不可见。

## 何时使用

- 在团队协作中，向具名队友分配任务或移交子问题。
- 向其他代理请求状态、阶段性发现或代码评审。
- 通过 `*` 向整个团队广播决策、共享约束或关停通告。
- 回复协议提示，例如团队负责人的关停请求或计划审批请求。
- 在完成被委派的任务时收尾，让负责人可以把事项标记为完成。

## 启用方式

- 受与 `ListAgents` 相同的跨会话消息条件门控（服务端功能开关，默认关闭）。
- 此外，队友功能还需要启用实验性 agent 团队。

## 参数

- `to` (string, 必填)：目标队友在团队中注册的 `name`，或用 `*` 向所有队友广播。
- `message` (string or object, 必填)：普通文本用于一般沟通；结构化对象用于 `shutdown_response`、`plan_approval_response` 等协议响应。
- `summary` (string, 可选)：在团队活动日志中展示给纯文本消息的 5-10 词预览。对长字符串消息必填；当 `message` 为协议对象时被忽略。

## 示例

### 示例 1：直接的任务移交

```
SendMessage(
  to="db-lead",
  message="Please audit prisma/schema.prisma and list any model missing createdAt/updatedAt timestamps. Reply when done.",
  summary="Audit schema for missing timestamps"
)
```

### 示例 2：广播共享约束

```
SendMessage(
  to="*",
  message="Reminder: do not touch files under legacy/ — that subtree is frozen until the migration PR lands.",
  summary="Freeze legacy/ during migration"
)
```

### 示例 3：协议响应

使用结构化消息回应负责人的关停请求：

```
SendMessage(
  to="leader",
  message={ "type": "shutdown_response", "ready": true, "final_report": "All assigned diff chunks committed on branch refactor-crew/db-lead." }
)
```

### 示例 4：计划审批响应

```
SendMessage(
  to="leader",
  message={ "type": "plan_approval_response", "approved": true, "notes": "LGTM, but please split step 4 into migration + backfill." }
)
```

## 注意事项

- 你的普通助手文本输出不会传递给队友。如果你希望另一个代理看到某些内容，必须通过 `SendMessage`。这是团队工作流中最常见的错误。
- 广播（`to: "*"`）代价高昂——会唤醒每个队友并消耗他们的上下文。仅在确实影响所有人的通告场合使用。优先选择定向发送。
- 保持消息简洁且面向行动。包括接收者所需的文件路径、约束和期望的回复格式；记住他们与你没有共享记忆。
- 协议消息对象（`shutdown_response`、`plan_approval_response`）形态固定。不要把协议字段混入纯文本消息，也不要反过来。
- 消息是异步的。接收者将在其下一轮收到你的消息；在他们回复之前，不要假设他们已经读取或执行。
- 写好的 `summary` 能让负责人扫读团队活动日志时一目了然——把它当作提交说明的标题行。
