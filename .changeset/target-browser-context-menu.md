---
"cc-viewer": patch
---

feat(web+server): CLAUDE.md/skill 文件浏览器弹窗支持右键菜单与预览编辑。新增 `/api/target-*` 写路由，从 target 身份服务端重新解析导航根（admin+同源校验、realpath 容器内校验、符号链接拒绝、`isWriteAllowed` 写策略兜底 ~/.claude 凭据/敏感前缀目录/LOG_DIR/备份目录，rename/delete 均做子树扫描防止绕过）。OS「在系统中展示/在终端中打开」逻辑抽取为共享 helper 供项目与 target 路由复用。拖拽/上传/移动仍保持只读。
