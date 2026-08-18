# ListSkills

列出用户已启用的 claude.ai skill，可选按关键词过滤。

## 何时使用

- 你需要当前已启用 skill 的权威列表——在调用某个 skill 之前，或确认 `SuggestSkills` 卡片添加了什么。
- 用户询问他们有哪些 skill。

## 启用方式

- 需要插件注册表访问权限。
- 在 HIPAA 环境中禁用。
- 在远程会话中始终可用。

## 参数

- `keywords` (array of strings, 可选)：过滤列表——最多 8 项，每项 1–64 个字符。省略则列出全部。

## 示例

### 示例 1：列出已启用的 skill

```
ListSkills()
```

### 示例 2：按关键词过滤

```
ListSkills(keywords=["review"])
```

## 注意事项

- 若目录不可达（被禁止），工具会降级为带警告的空列表，而不是失败。
- 本工具列出*已启用*的 skill；用 `SuggestSkills` 呈现用户可以添加的 skill。
