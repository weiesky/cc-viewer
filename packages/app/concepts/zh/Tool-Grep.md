# Grep

基于 ripgrep 引擎搜索文件内容。提供完整的正则表达式支持、按文件类型过滤，以及三种输出模式，可在精确性与紧凑性之间权衡。

## 何时使用

- 定位某函数的每一处调用点或某标识符的每一处引用
- 检查字符串或错误消息是否出现在代码库的任何地方
- 统计某模式出现次数，以在重构前评估影响
- 将搜索缩小到某种文件类型（`type: "ts"`）或 glob（`glob: "**/*.tsx"`）
- 使用 `multiline: true` 拉取跨行匹配，例如多行的结构定义或 JSX 块

## 参数

- `pattern` (string, 必填)：要搜索的正则表达式。使用 ripgrep 语法，因此字面花括号需转义（例如用 `interface\{\}` 查找 `interface{}`）。
- `path` (string, 可选)：要搜索的文件或目录。默认为当前工作目录。
- `glob` (string, 可选)：文件名过滤，例如 `*.js` 或 `*.{ts,tsx}`。
- `type` (string, 可选)：文件类型快捷方式，如 `js`、`py`、`rust`、`go`。对标准语言比 `glob` 更高效。
- `output_mode` (enum, 可选)：`files_with_matches`（默认，只返回路径）、`content`（返回匹配行）或 `count`（返回计数）。
- `-i` (boolean, 可选)：不区分大小写匹配。
- `-n` (boolean, 可选)：在 `content` 模式下包含行号。默认为 `true`。
- `-A` (number, 可选)：每个匹配之后显示的上下文行数（需 `content` 模式）。
- `-B` (number, 可选)：每个匹配之前的上下文行数（需 `content` 模式）。
- `-C` / `context` (number, 可选)：匹配两侧的上下文行数。
- `multiline` (boolean, 可选)：允许模式跨换行（`.` 匹配 `\n`）。默认为 `false`。
- `head_limit` (number, 可选)：限制返回的行数、文件路径或计数条目。默认 250；传 `0` 为不限制（谨慎使用）。
- `offset` (number, 可选)：在应用 `head_limit` 之前跳过前 N 条结果。默认 `0`。

## 示例

### 示例 1：找到某函数的所有调用点
设 `pattern: "registerHandler\\("`、`output_mode: "content"`、`-C: 2`，查看每次调用周围的上下文。

### 示例 2：按类型统计匹配数
设 `pattern: "TODO"`、`type: "py"`、`output_mode: "count"`，查看所有 Python 源码的每文件 TODO 汇总。

### 示例 3：多行结构匹配
使用 `pattern: "struct Config \\{[\\s\\S]*?version"` 搭配 `multiline: true`，捕获 Go 结构体中声明在数行之后的字段。

## 注意事项

- 始终优先使用 `Grep` 而不是通过 `Bash` 调 `grep` 或 `rg`；本工具已针对权限处理和结构化输出做了优化。
- 默认输出模式 `files_with_matches` 最节省。仅当你需要看到具体行时才切到 `content`。
- 上下文标志（`-A`、`-B`、`-C`）仅在 `output_mode` 为 `content` 时生效，否则会被忽略。
- 大结果集会消耗上下文 token。使用 `head_limit`、`offset` 或更紧的 `glob`/`type` 过滤保持聚焦。
- 对于文件名发现，请使用 `Glob`；对于需要多轮的开放式调查，请派发 `Agent` 并使用 Explore 代理。
