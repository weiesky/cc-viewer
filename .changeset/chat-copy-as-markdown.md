---
"cc-viewer": patch
---

feat(web): 框选 assistant 消息复制时自动转回 markdown 源码(text/plain)+ 渲染 HTML(text/html);`data-md-file` 本地链接还原为角括号包裹的 `[text](<path>)`。Coverage: `markdown-copy.test.js`.
