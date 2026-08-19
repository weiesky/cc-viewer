# NotebookEdit

修改 Jupyter notebook（`.ipynb`）中的单个 cell。支持替换 cell 源码、插入新 cell 或删除现有 cell，同时保留其余 notebook 结构。

## 何时使用

- 修复或更新分析 notebook 中的代码 cell，而无需重写整个文件
- 替换 markdown cell 以改进叙述或补充文档
- 在已有 notebook 的已知位置插入新的代码或 markdown cell
- 移除已过时或损坏的 cell，使下游 cell 不再依赖它
- 通过逐个 cell 迭代，准备可复现的 notebook

## 参数

- `notebook_path` (string, 必填)：`.ipynb` 文件的绝对路径。相对路径会被拒绝。
- `new_source` (string, 必填)：新的 cell 源内容。对 `replace` 和 `insert` 来说，它成为 cell 主体；对 `delete` 来说，会被忽略，但仍因 schema 约束而必填。
- `cell_id` (string, 可选)：目标 cell 的 ID。在 `replace` 和 `delete` 模式下，工具作用于该 cell。在 `insert` 模式下，新 cell 会紧接该 ID 的 cell 之后插入；省略则插入到 notebook 顶部。
- `cell_type` (enum, 可选)：`code` 或 `markdown` 之一。当 `edit_mode` 为 `insert` 时必填。在 `replace` 时省略则保留现有 cell 的类型。
- `edit_mode` (enum, 可选)：`replace`（默认）、`insert` 或 `delete`。

## 示例

### 示例 1：替换有缺陷的代码 cell
调用 `NotebookEdit`，将 `notebook_path` 设为绝对路径，`cell_id` 设为目标 cell 的 ID，`new_source` 提供修正后的 Python 代码。`edit_mode` 保持默认 `replace`。

### 示例 2：插入 markdown 说明
要在已有的 `setup` cell 后紧随其后新增一个 markdown cell，设 `edit_mode: "insert"`、`cell_type: "markdown"`、`cell_id` 为 setup cell 的 ID，并把叙述放进 `new_source`。

### 示例 3：删除过时 cell
设 `edit_mode: "delete"` 并提供要移除 cell 的 `cell_id`。为 `new_source` 提供任意字符串；它不会被应用。

## 注意事项

- 始终传入绝对路径。`NotebookEdit` 不会相对于工作目录解析相对路径。
- 工具只重写目标 cell；其他 cell 的执行计数、输出和元数据保持原样。
- 在没有 `cell_id` 的情况下插入，新 cell 会放在 notebook 最前面。
- `cell_type` 在插入时必填。替换时请省略，除非你明确要把代码 cell 转为 markdown（反之亦然）。
- 要查看 cell 并取得它们的 ID，请先用 `Read` 工具读取 notebook；它会返回 cell 内容与输出。
- 普通源文件请使用常规 `Edit`；`NotebookEdit` 专门处理 `.ipynb` JSON，并理解其 cell 结构。
