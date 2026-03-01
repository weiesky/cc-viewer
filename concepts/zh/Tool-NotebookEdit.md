# NotebookEdit

## 定义

替换、插入或删除 Jupyter notebook（.ipynb 文件）中的特定单元格。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `notebook_path` | string | 是 | notebook 文件的绝对路径 |
| `new_source` | string | 是 | 单元格的新内容 |
| `cell_id` | string | 否 | 要编辑的单元格 ID。插入模式下新单元格插入到此 ID 之后 |
| `cell_type` | enum | 否 | 单元格类型：`code` 或 `markdown`。插入模式下必填 |
| `edit_mode` | enum | 否 | 编辑模式：`replace`（默认）、`insert`、`delete` |

## 使用场景

**适合使用：**
- 修改 Jupyter notebook 中的代码或 markdown 单元格
- 向 notebook 添加新单元格
- 删除 notebook 中的单元格

## 注意事项

- `cell_number` 是 0 索引的
- `insert` 模式在指定位置插入新单元格
- `delete` 模式删除指定位置的单元格
- 路径必须是绝对路径

## 在 cc-viewer 中的意义

NotebookEdit 调用在请求日志中表现为 `tool_use` content block，记录了对 notebook 的具体修改操作。

## 原文

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
