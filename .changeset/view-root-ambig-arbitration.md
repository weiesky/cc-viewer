---
"cc-viewer": patch
---

fix(web): **修复附着撞名项目时文件树/Git/技能等只读面板全部 Failed to load** — 工作区注册表同名不同路径残留（如项目搬过目录）会让 view-root 解析硬 400 ambiguous，附着该项目时整个左侧只读面板不可用。现 `resolveViewRoot` 撞名改三级裁决：恰好一个活 PTY → 采用其真实目录（附着=看正在跑的项目，live 记录权威）；无活 PTY → 剔除目录已消失的 registry 候选，剩唯一则采用；仍有多个真实候选才保持 400 不静默选错。同名的 bound-by-name 不再无条件短路——绑定项目与并行项目同名且并行项目在跑时，`?project=` 正确解析到并行项目而非绑定目录。`registerWorkspace` 顺带自愈：注册时剔除同名且 path 已不存在（仅 ENOENT/ENOTDIR，瞬时不可读挂载不误删）的旧条目。文件树错误态由裸「Failed to load」改为展示服务端返回的具体原因（新增 `ui.fileExplorer.loadFailed` ×18 locales，根目录与子目录加载共用，切换项目前清旧错误）。Coverage: `view-root.test.js`, `workspace-registry.test.js`, `new-ui-i18n.test.js`.
