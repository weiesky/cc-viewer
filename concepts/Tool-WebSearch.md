# WebSearch

## 定义

执行搜索引擎查询，返回搜索结果用于获取最新信息。

## 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索查询（最少 2 个字符） |
| `allowed_domains` | string[] | 否 | 仅包含这些域名的结果 |
| `blocked_domains` | string[] | 否 | 排除这些域名的结果 |

## 使用场景

**适合使用：**
- 获取超出模型知识截止日期的最新信息
- 查找当前事件和最新数据
- 搜索最新的技术文档

## 注意事项

- 搜索结果以 markdown 超链接格式返回
- 使用后必须在响应末尾附上 "Sources:" 部分，列出相关 URL
- 支持域名过滤（包含/排除）
- 搜索查询中应使用当前年份
- 仅在美国可用

## 在 cc-viewer 中的意义

WebSearch 调用在请求日志中表现为 `tool_use` / `tool_result` content block 对。`tool_result` 包含搜索结果列表。
