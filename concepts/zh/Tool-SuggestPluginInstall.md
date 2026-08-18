# SuggestPluginInstall

根据 `SearchPlugins` 结果渲染内联插件安装卡片，把插件建议与用户请求关联起来。

## 何时使用

- 插件搜索找到了与用户正在做的事情匹配的插件，而你想提供它们以供安装。

## 参数

- `contextLabel` (string, 必填)：把建议与用户请求关联起来的简短标题（最多 128 个字符）。
- `plugins` (array, 必填)：来自 `SearchPlugins` 结果的插件——1–16 项，每项包含：
  - `pluginId` (string, 必填)
  - `pluginName` (string, 必填)
  - `description` (string, 必填)
  - `skills` (array, 可选)：最多 32 个描述该插件 skill 的 `{name, description?}` 条目。

## 示例

### 示例 1：提供匹配的插件

```
SuggestPluginInstall(
  contextLabel="For reviewing pull requests",
  plugins=[{pluginId="pr-toolkit", pluginName="PR Toolkit", description="Review helpers"}]
)
```

卡片为用户渲染；启用插件在带外进行。后续调用 `ListPlugins` 可发现实际安装了什么。

## 注意事项

- 只包含来自搜索结果的插件——永远不要编造插件条目。
- 在 HIPAA 企业配置下禁用。
