# ProposeGoal

为会话提出一个可验证的完成目标。该目标（默认）在审批对话框中展示给用户，一旦设定，便引导后续对话朝着一个可检查的结果推进。

## 何时使用

- 会话有一个评估者可以从对话中验证的具体终态（例如「test/auth 中的所有测试通过」）。
- 你希望在开始实质工作之前，让用户明确确认「完成」的含义。
- 用户自己的话已经陈述了结果，你希望将其记录为会话目标。

## 参数

- `condition` (string, 必填)：完成条件，写法要让一个独立的评估者能从对话中验证（例如「test/auth 中的所有测试通过（bun test 退出码为 0）」）。最多 500 个字符——用户必须能在审批对话框中读到完整条件。
- `ask_user` (boolean, 可选)：设定目标之前是否征求用户审批。默认 true（展示审批对话框）。仅当用户在本对话中的原话已把该结果陈述为他们想要的时才设为 false；此时目标直接设定并显示可见提示，用户可用 `/goal clear` 清除。

## 示例

### 示例 1：提出有测试支撑的目标

```
ProposeGoal(condition="npm run test exits 0 with the new catalog cases included")
```

用户会在审批对话框中看到该条件，并可以接受、编辑或拒绝它。

### 示例 2：直接采纳用户陈述的结果

```
ProposeGoal(condition="the login form validates email format and shows an inline error", ask_user=false)
```

仅当用户此前在对话中明确陈述过该结果时才有效。

## 注意事项

- 保持 `condition` 简短且可客观检查——含糊的目标（「做得更好」）达不到目的。
- `ask_user=false` 严格限于用户自己陈述过的结果；其他一切都必须经过审批对话框。
