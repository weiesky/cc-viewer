# Bash

## 定义

执行 shell 命令，支持可选的超时设置。工作目录在命令间持久化，但 shell 状态（环境变量等）不持久化。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | 要执行的 bash 命令 |
| `description` | string | 否 | 命令的简短描述 |
| `timeout` | number | 否 | 超时时间（毫秒），最大 600000，默认 120000 |
| `run_in_background` | boolean | 否 | 是否后台运行 |

## 使用场景

**适合使用：**
- git 操作（commit、push、branch 等）
- npm/yarn 等包管理命令
- docker 操作
- 编译、构建命令
- 列出目录内容（`ls`）
- 其他需要 shell 执行的系统命令

**不适合使用：**
- 读取文件——应使用 Read
- 搜索文件名——应使用 Glob
- 搜索文件内容——应使用 Grep
- 编辑文件——应使用 Edit
- 写入文件——应使用 Write
- 向用户输出信息——直接在响应文本中输出
- 长时间运行的进程（dev server、watch 模式）——建议用户手动运行

## 注意事项

- 包含空格的路径必须用双引号包裹
- 输出超过 30000 字符会被截断
- 后台运行的命令通过 TaskOutput 获取结果
- 尽量使用绝对路径，避免 `cd`
- 独立命令可以并行调用多个 Bash
- 有依赖关系的命令用 `&&` 链接
- Shell 环境从用户的 profile（bash 或 zsh）初始化

## 在 cc-viewer 中的意义

Bash 调用在请求日志中表现为 `tool_use`（包含命令）和 `tool_result`（包含输出）content block 对。命令执行的输出可用于分析模型的操作行为。
