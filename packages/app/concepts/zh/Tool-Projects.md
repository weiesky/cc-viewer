# Projects

管理用户 Claude 项目知识库中的项目文档：读取、搜索、写入和删除文档，或获取项目信息。

## 何时使用

- 将文档（交付物、笔记、参考资料）持久化到用户项目中，使其在会话结束后依然存在。
- 读取或搜索现有项目文档，让当前任务基于先前的上下文。
- 将本地文件上传到项目中，而无需把其内容加载进上下文。
- 删除过时的项目文档。

## 参数

- `method` (string, 必填)：`project_info`、`project_read`、`project_search`、`project_write`、`project_delete` 之一。
- `path` (string, 可选)：用于 `project_read`/`project_write`/`project_delete`：文档路径。用于 `project_write`：已存在的路径会被就地替换；新的裸文件名（不含 "/"）会命名空间化为 `claude/<name>`。
- `content` (string, 可选)：用于 `project_write`：内联文档文本。与 `local_path` 互斥。
- `local_path` (string, 可选)：用于 `project_write`：工作目录内要上传的文件——其内容永远不会进入你的上下文。与 `content` 互斥。
- `present_to_user` (boolean, 可选)：用于 `project_write`：将该文档标记为用户需要查看的交付物。默认 false；例行保存和批量写入时保持不设置。
- `query` (string, 可选)：用于 `project_search`：知识库查询。
- `n` (number, 可选)：用于 `project_search`：命中数量（默认 5）。

## 示例

### 示例 1：把交付物写入项目

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

上传本地文件而不把其内容拉进上下文，并将其标记为用户的交付物。

### 示例 2：搜索知识库

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## 注意事项

- `content` 用于你内联撰写的文本；`local_path` 用于磁盘上已有的任何内容——永远不要把两者混用。
- 谨慎使用 `present_to_user=true`：只用于用户要求或必须处理的那一份文档。
