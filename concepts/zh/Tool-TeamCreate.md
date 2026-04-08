# TeamCreate

## 定义

创建一个新的团队来协调多个 agent 协同工作。团队通过共享任务列表和 agent 间消息传递实现并行任务执行。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `team_name` | string | 是 | 新团队的名称 |
| `description` | string | 否 | 团队描述/用途 |
| `agent_type` | string | 否 | 团队负责人的类型/角色 |

## 创建内容

- **团队配置文件**：`~/.claude/teams/{team-name}/config.json` — 存储成员列表和元数据
- **任务列表目录**：`~/.claude/tasks/{team-name}/` — 所有队友共享的任务列表

团队与任务列表一一对应。

## 团队工作流程

1. **TeamCreate** — 创建团队及其任务列表
2. **TaskCreate** — 为团队定义任务
3. **Agent**（带 `team_name` + `name`）— 生成加入团队的队友
4. **TaskUpdate** — 通过 `owner` 将任务分配给队友
5. 队友处理任务，通过 **SendMessage** 进行通信
6. 完成后关闭队友，然后用 **TeamDelete** 清理资源

## 相关工具

| 工具 | 用途 |
|------|------|
| `TeamDelete` | 删除团队和任务目录 |
| `SendMessage` | 团队内 agent 间的通信 |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | 管理共享任务列表 |
| `Agent` | 生成加入团队的队友 |
