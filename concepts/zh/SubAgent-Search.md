# SubAgent: Search

## 定义

Search 是由 Claude Code 主 agent 生成的子 agent 类型，用于执行代码库搜索。它使用 Glob、Grep 和 Read 等工具执行有针对性的文件和内容搜索，然后将结果返回给父 agent。

## 行为

- 当主 agent 需要搜索或探索代码库时自动生成
- 在具有只读访问权限的隔离上下文中运行
- 使用 Glob 进行文件模式匹配，使用 Grep 进行内容搜索，使用 Read 进行文件检查
- 将搜索结果返回给父 agent 以供进一步处理

## 出现时机

Search 子 agent 通常在以下情况出现：

1. 主 agent 需要查找特定文件、函数或代码模式时
2. 用户请求进行广泛的代码库探索时
3. agent 正在调查依赖关系、引用或使用模式时
