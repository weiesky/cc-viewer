---
"cc-viewer": patch
---

feat(web): 新建工作区目录树「启动」一步直启，不再先入历史列表再让用户二次点击。`/launch` 服务端内部本已 `registerWorkspace`(等价于 add),历史列表照常刷新;目录树选中的条目按 path 复用列表行的 `logCount` 启发式(>0 → 注入 `-c` 续接历史会话),未在列表的视为新工作区不带 `-c`。
