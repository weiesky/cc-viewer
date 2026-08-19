# Edit

在已有文件中执行精确的字符串替换。它是修改文件的首选方式，因为只传输 diff，使编辑既精确又可审计。

## 何时使用

- 修复单个函数中的 bug，而不重写其周围文件
- 更新配置值、版本字符串或 import 路径
- 通过 `replace_all` 在文件内重命名符号
- 在某个锚点附近插入代码块（扩展 `old_string` 纳入附近上下文，再提供替换内容）
- 作为多步重构的一部分，应用小范围、界限清晰的编辑

## 参数

- `file_path` (string, 必填)：要修改文件的绝对路径。
- `old_string` (string, 必填)：要搜索的精确文本。必须逐字符匹配，包括空白与缩进。
- `new_string` (string, 必填)：替换文本。必须不同于 `old_string`。
- `replace_all` (boolean, 可选)：为 `true` 时替换 `old_string` 的每一处匹配。默认为 `false`，此时要求匹配唯一。

## 示例

### 示例 1：修复单处调用
将 `old_string` 设为精确行 `const port = 3000;`，`new_string` 设为 `const port = process.env.PORT ?? 3000;`。由于匹配唯一，`replace_all` 可保持默认。

### 示例 2：在文件内重命名符号
要在 `api.ts` 中把 `getUser` 重命名为 `fetchUser`，设置 `old_string: "getUser"`、`new_string: "fetchUser"`、`replace_all: true`。

### 示例 3：消除重复片段的歧义
若 `return null;` 出现在多个分支，扩大 `old_string` 以包含周围上下文（例如前一行 `if`），使匹配唯一。否则工具会报错而非猜测。

## 注意事项

- 在当前会话中必须至少对文件调用过一次 `Read`，`Edit` 才会接受改动。`Read` 输出的行号前缀不是文件内容的一部分；不要把它们放进 `old_string` 或 `new_string`。
- 空白必须完全一致。注意制表符与空格、以及行尾空格，尤其是在 YAML、Makefile 和 Python 中。
- 如果 `old_string` 不唯一且 `replace_all` 为 `false`，编辑将失败。请扩大上下文或启用 `replace_all`。
- 只要文件已存在，优先使用 `Edit` 而非 `Write`；`Write` 会覆盖整个文件，稍有不慎就会丢失无关内容。
- 对同一文件的多处无关编辑，应按顺序发起多次 `Edit` 调用，而不是一次庞大且脆弱的替换。
- 编辑源代码时避免引入表情符号、营销性文案或未请求的文档块。
