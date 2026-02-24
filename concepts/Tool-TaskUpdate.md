# TaskUpdate

## 定义

更新任务列表中某个任务的状态、内容或依赖关系。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | 是 | 要更新的任务 ID |
| `status` | enum | 否 | 新状态：`pending` / `in_progress` / `completed` / `deleted` |
| `subject` | string | 否 | 新标题 |
| `description` | string | 否 | 新描述 |
| `activeForm` | string | 否 | 进行中时显示的现在进行时文本 |
| `owner` | string | 否 | 新的任务负责人（agent 名称） |
| `metadata` | object | 否 | 要合并的元数据（设为 null 可删除键） |
| `addBlocks` | string[] | 否 | 被此任务阻塞的任务 ID 列表 |
| `addBlockedBy` | string[] | 否 | 阻塞此任务的前置任务 ID 列表 |

## 状态流转

```
pending → in_progress → completed
```

`deleted` 可从任何状态转入，永久移除任务。

## 使用场景

**适合使用：**
- 开始工作时标记任务为 `in_progress`
- 完成工作后标记任务为 `completed`
- 设置任务间的依赖关系
- 需求变更时更新任务内容

**重要规则：**
- 只有在完全完成任务时才标记为 `completed`
- 遇到错误或阻塞时保持 `in_progress`
- 测试失败、实现不完整、遇到未解决错误时不得标记为 `completed`

## 注意事项

- 更新前应先通过 TaskGet 获取任务最新状态，避免过期数据
- 完成任务后调用 TaskList 查找下一个可用任务

## 在 cc-viewer 中的意义

TaskUpdate 是内部任务管理操作，不产生独立的 API 请求。
