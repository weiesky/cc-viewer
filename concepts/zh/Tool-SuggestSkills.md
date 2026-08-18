# SuggestSkills

根据主题关键词渲染一张用户可以添加的独立 skill 卡片（尚未启用的 skill）。

## 何时使用

- 用户请求匹配了他们尚未启用的 skill（用户主动询问时 `trigger="user_asked"`；你未经请求主动建议时 `trigger="proactive"`）。

## 启用方式

- 仅在连接了 Remote Control 客户端，或会话运行于受管云端环境时可用。
- 在 HIPAA 企业配置下禁用。
- brief 模式下不可用。

## 参数

- `keywords` (array of strings, 必填)：来自用户请求的主题关键词。1–8 项，每项 1–64 个字符。
- `contextLabel` (string, 可选)：把建议与请求关联起来的简短标签（最多 128 个字符）。
- `trigger` (string, 可选)：本建议如何发起——`user_asked` 或 `proactive`。

## 示例

### 示例 1：按主题建议 skill

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

已启用的 skill 会被从结果中过滤掉。

## 注意事项

- 只渲染建议卡片——添加 skill 在带外进行；之后调用 `ListSkills` 确认。
