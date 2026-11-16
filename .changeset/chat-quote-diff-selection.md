---
"cc-viewer": patch
---

feat(web): 「添加到对话」覆盖 Edit/Write 代码 diff、工具卡片参数区（Agent 等的 prompt/description 等 KV 文本）与 AskUserQuestion 交互卡片（问题 + 选项文本）；diff 按选中可见纯代码文本引用（不含行号/+/- 前缀与文件路径）；选项行拖选文本时不会误触切换选项。Coverage: `chat-quote-i18n.test.js`.
