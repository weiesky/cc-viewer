# Changelog

## 1.6.217 (2026-04-27) — MdxEditor 解析失败自动降级到旧 marked + popupContainer 10px 占位 strip 修复 + UltraReview 重命名 + Force GUI Edit 锁解除 + 1-frame 红横幅闪烁抑制

- Feature (MDXEditor 解析失败自动降级到旧 marked 渲染): 当 `.md` 内含 MDXEditor 解析不动的 mdast 节点（如 `<system-reminder>` 这类自定义 JSX 标签 → `mdxJsxFlowElement`），用户原本会看到红色 "Parsing of the following markdown structure failed" 横幅；本版接 MDXEditor 的 `onError({ error, source })` 回调，向上抛 `onParseError` 给父组件，`FileContentView.jsx` 新增 `mdxParseErrored` state 并并入 `useMdxEditor` 合取条件，触发后 `<MdxEditorPanel>` 卸载，回退到既有 `useLegacyPreview` 路径——和 `extensionDetected` 命中（mermaid / 公式 / 指令块）一致的 marked 渲染。每次切文件 `loadFileContent` 重置标志，单文件失败不污染兄弟文件。新增 i18n key `ui.mdEditor.parseFallbackToast` 18 语言。
- Fix (MDXEditor `_popupContainer` 持续 10px 占位 strip 撑出整页滚动条): MDXEditor 把 `_popupContainer` 作为 portal 根节点常驻挂在 `<body>` 下，即便没有任何 popover 打开也存在。原 `MdxEditorPanel.module.css` 把它和 `_selectContent` / `_toolbarCodeBlockLanguageSelectContent` / `_toolbarNodeKindSelectContainer` / `_toolbarButtonDropdownContainer` 一起套了 padding/border/min-width 样式，空容器被渲染成 padding(4)+border(2)+min-width(144) 的可见 strip，1800×10px——撑高 body 让全页面出现纵向滚动条。本版把 `_popupContainer` 拆出来单独成一条规则只保留 `position:absolute; top/left:0; width:0; height:0; z-index:1500;`，0 占位但保留 stacking context；真正 popover 在它内部仍按 Radix 的 fixed/transform 自定位。同时把它从 dark-theme 块里移除（无视觉样式后那里是死规则）。
- Fix (Force GUI Edit 在 parse-error 锁定后被静默吞掉的 UX 死路): `useMdxEditor = … && (!extensionDetected || forceMdxOverride) && !mdxParseErrored` 引入新合取项后，用户在解析失败下点 "Force GUI 编辑" 触发的 `forceMdxOverride=true` 会被 `&& !mdxParseErrored` 否决，按钮看着可点但毫无反应。`requestForceMdx` 的 `onOk` 同步清掉 `mdxParseErrored`——让用户主动 force 时合取条件真重新求值；重试本身可能再次失败但那是 onError 重新触发的事，不在 force 这层吞 user intent。Code review regression-reviewer 提出。
- Fix (1-frame 红横幅闪烁抑制): MDXEditor 的 `tryImportingMarkdown` 在同一 Gurx pubIn 里既触发 `markdownErrorSignal$`（我们的 onError）又把红横幅写进 `markdownProcessingError$`。setState 走下一帧才生效，浏览器可能在中间 paint 一次红横幅。新增 `mdxWrapperRef` + 在 `handleMdxParseError` 内同步 `wrapper.style.display='none'`，让中间 paint 时 wrapper 已经隐藏，下一帧 mdxParseErrored=true 让 wrapper 直接卸载、inline style 失效。Code review sideeffect-reviewer #4 提出。
- Refactor (UltraPlan Agent Team 预设 "Code Review Team" → "UltraReview"): `i18n.js` `ui.preset.codeReview5.name` 18 语言统一更名；`utils/ultraplanTemplates.js:46` LLM 提示词正文里的 `assemble a "Code Review Team."` 同步改成 `assemble an "UltraReview" team.` 防止 UI 标签和 prompt 里指代漂移。`ui.preset.codeReview5.desc` 描述正文保持原样（描述说"Code Review"，预设名说"UltraReview"，自洽）。
- Code Review (5 reviewer 并行评审, 采纳 P0 2 项 + P1 1 项): req-verifier 全 MET、quality-reviewer / css-ux-reviewer 干净 PASS；regression-reviewer 标 1 个 CONCERN（Force GUI 死路）+ sideeffect-reviewer 标 1 个 FIX-RECOMMENDED（1-frame flash），均已落地；req-verifier Q1（ultraplanTemplates 文案同步 UltraReview）作为低风险一致性修复一并打包。其余 nit（onError prop 未消费 / 加 useCallback 包裹 / payload source 进 toast / CSS 注释加上游链接）作为 future-only 不阻塞。
- Test / Build: `npm run test` 1283/1283 绿；`npm run build` 通过。

## 1.6.216 (2026-04-27) — 代码浏览器字体收敛 12px + AskUserQuestion "Other" Enter 提交修复 + MdxEditor inline code 去背景/内边距 + README 多语言重构 + history 1.6.0~1.6.199 压缩归档

- Feature (代码浏览器主字体统一 12px): 文件浏览器（`FileContentView`）和 git 变更代码浏览器（`FullFileDiffView`）的代码字体从 13px 降到 12px，包括左侧行号列。`FileContentView.jsx:114` `.cm-scroller` `fontSize: '12px'`、`FileContentView.module.css:375` `.lineNumRow` `12px`、`FullFileDiffView.module.css:50` `.codeContainer` `12px`、`.lineNumRow`/`.codeLine` `min-height: 21px → 20px`（按 12×1.6=19.2 重算）。两侧均使用无单位 `line-height`（1.5/1.6），所以 font-size 改动后内容和 gutter 自动同步缩放，不会出现行号与代码行错位；`.oldLineNum/.newLineNum` 原本就是 12px，现与正文统一。
- Fix (`AskQuestionForm` "Other" 输入框 Enter 误触提交): `src/components/AskQuestionForm.jsx:189` 的 `<Input onPressEnter={...}>` 监听器被移除。原行为：用户在自定义 Other 文本框里打字，回车会立即提交整张问题表单；改后：回车在该 input 内是默认行为（无副作用），只能点 Submit 按钮主动提交。
- Fix (MdxEditor inline code 去 `background` 与 `padding`): `src/components/MdxEditorPanel.module.css:253` `.contentEditable code, .contentEditable [class*='_code_']` 删除 `background: var(--code-inline-bg)` 与 `padding: 0.15em 0.4em`，仅保留 `color`/`border-radius`/`font-family`/`font-size`，避免与 panel 背景叠加产生视觉色块。
- Docs (README 16 语言重构 + 中文母版): `docs/README.zh.md` 移除"15 年研发专家"前缀，5 条卖点扩展成 6 条带短标签（提升能力上限 / 多端同时适配 / 完整日志留痕 / 学习经验分享 / 保持原生体验 / 适配三方模型），新增"前提"小节（Node.js 22+ 与 Claude Code 安装链接），原 `### 安装` 改名 `### 安装ccv`，原 `### 编程模式`（在使用方法章节下）改名 `### 启动方式`（功能章节里的 `### 编程模式` 保留），启动示例从 6 行 ccv 透传压成 1 行并补"ccv 透传所有 claude code 启动参数"注释，下载链接内联到一行。同步刷新 `README.md` 以及 `docs/README.{zh-TW,ja,ko,de,es,fr,it,da,pl,ru,ar,no,pt-BR,th,tr,uk}.md` 共 17 份；语言导航行、图片 URL、npm 安装命令保持不动。
- Refactor (history.md 1.6.0~1.6.199 压缩归档): 1704 → 488 行（-71%）。1.6.215 → 1.6.200 完整保留逐版本明细；1.6.0 → 1.6.199 合并为 `## 1.6.0 ~ 1.6.199 版本汇总` 一节，按主题分 6 个时间段（180-199 / 160-179 / 130-159 / 100-129 / 50-99 / 0-49），每段 8-15 条单行高频亮点，与既有 `## Pre-1.6 版本汇总` 风格对齐。
- Test / Build: `npm run test` 1283/1283 绿；`npm run build` 通过。

## 1.6.215 (2026-04-26) — 部署后陈旧 chunk 自愈：server cache + lazy reload

### Fix — 部署后点 .md 文件偶现 "Failed to load module script" / "Failed to fetch dynamically imported module"

**Bug**：用户截图报错链 `MdxEditorPanel-DopLe99x.js` MIME=text/html → strict MIME check 拒绝 → ESM 加载失败。grep 当前 dist 全无 `DopLe99x` 哈希，`MdxEditorPanel-CBnnOH_c.js` 才是真。

**根因**：
1. SPA + content-hashed chunks + lazy load。`npm publish 1.6.214` 后，`MdxEditorPanel` chunk 哈希从 `DopLe99x` 变到 `CBnnOH_c`。
2. 服务端 `server.js:2934` 静态文件响应**没设任何缓存头**，浏览器用默认启发式缓存 → 用户升级 server 后浏览器还在用陈旧 `index.html` 引用旧 chunk 名。
3. `server.js:2942` SPA fallback 不区分路径：找不到的 `/assets/*.js` 也回退给 `index.html` (`text/html`) → 浏览器 strict MIME 拒绝 → `import()` 抛 `TypeError: Failed to fetch dynamically imported module`。

**修复（双层）**：

**Server 层（杜绝问题源头）**：
- `server.js:2934` 分桶 `Cache-Control`：
  - `/assets/*` (内容哈希命名) → `public, max-age=31536000, immutable`（性能也提升）
  - `index.html` 等 → `no-cache`（每次回源校验，禁止陈旧入口）
- `server.js:2949` 新增短路：`/assets/*` 找不到时返回 `404 text/plain`（带提示），**不走** SPA fallback。否则浏览器拿到 `text/html` 当 ESM 加载会报 strict MIME，错误堆栈反而误导排查方向。

**Client 层（陈旧标签页自愈）**：
- 新增 `src/utils/lazyWithReload.js` 三层 API：
  - `shouldReloadStaleChunk(name)` — primitive，仅判断 + 写时间戳。
  - `reloadOnStaleChunk(name)` — 即时 reload（给 main.jsx 这种没 UI 的入口用）。
  - `handleStaleChunk(name, err, { onReload })` — Suspense 友好：先跑 `onReload`（如 toast），200ms 后才真 reload，给 UI 一帧时间画出来；返回永不 resolve 的 Promise 让 React 卡在 fallback 直到 reload 接管。
- 每个 chunk name 单独 `sessionStorage` timestamp，5 分钟时间窗内不重复 reload（连续两次升级时抛原 error 让上游处理，避免死循环）。
- `sessionStorage` 访问全部 `try/catch` 兜住 SecurityError / QuotaExceededError（Safari Private / quota / sandboxed iframe / 严格 CSP）。
- 接入：`src/main.jsx:14` 入口 chunk (`App` / `Mobile`) 命名空间隔离；`src/components/FileContentView.jsx:32` MDXEditor chunk 走 `handleStaleChunk` 带 antd toast 提示。

**i18n**：
- `src/i18n.js` 新增 `ui.chunkOutdatedReloading` × 18 语言。

### 受影响文件

- 新增：`src/utils/lazyWithReload.js`
- 修改：`server.js` / `src/main.jsx` / `src/components/FileContentView.jsx` / `src/i18n.js`

## 1.6.214 (2026-04-26) — /clear 触发 Header 血条乐观重置 + MdxEditor light 白底 + 保存按钮高亮

### Feat — /clear 后 Header 上下文血条立即乐观重置到低位

**Why**：用户点 `/clear`（ChatView slash 命令路径 / TerminalPanel PTY 路径）后，真实的 `context_window` SSE 推送有几百 ms ~ 数秒延迟，期间 Header 血条仍停在清理前的高水位（70%+），视觉上像没生效。

**做法**：在 AppBase 加 `contextBarOptimistic` state，触发 `/clear` 时立即翻 true，AppHeader / Mobile 渲染血条时若 flag 为 true 直接覆盖 `contextPercent = OPTIMISTIC_CLEAR_PERCENT (5)`；下一次 `context_window` SSE 到达时 `setState({ contextWindow, contextBarOptimistic: false })` 把覆盖摘掉，自然回到真实值。

**韧性**：
- **30s safety timeout**：SSE 永远不来（PTY 未连接 / 后端没推 / CLI 崩了）时 timer 兜底清 flag，避免血条永远卡 5%。SSE 到 / 重复 /clear / `componentWillUnmount` 都会清旧 timer。
- **gate 在真发送之后**：`ChatView.jsx` 把回调挪进 `if (textarea)` 块内，`TerminalPanel.jsx` 挪进 `if (ws.readyState === OPEN)` 块内 — ref 为空 / WS 断开时不再误把血条压低。
- **常量化**：抽 `OPTIMISTIC_CLEAR_PERCENT = 5` 在 `AppBase.jsx`，`Mobile.jsx` / `AppHeader.jsx` import 使用，避免双写飘移。

### Style — MdxEditor 雪山白（light）模式 + 保存按钮高亮引导

- MdxEditor light 模式编辑区 / CodeMirror / 行号 gutter 全部拉到纯 `#FFF`（默认 `--bg-elevated` 在 light 是 `#F9F9F9` 偏灰，编辑器要"纸面"质感）；当前 activeLine / activeLineGutter 浅蓝高亮在 light 模式下去掉（白底纸面下高亮反而成视觉噪音）；dark 模式不受影响。
- DiffSourceToggleWrapper 简化：去掉 `--bg-base-alt` 浅底 + 左侧 box-shadow（light 模式下跟父级白 toolbar 形成可见灰条），保留 sticky / margin-left:auto 等定位。
- `_toolbarRoot` 去 `--bg-base-alt`，加 `border-radius: 0`，与编辑区底色统一。
- FileContentView 保存按钮：高度对齐到 28px（`min-height` + `box-sizing` + `line-height: 18px` 与 `.viewToggleBtn` / `.closeBtn` 同档），SVG 图标 16→14；激活态（`!disabled`，即有未保存改动）改用 primary 蓝字 + 蓝边框，hover 走 primary-bg-light 浅蓝底，与 disabled 灰态形成"灰 vs 蓝"对比，远比之前"灰 vs 灰带不透明度"显眼。

### 受影响文件

- 修改：`src/App.jsx` / `src/AppBase.jsx` / `src/Mobile.jsx` / `src/components/AppHeader.jsx` / `src/components/ChatView.jsx` / `src/components/TerminalPanel.jsx` / `src/components/FileContentView.jsx` / `src/components/FileContentView.module.css` / `src/components/MdxEditorPanel.module.css`
- 不动：后端、i18n（无新用户文案）、依赖

## 1.6.213 (2026-04-26) — 文件浏览器 markdown 改用 MDXEditor (GUI WYSIWYG)

### Feat — 文件浏览器 .md 文件改用 MDXEditor 所见即所得编辑

- `viewMode === 'markdown'` 分支由原 `marked` 只读预览替换为 `MDXEditor` (Lexical 内核, GUI WYSIWYG) 实时编辑；`viewMode === 'text'` (CodeMirror 源码模式) 保持不变作为逃生通道。
- Toolbar 用 MDXEditor 内置 primitive 组件 + cc-viewer CSS 变量重映射（dark/light 自动跟随主题切换），按钮风格向 AntD 靠拢；中文界面下 MDXEditor 内部 dialog/menu 文案走自定义中文覆盖。
- 图片粘贴/拖入：浏览器端 canvas 压缩（最大边 2000px / JPEG q0.85），结果以 base64 内联到 markdown，**无后端改动**、.md 文件可移植。
- 兼容性保护：打开 .md 时预扫描 `mermaid` / `$$ math $$` / `:::directive` 等 MDXEditor 原生不支持的扩展，命中则自动 fallback 到旧 marked 渲染并 toast 提示，旁边给「强制 GUI 编辑」按钮（带二次确认）。
- Feature flag：默认开启；用户可在浏览器 devtools 执行 `localStorage.setItem('mdxEditorEnabled','false')` 一键回退到旧 marked 渲染（无需重新部署）。
- viewMode 切换前 dirty 守护：未保存修改时弹 Modal.confirm 让用户选择丢弃/保留。
- 「Save as Image」按钮在 GUI 编辑模式下灰化（截图视觉与项目主题不一致），需切到 Text 或 fallback 预览模式才能用；「Copy text」自动从 MDXEditor ref 取最新 markdown。
- `vendor-mdxeditor` 单独 chunk + `React.lazy`，仅在打开 .md 文件且 GUI 模式时才下载（260 KB gzip），不影响首屏。
- **DiffSource 三态切换器**：toolbar 右侧 sticky overlay 的 Rich Text / Diff / Source 三视图切换。Diff 模式基于 `@codemirror/merge` 的 MergeView 显示"已编辑 vs 原始"差异；Source 模式提供完整 CodeMirror 6 + markdown 高亮 + 行号编辑源码。GUI 模式下头部「查看 Text」按钮自动收敛（避免与 Source 切换重复），fallback / 移动端 / 含扩展自动降级时恢复显示。
- **Scroll 修复 trick**：diffSourcePlugin 的 `DiffSourceWrapper` 在 toolbar 与 contenteditable 之间插入 2 层 div（`mdxeditor-diff-source-wrapper` + `mdxeditor-rich-text-editor`），其中内层带 inline `style="display: block"` 切换 viewMode。常规 CSS 无法覆盖 inline style（需 `!important`，与项目硬约束冲突）。利用 **flex/display 正交特性**：inline `display: block` 不影响该元素作为 flex item 被父容器 `flex: 1` 拉伸；`.mdxeditor-rich-text-editor { flex: 1; min-height: 0 }` 接到外层 flex column 的具体计算高度，再让其 block 子元素 `.mdxeditor-root-contenteditable { height: 100% }` 接力，contenteditable 的 `overflow: auto` 即可正常滚动。零 `!important`、零 inline style 覆盖。

### 已知局限（v1）
- MDX 模式不支持 mermaid / 数学公式 / directive，命中时自动走旧 marked 渲染；后续版本接 `directivesPlugin` 解决。
- 「Save as Image」在 MDX 模式下灰化，v2 将做专用截图路径。
- MDXEditor 内部文案目前仅覆盖中文，其他 17 种语言走英文 fallback。
- base64 内联会让含图 .md 在 git diff / IDE 里出现长字符串污染，可加 git attribute `*.md diff=markdown-no-base64` 缓解。

### 受影响文件
- 新增：`src/components/MdxEditorPanel.jsx` / `MdxEditorPanel.module.css` / `src/utils/imageCompress.js` / `src/utils/mdExtensionDetect.js` / `src/i18n/mdxZh.js`
- 修改：`src/components/FileContentView.jsx` / `src/i18n.js` (+18 keys × 18 langs) / `vite.config.js` (manualChunks +1) / `package.json` (devDep +1)
- 不动：`src/global.css` / `MarkdownBlock.jsx` / `ChatMessage.jsx` / `ToolResultView.jsx` 等其他 6 处 markdown 渲染点 / 整个后端

## 1.6.212 (2026-04-25) — /clear 后首条 user 输入错位修复 + 数据统计入口迁到左侧 sidebar

### Fix — /clear 后首条 user 输入在 ChatView 中错位

**Bug**：`/clear` 后第一条 user 输入（含 `/clear` 命令气泡、Session 分隔条、用户文字+图片）会被显示在后面某个时间点（实际数据中是 3 分钟后的下一条 mainAgent 请求位置），16:12:11 真实位置一片空白。

**根因链**：
1. CC 写 JSONL 用 delta 格式：每条 mainAgent entry 只存自上次 checkpoint 起的新增 messages，配合 `_isCheckpoint` / `_totalMessageCount` 字段。
2. `lib/delta-reconstructor.js:reconstructEntries` 在 batch 加载时把 delta 拼回完整 messages。
3. `_processEntries` 的 isTransient 过滤（`src/AppBase.jsx:177`）把"长对话后突然 ≤4 条"的 entry 当作"中间态"丢掉——但 `/clear` 后的真实首请求（count=1）正好踩中这个条件。
4. 同 device 下 `metadata.user_id` 永远相同，SSE 路径的 `isNewSession = !sameUser && ...`（`src/AppBase.jsx:1046`）也永远不会触发，导致 L1058 的"按下标继承 prev `_timestamp`"把旧会话的时间戳灌到 /clear 后的 msg 上。
5. `sessionMerge` 同 device 走 same-session 分支，把 /clear 那条 msg 当作 checkpoint 替换合并进旧 session，没有产生新 session 边界。
6. 直到第一条 count > 4 的延后 entry，timestamps 才被 reset，前面所有 reconstructed messages（包括 /clear 那条）的 `_timestamp` 都被改写成那个延后 entry 的时间戳。

**修复**：新增 `isPostClearCheckpoint(entry, prevMessageCount)` 检测——同时满足 `_isCheckpoint=true` + `messages.length < prevMessageCount`（真正缩短）+ `msg[0]` 含 `<command-name>/clear</command-name>` 才算。三处调用：
- `_processEntries`：把它纳入 isNewSession 触发条件并豁免 isTransient，强制重置 timestamps，让 msg `_timestamp` 用 entry 自己的 ts。
- SSE 增量合并路径：同样纳入 isNewSession，跳过 prev `_timestamp` 继承。
- `mergeMainAgentSessions`：在 transient 过滤之前先检测，命中即创建新 session 条目（不走 same-session checkpoint 替换）。

`/compact`（msg[0] 是 summary，没有 /clear 标记）和"同会话再快照"（count ≥ prevCount）和旧格式日志（无 `_isCheckpoint`）都不会误触发，行为保持。

- Feat (`src/utils/clearCheckpoint.js`)：新增独立无依赖模块 `isPostClearCheckpoint`（不引 contentFilter，便于 node --test 直接 import）。
- Refactor (`src/utils/contentFilter.js`)：re-export `isPostClearCheckpoint`，对外接口不变。
- Fix (`src/utils/sessionMerge.js`)：transient 过滤前先识别 /clear checkpoint，命中创建新 session 条目。
- Fix (`src/AppBase.jsx`)：batch `_processEntries` 与 SSE 增量合并路径都纳入 `postClearCheckpoint` 信号，纠正 `_currentSessionId` / `timestamps` / per-msg `_timestamp` 归属。
- Test (`test/clearCheckpoint.test.js`)：24 条直接单测覆盖 helper 全部分支（null entry、`_isCheckpoint` 严格相等、shrink check、msg[0] role/content 边界、/clear marker 在任意 text block、real-world fixture parity）。
- Test (`test/incremental-merge.test.js`)：7 条 sessionMerge 集成测覆盖 batch 路径、SSE 路径、/compact 不误判、同会话再快照不误判、旧格式日志不误判、连续 /clear 不重复增殖 session、/clear 路径下 timestamp=null。1257 → **1283** 全绿。

### Refactor — 数据统计入口从 Header 顶部 Tag 迁移到左侧 navSidebar

PC 端 Header 顶部的「数据统计」胶囊 Tag（i18n key `ui.tokenStats`，hover 显示 token / cache / tool / skill 用量）迁移到 ChatView 左侧 navSidebar，作为 fileExplorer/gitChanges 之后、TeamButton 之前的一个 stroke-only 仪表盘图标按钮。Header 进一步精简，"辅助信息"集中到 sidebar；Mobile 端走 Mobile.jsx 不受影响。

- Refactor (`src/App.jsx`): 加 `appHeaderRef`，给 `ChatView` 透传 `getTokenStatsContent` prop。
- Refactor (`src/components/AppHeader.jsx`): 删除 Header 上的 token stats Popover + Tag trigger；`renderTokenStats()` 方法保留作为 instance method，由外部 ref 调用。
- Refactor (`src/components/AppHeader.module.css`): 清理已不再使用的 `.tokenStatsTag` / `.tokenStatsIcon` 样式。
- Refactor (`src/components/ChatView.jsx`): cliMode 双分支重复的 navSidebar JSX 抽成 `_renderNavSidebar(showFileExplorerAndGit)` 私有方法；新增「数据统计」Popover 按钮。

## 1.6.211 (2026-04-25) — Per-message 模型头像 1v1 严格匹配，消除历史消息被最新 model 污染

此前 ChatView 内 `resolveModelInfo` 对所有消息的模型头像解析都回落到 `globalModelInfo`（最新一轮 response 的模型），导致 loadEarlier 载入的历史消息显示为当前模型而非当时实际使用的模型。本次改为 **1v1 严格匹配**：每条消息的 modelInfo 来自它自己那条 request 的 effectiveModel，未匹配时返回 null 显示中性头像，不再污染历史。

**关键 off-by-one 修复**：`_processEntries` 给 assistant message 赋的 `_timestamp` 是下一轮 entry 的 ts（详见 `src/AppBase.jsx:184-186` 与 `src/utils/sessionMerge.js:44/50`），所以 assistant 的生产者 req idx = tsToIndex[ts] - 1；user message 的生产者 idx = tsToIndex[ts]。

- Feat (`src/utils/helpers.js`):
  - 新增 export `resolveProducerModelInfo(ts, role, tsToIndex, modelNameByReqIdx)` —— per-message 模型解析，1v1 严格遵从，不回落到全局最新 model
  - assistant 消息做 `idx - 1` 修正 off-by-one；idx=0 时 clamp 到 0（mid-session 启动边界，用当前 entry model 作为最佳估计）
- Refactor (`src/components/ChatView.jsx`):
  - `resolveModelInfo` 改用 `resolveProducerModelInfo(ts, msg.role)`，传入 role 用于 off-by-one 判断
  - `globalModelInfo` 仅保留给 `lastResponse` 路径（最新一轮 response 渲染），不再作为 per-message 回落值
- Test (`test/helpers.test.js`):
  - 11 条新 `resolveProducerModelInfo` 用例：user 消息 producer=idx、assistant off-by-one、mid-session clamp、ts 缺失/null/undefined、producer slot 为空、loadEarlier 全量重扫等
  - 1241 → **1252** 绿。`npm run build` 全绿。

## 1.6.210 (2026-04-25) — 模型名解析改为 response 优先 + 新增 deepseek-v4 1M 上下文识别

cc-viewer 引入"代理热切换"（proxy hot-switch）能力后，客户端 request 里 `body.model`（用户期望的模型，例如 `claude-opus-4-6`）和 server 实际路由的模型（例如 `deepseek-v4`）可能不同——`response.body.model` 才是权威标识。本次把 UI 路径上读 model 的全部位置切换到 response 优先；同时给 `MODEL_CONTEXT_SIZES` 加 `deepseek-v4` → 1M 规则。

**核心抽象**：`src/utils/helpers.js` 新增 `getEffectiveModel(request)` —— 返回 `request?.response?.body?.model || request?.body?.model || null`。签名严格接受 request 对象，所有 UI 消费者统一用它。

- Feat (`src/utils/helpers.js`):
  - 新增 export `getEffectiveModel(request)`，response 优先 → request 回落 → null
  - `MODEL_CONTEXT_SIZES` 在通配 `/deepseek/i` 之前插入 `{ match: /deepseek-v4/i, tokens: 1000000 }`。顺序关键：循环 first-match-wins，v4 必须在通配前。子串匹配语义（substring，前后任意字符），符合"\*deepseek-v4\*"的需求表达。
- Refactor (5 个 UI 消费点全切到 `getEffectiveModel`):
  - `src/components/AppHeader.jsx:1434` —— token 进度条分母按 effective model 算 max tokens
  - `src/Mobile.jsx:343 + 380` —— mobile sidebar header model + token 进度条
  - `src/components/ChatView.jsx:1058-1067` —— `_reqScanCache.modelName` carry-over loop（影响 ChatMessage 头像、UltraPlanModal/TerminalPanel 接的 modelName prop）
  - `src/utils/teamModalBuilder.js:22-26` —— team modal 头部 model 图标识别
- Out-of-scope（本次未动，行为保持）:
  - `interceptor.js` 5 处 model 缓存仍读 request.body.model：设计正确，请求阶段无 response
  - `lib/stats-worker.js:154-155` 仍为 request 优先反向语义（按 model 聚合 token 统计）：UI 改 response 优先后两套语义割裂，留作后续 PR 单独评估对齐
  - `entry-slim.js`：已验证 slim 不丢 response 字段（response 是 entry 顶层），无需改
  - `UltraPlanModal.jsx` / `TerminalPanel.jsx`：接 `modelName` prop，源头改后自动传递
- 设计审查：3-agent code review team（requirements / regression / code-quality）round-1 已在 plan 阶段把 API 签名清晰化（接 request 对象不接字符串）和 null-safety 测试覆盖（7 条）吸收进实施；round-2 regression-auditor 全绿，唯一 🟡 是 stats-worker 反向优先（已 out-of-scope）。
- Test (`test/helpers.test.js`):
  - inline `MODEL_CONTEXT_SIZES` 同步加 `deepseek-v4` 规则
  - 5 条新 `getModelMaxTokens` 用例：`deepseek-v4` / `deepseek-v4-turbo` / `mycompany-deepseek-v4-ft` 都 1M；`deepseek-v3` / `deepseek-r1` 仍 128K（验证 v4 不过宽匹配）
  - 7 条新 `getEffectiveModel` 用例：response 优先（hot-switch）/ response 缺失回落 / response.body 无 model 回落 / 双缺 null / null input / undefined input / 空对象
  - 1230 → **1241** 绿。`npm run build` 全绿。
- Chore: bump 1.6.210。

## 1.6.209 (2026-04-25) — KV-Cache-Text 复制路径用 on-model XML 形态 + formatter 抽到 lib/

KV-Cache-Text tab 的 "复制全部" 按钮原先输出 `name: description` 单行加 `=== Tools ===` 等装饰 header；用户场景是把这段文本粘到其他 LLM 会话直接复用，原格式既不忠实于模型 server 侧看到的形态，也丢了 tool schema 细节。本次重写为 Claude 2.1 风格的 XML 文本（tool / parameter / required / enum / default / items / properties），tools 用 `<tools>...</tools>` 外层包裹（每个 `<tool>` 缩进 2 空格），system 整段裹 `<system-reminder>`（利用 Claude 后训练对该标签的识别），三段之间空行分隔，去掉所有装饰 header。涵盖两个 commit：

**Feat (commit 811580b)**：
- `src/utils/toolsXmlFormatter.js` (新): `formatToolAsXml` / `formatToolsAsXml` 把 Anthropic tool schema 序列化为 XML 文本。
- `lib/kv-cache-analyzer.js` + `src/utils/helpers.js`: `extractCachedContent.tools[]` 元素从 `"name: description"` 改为完整 `<tool>` XML 块。两份 `extractCachedContent` 实现继续 keep-in-sync。
- `src/utils/helpers.js::parseCachedTools`: 升级为 XML-aware（regex 抽 `<name>` / `<description>`），保留旧 `"name: description"` 兜底以兼容历史日志导入。AppHeader builtin/MCP 分类不受影响。
- `src/components/DetailPanel.jsx::buildPlainText`：tools 加 `<tools>` 外壳 + 2 空格缩进，system 裹 `<system-reminder>`，去掉 3 个 section header。显示层（逐条 `<pre>`）维持原状，便于浏览。
- Test: `test/tools-xml-formatter.test` 新增 11 个 schema 变体；`test/helpers.test` inline copy 同步 + 2 条 XML-aware parseCachedTools 用例。

**Refactor**（本 commit，P1-A）：
- 把 formatter 的 canonical 实现从 `src/utils/toolsXmlFormatter.js` 挪到 `lib/tools-xml-formatter.js`（无 React 依赖，前后端共享）。`src/utils/toolsXmlFormatter.js` 缩为 thin re-export，外部调用方 import 路径不变。`lib/kv-cache-analyzer.js` 删除 47 行内联拷贝改为 import + 同名 re-export。3 处实现 → 1 处 canonical（test/helpers.test 的简化版按测试隔离需要保留）。

**设计取舍**：3-agent review team round-1 标 🔴 description / name / enum 嵌入未 XML escape，round-2 实施 escape 后又被 regression auditor 揪出 React 文本节点不会 auto-unescape，AppHeader chip popover 会显示 `&lt;` 字面量；权衡后**撤回 escape**，依赖 parseCachedTools 的 first-match 语义（tool 顶层 `<name>` 在 buffer 里必出现在 description 之前，非贪心匹配天然命中正确的 tool 名）。formatter 顶部加注释解释为何不 escape，避免未来误重做。

**Test**: 1225 → **1230** 绿（11 + 3 raw-passthrough 用例 - 5 escape 用例已撤）。`npm run build` 全绿。

**Chore**: bump 1.6.209。

## 1.6.208 (2026-04-24) — Windows 用户插件加载 ESM 修复（1.6.207 漏网）

1.6.207 发布后启动 3-agent Code Review Team 对 commit 6a8b904 做事后核验，`requirements-auditor` 捞到 **2 处漏网**：`lib/plugin-loader.js:57` 和 `lib/extract-plugin-name.mjs:12` 都用 `` `file://${filePath}` `` 模板字符串拼接，这在 POSIX 下碰巧能用（`file:///abs/foo.js` 恰好合法），但在 Windows 下产出 `file://C:\Users\...\foo.js`（缺第三个 `/`、反斜杠未转正斜杠），Node ESM 仍然拒收。用户安装自定义 plugin 场景下 1.6.207 仍会挂。

`pathToFileURL` 是**唯一**在 POSIX 和 Windows 上都能正确产出合法 `file://` URL 的 API，应统一使用。

- Fix (`lib/plugin-loader.js:57`): 用户 plugin 加载分支 `` import(`file://${filePath}`) `` → `import(pathToFileURL(filePath).href)`
- Fix (`lib/extract-plugin-name.mjs:12`): plugin name 提取子进程同样的拼法 → 同样的修复（新增顶层 `import { pathToFileURL } from 'node:url';`）
- Test (`test/windows-import-paths.test.js` 加固): 之前的 scanner 用 `/pathToFileURL|file:\/\//i` 子串匹配放行，导致上述 2 处 `file://` 拼接被误判为 safe。改为**严格**只接受 `pathToFileURL(` 作为 safe wrapper。同时把扫描文件扩展名从 `.js` 放宽到 `.[cm]?js`（原先跳过了 `.mjs` 是 extract-plugin-name.mjs 漏网的另一个原因）。新增一条负向用例锁死 `` `file://${path}` `` 模板拼接必须被 flag。1213 → **1214 绿**。
- Note: 本次修复同时解决了 1.6.207 review team 发现的 `quality-auditor` W3（scanner 不扫 `.mjs`）和 `regression-auditor` W1（`file://` 子串判定过宽）。
- Chore: bump 1.6.208。

## 1.6.207 (2026-04-24) — Windows ESM 全量适配 + PATH 分隔符

Windows 用户启动 Electron client 报 `ERR_UNSUPPORTED_ESM_URL_SCHEME "Received protocol 'c:'"`。1.6.206 只修了 `lib/plugin-loader.js:85`，3-agent team 再次扫描发现另外 **12 处**同类 bug，集中在 Electron 启动路径和拦截器上。本次系统性修齐，并加回归测试拦住未来同类 bug。

- Fix (Windows Electron 启动全链路 ESM URL 方案): 统一用 `pathToFileURL(p).href` 包裹 dynamic import。POSIX 下 `pathToFileURL('/abs/x.js').href === 'file:///abs/x.js'`，Node ESM 对"裸绝对路径"和 `file://` URL 行为等价，**macOS/Linux 零可观察变化**；Windows 下从 crash 变为正常加载。涵盖以下 12 处：
  - `electron/main.js` 5 处：line 20 `i18n.js`、21/83 `findcc.js`、117 `proxy.js`、120 `server.js`（前 2 个是 top-level await，是 Electron 启动时 **第一个** 命中的 dynamic import，Windows 用户必挂在 line 20）
  - `electron/tab-worker.js` 5 处：line 49 `ensure-hooks.js`、53 `proxy.js`、59 `server.js`、76 `interceptor.js`、96 `pty-manager.js`。这里提炼了一个小 helper `const importAbs = (p) => import(pathToFileURL(p).href)` 减少每次调用点的噪音
  - `interceptor.js` 2 处：line 440 `rootServerPath`、line 443 `libServerPath`（viewer service 启动 fallback 双路径）
- Fix (PATH 分隔符 Windows 碎片化): `electron/main.js` line 51/52/54/67/72 硬编码 `':'` 作为 PATH 分隔符，在 Windows 会把 `C:\Windows;C:\System32` 切成 `['C', '\\Windows;C', '\\System32']` 再拼回。改为从 `'path'` import 的 `delimiter`（POSIX `':'`，Windows `';'`）—— POSIX 字符等价，Windows 修 bug。line 51/52/54 本身在 `process.platform !== 'win32'` 守卫内，改动是向前兼容（future-proof）；line 67/72 才是真实踩坑路径。
- Test: 新增 `test/windows-import-paths.test.js` —— 静态扫描仓库内所有 root-level / lib/**/ / electron/**/ 下 `.js` 文件的 `await import(...)` 动态调用，参数不是静态字符串字面量时强制要求同一行（或紧邻 2 行）出现 `pathToFileURL` 或 `file://`。scanner 自身也有 sanity-check 测试（静态字符串不误报、不安全 pattern 必被 flag、合法 pattern 必通过）。未来开发者在 macOS 上新增 `import(join(...))` 会被这条测试拦住，不用等到 Windows 用户报错。1207 → **1213 绿**。
- Verification (Gate 1, POSIX 非回归): 实施后本机 macOS 跑 `npm run test` 1213 全绿 + `npm run build` 无新 warning + `git diff` 所有 `import(` 新增行 grep 命中 `pathToFileURL`。符合 "Windows 兼容建立在保护 Linux/Mac 原能力之上" 的约束。Windows 实机验收由用户侧 Gate 2 完成。
- Non-Goals: (1) Web 端 Windows 卡死 —— 并行调研结果留在 plan 附录，top-3 假设是 SSE streaming 刷新过频、Markdown 缓存失效、Mermaid MutationObserver 全局扫描。本次不动 React 侧，下轮加 instrumentation 坐实后再修。(2) electron/main.js 里 POSIX 硬编码路径 `/usr/local/bin`/`/opt/homebrew/bin` 在 Windows 下会被拼入 PATH 但无效无害，清理留给单独 PR。(3) PR #70 的 B1（bundled `plugins/http-api.js` 文件缺失）仍留给原作者 Majorshi 补齐。
- Chore: bump 1.6.207。

## 1.6.206 (2026-04-24) — PR #70 post-review hardening

4-agent team review of PR #70 (feat/http, merged 2b284f3) 收敛出 3 条 ship-blocking 小 fix，本次一并修复；B1 (bundled `plugins/http-api.js` claim 与实际文件不符) 留待原作者补齐。

- Fix (Windows bundled plugin ESM import 静默失败): `lib/plugin-loader.js:85` bundled plugin 加载分支用 `await import(join(bundledDir, file))` 传裸绝对路径，Windows 上 `join()` 产生 `C:\...` 反斜杠路径，Node `import()` 要求 `file://` URL，否则抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；错误被 catch 并静默（除非 `CCV_DEBUG_PLUGINS=1`）。同文件 user-plugin 分支 line 57 用 `file://${filePath}` 是正确的，bundled 分支遗漏。改为 `pathToFileURL(join(bundledDir, file)).href` 与 user 分支对齐。发现者：团队审查交叉质证阶段，test-auditor 原发现、api-auditor 采纳为 blocker。
- Fix (`/api/perm-hook` decision 白名单只修了一半): `server.js:2064-2068` 的 `if (hookResult.decision)` truthy-check 把 plugin 返回的任意字符串（如 `decision: 'garbage'`）原样回转给 `perm-bridge.js:133`，再被 coerce 为 `'deny'`；既违反 cb2326e 声称的 "unknown → fall through to user UI" fail-safe 语义，又让 SDK 路径（`sdk-manager.js:401-412` 严格 `'allow'|'deny'` 白名单）与 HTTP bridge 路径行为不对称。改为严格 `decision === 'allow' \|\| decision === 'deny'`，未知值 fall-through 到常规长轮询审批。发现者：api-auditor × test-auditor × regression-auditor 三人交叉对话合力定位 —— 单独 auditor 不会发现，是团队化审查的独家价值。
- Fix (`CCVIEWER_PROTOCOL` 泄漏到交互 shell): `pty-manager.js:348-350` `spawnShell()` 清理了 `CCVIEWER_PORT` / `CCV_EDITOR_PORT` 防止泄漏到非 cc-viewer 的 claude 实例，但 115c48b 新加的 `CCVIEWER_PROTOCOL` 环境变量没同步清理 —— 用户在 ccv 管理的 shell 里手动敲 `claude`，ask-bridge / perm-bridge 会走 HTTPS 去打一个可能已被他人复用的端口（配合 `rejectUnauthorized: false`）。补一行 `delete shellEnv.CCVIEWER_PROTOCOL;`。发现者：regression-auditor，security-auditor 交叉验证 exploit path 窄但值得封堵。
- Test: `test/server-plugins.test.js` 新增 2 条 `/api/perm-hook` 白名单锁定用例：(a) plugin 返回 `decision: 'allow'` → server 立即 200；(b) plugin 返回 `decision: 'garbage'` → server 300ms 内**不**返回（进入长轮询而非原样短路），防止未来再把白名单改回 truthy-check。1194 → **1207 绿**。
- Note: `plugins/http-api.js`（B1）本次未处理，原作者 Majorshi 的 PR #70 已在 `package.json:files` 中添加 `"plugins/"` 并在 `lib/plugin-loader.js` 写好 loader，但实际文件未 commit。loader 侧有 `existsSync` 兜底所以不会 runtime crash，仅 history commit message 的 "ship bundled http-api plugin" claim 与仓库状态不符。留待原作者后续 PR 补齐（或显式撤回 claim），本次不擅改。
- Chore: bump 1.6.206。

## 1.6.205 (2026-04-24)

- Docs (README.zh 简介重写): `docs/README.zh.md` 开头 slogan 从"Claude Code 请求监控系统 …"改为"互联网大厂 15 年研发专家，基于 Claude Code …"五条特性列表（本地化 /ultraPlan & /ultraReview、局域网移动端编程、完整报文拦截、内置学习资料、web 自适应 + native 安装包）；客户端下载段合并进"编程模式"小节；精简"自动更新/多语言/统计工具/配置覆盖/语音输入"等已内置可自解释的段落，减少首屏信息噪音。英文及其他 16 个语言版本未同步，留待后续统一翻译。
- Docs (内部手册清理): 删除 `docs/SSE_STREAMING_IMPLEMENTATION.md`（SSE 接手手册，特性已稳定落地 1.6.161+，文档信息已过期失锚）、`docs/profile-baseline.md`（Markdown 渲染 P0 性能 profiling 模板，未再填入实测数据）、`docs/streamdown-watchlist.md`（Streamdown 迁移观察清单，8 个回查条件全部 ❌ 无变化）—— 3 份内部路线图型文档生命周期结束，从仓库移除。
- Fix (TerminalPanel Modal 漏引入): `src/components/TerminalPanel.jsx:2` 的 antd 按需导入缺 `Modal` —— 同文件 `l.1450 / l.1510` 两处 `<Modal>` 渲染（preset 专家编辑器 + agent team 自定义对话框）实际运行时会抛 `Modal is not defined`。加回导入，与已有 `Popover / Popconfirm / Button / Checkbox` 并列。
- Chore: bump 1.6.205。

## 1.6.204 (2026-04-24)

- Feature (终端快捷栏新增 [清空上下文] 按钮): `src/components/TerminalPanel.jsx` 的快捷操作栏在 UltraPlan 与齿轮设置按钮之间新增「清空上下文」。二次确认采用 antd `Popconfirm`（`placement="top"` + `okButtonProps={{danger:true}}`），与 `ConfirmRemoveButton.jsx:50-67` 一致的小气泡样式，视觉上与同工具栏上方悬浮的 Agent Team popover 统一（最初尝试用 `Modal.confirm` 居中大弹窗，用户反馈破坏工具栏流畅感，改为 `Popconfirm` 贴近按钮）。用户确认后走与 `handlePresetSend:946` 完全相同的 bracketed-paste 通路 `\x1b[200~/clear\x1b[201~\r` 发送 `/clear` 到底层 PTY WebSocket。行为对标 `ChatView.jsx:3397-3410` 的对话版本，但终端版始终二次确认（对话版只有 cliMode 下才有）。仅桌面/iPad (`!isMobile || isPad`) 分支显示；手机 `virtualKeybar` 不介入。i18n 复用 `ui.chatInput.clearContext` + `ui.chatInput.clearContextConfirm` + `ui.common.confirmCancel`（均 18 语言齐备），无新 key。新增 `TrashIcon` SVG 内联组件（实际尺寸由 `.toolbarBtn svg { width:14px; height:14px }` CSS 规范化，显式 w/h 属性仅作兜底）。
- Fix (对话列表误杀短对话): `src/utils/sessionMerge.js` 的 transient 过滤器 `isNewConversation && newMessages.length <= 4 && prevMsgCount > 4 → return prevSessions` 原意是防"历史日志批量加载时，中间态 entry (body 只有 user message、尚未拿到 response) 污染 timestamps/sessions"；但该分支对两种场景无法区分——**真实**的 `/clear → hi → Hi!` 2 条消息短对话在长对话后产生时，也满足所有条件，整个 session 被直接丢弃，用户在[对话]列表里看不到这段对话。Fix：给 `mergeMainAgentSessions(prev, entry, options)` 加 `options.skipTransientFilter` 开关；`AppBase.jsx` 的两个调用点分流——`_processEntries` (批量加载历史，line 192) 默认保留过滤；SSE 实时追加 (line 1067) 传 `{ skipTransientFilter: true }`，因为实时流每条 entry 已带完整 response，不存在"中间态"，过滤纯属误伤。
- Fix (SSE 外层 transient `continue` 补齐): `AppBase.jsx:1048-1049` 还有**第二层** transient 过滤——`const isTransient = ...; if (isTransient) continue;` 直接跳过整个 entry，根本不进入 sessionMerge，导致上一条 `skipTransientFilter` 修复实际是死代码。SSE 路径本身每条 entry 就是完整 request+response，不存在中间态，移除 `continue` 并简化 `_currentSessionId` 判断（去掉 `!isTransient` 守卫），统一交给 sessionMerge 的 `skipTransientFilter: true` 决策，保持 `_sessionId` 与 mainAgentSessions 新增 session 的 timestamp 一致。这是 5 人 CR 并行审查中 async/lifecycle auditor 发现并推动定位的真 blocker。
- Test: `test/incremental-merge.test.js` 新增 "skipTransientFilter=true creates new session for /clear → short chat (SSE path)" 用例，断言在 10 条消息 session 后追加 `[user:hi, assistant:Hi!]` 2 条消息 entry，结果 `sessions.length === 2` 且新 session 内容为 "hi"。1194 绿。

## 1.6.203 (2026-04-23)

- Fix (自动升级卡住根治): `lib/updater.js:111` 老代码用 `execSync('npm install -g cc-viewer@X')` 同步调用，阻塞整个 Node 事件循环最长 60 秒 —— 用户正在 terminal 里跑 Claude Code，突然 SSE 心跳/HTTP 路由/WS 消息全部停摆就是这个原因。改成 `spawn('npm', [...], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref()` 后台 detached 执行：子进程脱离父进程生命周期、不阻塞 event loop、立即返回；升级完在磁盘上，**下次启动**生效。（POSIX 允许替换运行中的二进制文件，当前进程继续用旧版 inode 不受影响。）
- Feature (忙时跳过): 新增 `isAnyCcvBusy({ busy, portRange, lsofImpl })` 判断本机是否有任何 CCV 实例在用 —— 调用方（当前 server）传 `busy = clients.length > 0 \|\| getPtyState().running \|\| _sdkResolveApproval !== null` 作为本进程的 hint；updater 再用 `lsof -iTCP:[start-end] -sTCP:LISTEN -P -n -Fp` 扫端口范围看是否有其它 CCV 实例在 LISTEN。任一判忙 → `checkAndUpdate` 返回 `deferred_busy`，**不 spawn 任何东西**，只通过 SSE 广播 `update_major_available` 事件让 banner 显示"有新版可用"。用户错过一次下次启动再重试。
- Fix (启动延时 3s → 30s): 老代码 `setTimeout(checkAndUpdate, 3000)` 在 3 秒内 SSE client 基本都还没连上、`busy` 恒为 false，忙时跳过逻辑形同虚设。延到 30 秒给活跃会话留出"已连上"的窗口；short-lived `ccv` 调用 (<30s) 错过一次 check 属可接受代价。
- Breaking (update_completed SSE 事件下线): detached spawn 后当前进程内存里的代码仍是旧版本，广播"升级完成"会误导用户以为当前进程已热替换。整条广播链路 + `AppBase.jsx` listener + `AppHeader.jsx` 的 `updateInfo.type === 'completed'` 分支一并删除。i18n key `ui.update.completed` / `update.completed` 留作兜底 localStorage 可能的老状态，后续可清。
- Platform: Windows 下 `npm` 实际是 `npm.cmd`，Node `spawn` 不带 `shell: true` **不会**自动解析 `.cmd` 扩展名，会 ENOENT；通过 `shell: process.platform === 'win32'` 条件启用 shell 模式。
- Defense: `lsof -Fp` 输出除 `p<pid>` 外还会带 `f<fd>/fcwd/ftxt` 等字段行；Windows / 管道下可能带 CRLF。加两层防护：(a) `out.replace(/\r/g, '')` 预剥回车；(b) 用严格 `/^p\d+$/` 正则只认"p + 纯数字"，拒绝空 p / 负数 / 非数字 / 等畸形。
- Test: `test/updater.test.js` 新增 13 个用例（`isAnyCcvBusy` 8 分支：busy hint / self-only / 他 pid / lsof 抛异常 / 自定义 portRange / 真实 lsof 混合输出 / CRLF / 畸形 p 行；`checkAndUpdate` 5 分支：upgrading_in_background 成功路径 + spawn 参数断言 / spawn 抛 error / deferred_busy busy=true / deferred_busy 他 pid / lsof 缺失 fallback / spawn 返回 null 容错 / shell 平台分支校验）；原 `'updated'` 断言改为 `'upgrading_in_background'`。1180 → **1193 绿**，`npm run build` 通过。
- Code Review (5-teammate 两轮并行评审 + 采纳):
  - **R1** correctness-auditor 标 **blocker**(lsof 解析 CRLF / 畸形 p 行) + regression-hunter 确认 update_completed 仅 1 处 listener + platform-i18n-reviewer 标 **Windows blocker**(npm.cmd 问题)
  - **R2** 全部采纳 blockers + 3 个高价值测试 case
  - 驳回：orphaned i18n key(保留兜底)、`(background)` console 日志 i18n(仅 console)、`deferred_busy` 独立 i18n key(复用 majorAvailable 文案够用)、pnpm/bun 全局 prefix 不匹配（老问题超 scope）、workspace 模式下不自动 check(现状保留，后续单独讨论)

## 1.6.202 (2026-04-23)

- Feature (Skill 超量警告 Alert): cache popover 的「当前在用 Skill」header 里、label 和「管理」按钮之间新增 antd `Alert banner`——超过 10 个非 builtin skill 黄色告警"过多 skill 会浪费 token 和幻觉"，超过 20 个红色告警"上下文被污染，建议手工清除"。阈值基于 `mergeActiveSkills` 去重后的可管理 skill 数（builtin 10 个不计）。用 antd `Alert` 而非 `Typography.Text`：颜色走 `colorWarning`/`colorError` token 自适应主题、`banner + showIcon` 一行紧凑显示、`marginRight:'auto'` 让 Alert 紧贴 label 而「管理」被推到最右。i18n key `ui.skillsWarnOveruse` / `ui.skillsWarnPollution` × 18 语言。
- Fix (cacheSectionLabel 垂直居中根因修复): `.cacheSectionHeader`(flex + align-items:center) 子项里 label 视觉上比 Alert / 按钮高 ~2px——根因是 `.cacheSectionLabel` 有 `margin-bottom:4px`（给 MCP section "标题上 body 下" 的纵向布局用的），在 flex 行里造成 margin-box 不对称，`align-items:center` 按 margin-box 居中就让文字位置偏上。前几轮尝试 `alignSelf:'center'` / `lineHeight` 都是补丁。真 fix：加 scoped CSS `.cacheSectionHeader > .cacheSectionLabel { margin-bottom: 0 }` 只清 header context 下那 4px，MCP 纵向布局不受影响。
- Fix (TerminalPanel 预置 preset 提交不触发): `TerminalPanel.jsx:handlePresetSend` 用 `\x1b[200~${desc}\x1b[201~` 括号粘贴协议发送，但末尾缺 `\r` —— Claude TUI 收到后停在 `[Pasted text #N +M lines]` 状态等用户再按 Enter，和同文件 `handleUltraplanSend` 行为不一致。加 `\r` 对齐后 preset 点击即提交。注：之前误改 `ChatView.handlePresetSend` 被 reviewer 抓住回滚——terminal 模式下 preset click 实际走 TerminalPanel（ChatInputBar 在 `terminalVisible=true` 时早退），ChatView 的 handler 不可达。
- Refactor (内置 preset 精简): `BUILTIN_PRESETS` 移除 `scout-regiment`("调查兵团") 和 `codereview-2`(2-teammate Code Reviewer)，只保留 `codereview-5`（重命名为 "Code Review Team"，原 "Code Reviewer Pro"）。对应 i18n key (`ui.preset.scoutRegiment.*` + `ui.preset.codeReview2.*` × 18 语言) 一并删除：老用户如果之前装载过这两个条目并保留在 preset 列表里，会看到 raw i18n key 字符串（丑但不崩，手动删除即可），换取代码清洁。`codeReview5.desc` 文本重写为"分段 + bullet list"结构（标题 + 段落 + 4 项子任务 + 交付要求）：18 语言同步；因为 description 存的是 i18n key 不是值，现有未自定义用户下次加载自动生效。
- Code Review (2 轮 5-teammate 团队并行评审):
  - **R1 (dynamic skill load/unload)** 5 reviewer 发现 + 采纳: blocker 1（stale state read after await setState）+ 2 minor（error 文案 i18n 缺失、dead field）→ `reloadFsSkills` 改返回 `{ok, skills|reason}` 对象；`_fsSkillsError` 映射层；文案 18 语言
  - **R2 (terminal preset + CSS + preset cleanup)** 5 reviewer 全 PASS，side-effect reviewer 自己回滚了越权改的 ChatView.handlePresetSend（本来只要求 terminal 模式生效，chat 模式的 auto-send 是 scope creep）
  - 两轮共驳回若干误报：async-auditor 的"L95/L98 setState 缺 seq guard"（L93 提前 return 已覆盖）、shouldComponentUpdate 显式列 `_fsSkills`（`nextState !== this.state` 已覆盖）、双 `_fsSkillsSeq++`（两路径语义不同，保留）
- Fix (toggle ReferenceError 后续): 1.6.201 的 optimistic update 用了 `{...s, enabled}` 对象简写——handler 作用域变量叫 `enable` 不叫 `enabled` → ReferenceError。纯函数单测没覆盖 React 事件 handler，用户首次 toggle 触发暴露，已修成显式 `enabled: enable`。

## 1.6.201 (2026-04-23)

- Feature (Skill 动态装卸实时同步): cache popover 的「已载入 Skill」面板原本解析历史 `<system-reminder>` 文本，用户在 Skill 管理弹窗里开关 skill 后 chip 不更新——语义错位，因为 Claude Code 的 skill 机制是**文件系统即真实来源**（每次 Skill 工具调用时到 `~/.claude/skills/` / `<project>/.claude/skills/` / 启用插件的 `skills/` 扫 SKILL.md，文件不在立即失效），description 在 context 里缓存不代表还能调用。本版改为：live-tail 模式下 chip 面板数据源切换到 `/api/skills`（文件系统权威），禁用/启用立即反映；本地加载 log 模式保持历史解析兜底（日志所属项目未必还在当前机器上）。标签「已载入 Skill」→「当前在用 Skill」（18 语言同步），modal 空态「未载入」→「未启用」。
- Implementation: `src/utils/skillsParser.js` 新增两个纯函数：`skillToDisplayName(apiSkill)` 把 `/api/skills` 返回的对象映射到 Claude Code system-reminder 里的显示名（插件 skill 加 `<pluginShort>:<name>` 前缀，其它源裸名）；`mergeActiveSkills(fsSkills, historicalSkills)` 合并文件系统权威数据 + 历史 description 兜底，按显示名去重，enabled=false / source=builtin / BUILTIN_SKILL_NAMES 全部过滤。`AppHeader.jsx` 新增 `_fsSkills` state 和 `_fsSkillsSeq` instance 字段，`componentDidMount` 预热 fetch（仅 live-tail），`componentDidUpdate` 按 projectName 变化失效旧数据，`componentWillUnmount` seq++ 防 unmounted-setState，Popover `onOpenChange` hook 首次 fetch，`reloadFsSkills` 返回 `{ok, skills|reason}` 对象（caller 不再从 state 回读 —— setState 异步），失败不 clobber 既有数组数据。`handleOpenSkillsModal` 复用 `_fsSkills` 避免重复 fetch，`handleToggleSkill` 成功后先乐观翻转 `_fsSkills` 再 `reloadFsSkills`，reload 失败时 chip 仍反映用户动作。
- Code Review (2 轮，首轮 3 reviewer 采纳 blocker + 2 minor，二轮 5 reviewer team 采纳 R1-R5 共 5 项):
  - **R0 首轮**: stale state-read after await setState、dead field `_fsSkillsProjectName`、error.message 被吃成字面量 'load_failed' —— 改 `reloadFsSkills` 返回结果对象
  - **R1 错误文案 i18n**: reason code 从 'HTTP NNN' / 'fetch_failed' 等内部 token 改为通过 `getSkillsLoadErrorLabel` 映射到 `ui.skillsLoadError.http` / `.network`（18 语言）
  - **R2 空态文案一致性**: `ui.noSkillsLoaded` 18 语言从"载入"改"启用/active"，消除和标题自相矛盾
  - **R3 toggle+reload 容错**: `handleToggleSkill` 成功后先乐观翻转 `_fsSkills` 再重拉，`reloadFsSkills` 失败仅在无既有数据时才置 false（有数据则保留），避免 reload 失败时 chip 回退到历史解析误导用户
  - **R4 unmount 防护**: `componentWillUnmount` 里 `_fsSkillsSeq++` 让任何在途 fetch 回包 seq 校验失败
  - **R5 dedup 顺序测试**: 补 plugin 无 `@` fallback 到裸名 + user 同名 dedup 顺序的单测
  - **驳回误报**: async-auditor 的"L95/L98 缺 seq guard"（L93 `if(seq!==)return 'stale'` 提前返回已覆盖）、double-increment `_fsSkillsSeq`（两路径语义不同）、shouldComponentUpdate 显式列 `_fsSkills`（`nextState !== this.state` 已覆盖）
- Fix (toggle ReferenceError): 乐观更新乐观翻转 `_fsSkills` 时误用对象简写 `{ ...s, enabled }` —— handler 作用域里变量叫 `enable` 不叫 `enabled`，简写等价于 `enabled: enabled` → ReferenceError。改显式 `enabled: enable`。纯函数单测没覆盖 React 事件 handler，用户首次 toggle 触发暴露。
- Test: `test/skill-display-name.test.js` 新增 17 用例（`skillToDisplayName` 6 分支 + `mergeActiveSkills` 11 分支：null 输入、空数组、enabled 过滤、builtin 源过滤、BUILTIN_SKILL_NAMES 防御性过滤、user+project 同名 dedup、plugin+user 不同显示名共存、plugin 无 `@` fallback + user 同名 dedup 顺序、description 三级回退、plugin displayName 查历史 desc、null 条目跳过）。1163 → **1180 绿**，`npm run build` 通过。

## 1.6.200 (2026-04-23)

- Feature (Proxy Profile per-workspace 隔离): 老版本 `~/.claude/cc-viewer/profile.json` 里的 `active` 字段被所有 ccv 进程共享，多 workspace 并用时热切换会互相覆盖——A 项目切到 foxcode、B 项目立刻跟着切。拆成两层存储：`profile.json` 只存 profiles 列表（全局共享，`watchFile` 跨进程同步 CRUD），`<projectDir>/active-profile.json` 只存 `{activeId}` 并独占当前 workspace。`interceptor.js` 新增 `setActiveProfileForWorkspace` / `getActiveProfileId`，`_loadProxyProfile` 的 active 解析优先级改为 `workspace override > profile.json.active (legacy fallback) > null`，写入为双写兜底（workspace 文件首选 + profile.json.active 回落，防"切换后幽灵回切"）。`server.js` 的 `GET/POST /api/proxy-profiles` 对齐新契约。老 profile.json.active 字段保持读兼容，旧版本 ccv 仍可工作。
- Feature (CountryFlag 组件抽出 + 迁到 footer 左下): 原本挂在 AppHeader 右侧 18px 大号 emoji + Popover，占位重且和"按钮组"语义混淆；抽到 `src/components/CountryFlag.jsx` 独立组件，移到 `App.jsx` footer 左端，字号收到 13px，hover/focus 才展开地区详情。ipinfo.io 请求带 `AbortSignal.timeout(5000)` + `componentWillUnmount` abort flag 防悬挂。
- Feature (主题切换 pill-style button): AppHeader 右侧从 antd Switch 改成 56×30 的原生 button，`role="switch"` + `aria-checked`，太阳/月亮 SVG 图标随主题切换。QR 码入口从 antd Button 改成纯 SVG 容器，与 themeToggle / compactBtn 同高 30px 统一对齐。
- Fix (热切换诊断日志零 apiKey 明文): `interceptor.js::CCV_DEBUG_HOTSWITCH` 分支原本对 `authorization` / `x-api-key` 值做 `mask(s) = first10+****+last4`，审计工具仍会按 `sk-...` 模式标记为 secret 泄漏。改为只输出 `authSet` / `xApiKeySet` 布尔 + `matchedAuthKey` / `matchedXApiKey` key 名，绝不输出任何 key 片段。同步给 `_loadProxyProfile` 的 catch 块加上 `CCV_DEBUG_HOTSWITCH` 开关下的失败原因输出，便于排查"为什么没切换"。
- Fix (a11y 键盘可达性): QR 码 `<svg>` 和 footer 国旗 `<span>` 原来只能鼠标 hover 触发 Popover，键盘用户无法打开。两者都外套 `<button type="button">` + `:focus-visible` 轮廓，Popover trigger 改 `['hover','focus']`，Tab 聚焦即展开。CountryFlag 补 `aria-label={country · region}`。
- Fix (auth 替换纯函数抽取): `interceptor.js` fetch 拦截器里 "2. Auth 替换" 段抽为纯函数（内部实现，不 export），`toLowerCase()` 匹配任意大小写的 `authorization` / `x-api-key`，两者都不存在时强制植入 `x-api-key`（第三方代理最常用鉴权）。调用点改为单行解构，诊断日志从函数返回的 `matchedAuthKey` / `matchedXApiKey` 读取，不再在 fetch handler 内重复枚举。
- Code Review (2 轮共 8 reviewer 并行评审，采纳 P0/P1 5 项 + R2 清理 1 项):
  - **R1-P0**: a11y 键盘可达 (QR + CountryFlag button 化) + 诊断日志去 apiKey 尾 4 位
  - **R1-P1**: 抽 `_replaceProxyAuthHeaders` 纯函数 + 补 `_loadProxyProfile` catch 诊断
  - **R2 清理**: `_replaceProxyAuthHeaders` 从 export 列表移除（grep 确认只内部使用，测试走 replicate 模式）
  - 驳回误报: reviewer-consistency 的 "proxyUrl Blocker"（`interceptor.js:706` 已写入）、reviewer-backend 的 "watchFile fd 泄漏"（module-level 单次挂载不累积）、reviewer-test-r2 的 "Headers/apiKey 漂移"（外层 `typeof h === 'object' && !(h instanceof Headers)` + `_activeProfile.apiKey && ...` 已守护）
- Test: `test/proxy-profile-isolation.test.js` 新增 228 行（workspace 文件 I/O、active 解析优先级、跨 workspace 互不干扰、legacy `profile.json.active` 回落、`setActiveProfileForWorkspace` 返回值 `{workspace, profile}` 双路径落盘）。`test/proxy.test.js` 新增 11 用例（`getOriginalBaseUrl(activeProfile)` 参数化 3 例 + auth header 替换 7 例：lowercase/TitleCase/X-API-Key/双命中/强制植入/互斥/不 mutate input）。`test/synthetic-classification.test.js` 新增 9 用例覆盖 `SYNTHETIC_PROMPTS` 从 `requestType.js` 抬升到 `contentFilter.js` 共用后 `isSystemText` 的集成行为。1124 → **1163 绿**，`npm run build` 通过。

## 1.6.0 ~ 1.6.199 版本汇总 (1.6.0 ~ 1.6.199 Version Summary)

> 以下为 1.6.0 ~ 1.6.199 所有版本的功能/修复摘要，详细变更记录已归档至 git 历史。
> Below is a condensed summary of versions 1.6.0 ~ 1.6.199. Full per-version detail lives in git history.

### 1.6.180 ~ 1.6.199 (2026-04-20 ~ 2026-04-23) — Synthetic 请求识别、Skill 管理、UltraPlan 强化、xterm 兼容修复

- RequestList 新增 `Synthetic` 类型识别 Claude Code 合成调用（Recap/Title/Compact/Topic/Summary 5 类白名单 + `tagMuted` 弱化样式）
- AppHeader 工具弹层接入「已载入 Skill」分组 + Skill 管理 Modal：CRUD 切换 user/project skill 启用态，4 色徽章 + 响应式 width，写入 `~/.claude/skills` / `<project>/.claude/skills`
- FileExplorer 支持批量文件夹拖入保留目录结构（`webkitGetAsEntry` 递归 + 深度上限 32 + 1000 文件二次确认 + 并发 3 + `wx` 独占写防 TOCTOU）
- Team 会话面板状态收敛：`endReason` 四值 + `team-runtime.js` fs 探测 + `POST /api/team-status`，消除永久 `⏱` 中间态
- UltraPlan：`+` 按钮迁出 header 改 `.variantRow`，许愿机弹层补图片缩略点击放大 + × 二次确认 + hover 蓝框 + 22×22 触控
- 撤回 `CLAUDE_CODE_NO_FLICKER=1` 默认注入（销毁 scrollback 副作用），保留 `CLAUDE_CODE_DISABLE_MOUSE=1` 保住文本选中
- 终端 Shift+Enter 换行改走 `\x1b\r` 对齐 Claude Code 2.x 官方约定，配合 `preventDefault + stopPropagation` 关闭 textarea 默认 LF 路径
- 图片上传 2000px 防线修复：删除字节回退 + 去掉 `RESIZABLE_TYPES` 白名单 + HEIC/AVIF/GIF/BMP 一律转 JPEG
- xterm.js 6.0.0 `requestMode` TDZ 修复：`vite.config.js` 切到 `terser` + `mangle: false`（Vite 顶层 esbuild 不传 build minify 阶段）
- iOS 权限面板坐标修复：用 `visualViewport.height` 替代 `window.innerHeight`（iOS Safari 忽略 `interactive-widget=resizes-content`）
- CustomUltraplanEditModal mobile 双 modal 堆叠修复：`zIndex={1200}` + 父 UltraPlan 自动关闭，编辑期间单 modal
- 接收陈旧消息修复 + 测试增强：1024 → 1180 绿用例累计

### 1.6.160 ~ 1.6.179 (2026-04-15 ~ 2026-04-20) — SSE 流式打字机、claude --thinking-display 兼容、CLAUDE_CONFIG_DIR 全链路、麦克风语音、模型头像稳定

- SSE 实时打字机覆盖：MainAgent 流式 chunk 通过 `/api/stream-chunk` POST → SSE `stream-progress` 事件 → ChatView Last Response 位 inline `▌` cursor，rAF 合批 + `React.startTransition`
- 流式渲染性能：增量 markdown `splitFrozenTail` 仅重渲尾段 + `_mdCache` LRU + Vendor chunk split（`vendor-codemirror` / `vendor-antd` 等 8 组），app chunk 3.2MB → 827KB
- 发送按钮 spinner 主线程提升修复：拆 HTML div 显式像素尺寸 + `will-change: transform` 让 Blink 提升 compositor 层
- `claude --thinking-display` 反应式回滚：`pty-manager.js` 维护 `_thinkingDisplayRejectedPaths: Set`，crash 时按 `outputBuffer` 匹配未知 option 自动重试无 flag，替代版本号探测
- `CLAUDE_CONFIG_DIR` 6 处真实运行时路径迁移（Electron theme watcher / findcc / ensure-hooks / preferences API / TerminalPanel agentTeam tooltip），新 `tc()` i18n wrapper 注入 `{configDir}` 占位
- ccv 启动 claude 默认带 `--thinking-display summarized`（Opus 4.7 thinking 默认关闭后兼容）
- Custom UltraPlan Expert：用户自定义专家模板，CRUD + `+` 按钮 + 跨组件 `ccv-presets-changed` 同步
- ChatInputBar 麦克风语音输入：`webkitSpeechRecognition` BCP47 自动跟 UI 语言，IME-safe，HTTPS/secure context 检测，`interimPreview` 绝对定位浮在 textarea 底部
- ChatView 头像稳定 3 重修复：`getModelInfo` Map memo + `modelNameByReqIdx` carry-over + `resolveModelInfo(ts)` 闭包，多模型会话 per-message 头像准确
- iPad 模式响应式扩展（`?ipad=1`）：iOS Safari 走 `transform:scale` 非虚拟化路径绕开 `minimumLogicalFontSize` 9px 钳制
- Claude logo 流式 wave 动画 + 单色 logo 浅色主题 `currentColor` 修复（GLM/Kimi/MiniMax）
- `ccv` Claude Code 2.x 兼容：扫描 `bin/claude.exe` + 平台 optional dep `@anthropic-ai/claude-code-darwin-arm64`，老 npm hook 自愈到 native hook
- 多 repo Git 支持、iPad 拖拽上传、移动端文件浏览器三层体验补齐
- ToolApprovalPanel 锚定到输入条顶边（`position: absolute; bottom: 100%`），手机端通过 `--chat-input-bar-height` CSS var 跟随
- 测试覆盖：964 → 998 绿用例累计

### 1.6.130 ~ 1.6.159 (2026-04-09 ~ 2026-04-15) — 多 Tab Electron、浅色主题、SDK 集成、自动审批、Workspace 模式、UltraPlan 体系

- Electron 多 Tab 架构：BaseWindow + WebContentsView，每 Tab 独立 fork() 子进程（proxy/server/PTY 隔离），Cmd+T/W/1-9 快捷键，常规启动/免审启动双按钮
- 浅色主题（雪山白）全套：`[data-theme]` + ~50 语义 token + 31 组件 CSS 变量化 + Antd ConfigProvider/CodeMirror/xterm 主题适配
- Agent SDK 集成：`lib/sdk-adapter.js`/`sdk-manager.js` 跑 Claude 不走 PTY，SDK plan/AskUserQuestion/canUseTool 走 WebSocket
- 工具审批面板：Bash/Write/Edit/NotebookEdit 走 PreToolUse hook bridge → web UI 审批，多设备同步 `*-resolved` 广播 + 队列 `+N queued` 徽章
- 自动审批倒计时：按模型族（Claude/OpenAI 3s、Gemini/DeepSeek/Qwen 5s、GLM/Kimi/MiniMax 10s），off/3/5/10/15/20/30/60s 可配
- Workspace 模式登录页 + Electron 多项目切换 + auto add `-c` 续会
- UltraPlan 体系完工：代码专家/调研专家 pill 切换，`+` 自定义专家，许愿机 modal/popover 双入口，文件/图片上传，`<system-reminder>` 自动包裹 + scoped instruction 限制扩散
- Markdown 操作条：复制/导出 .md/保存为图片（html2canvas）/保存到项目，hover 触发 + 节流 + actionBar 移到气泡外右侧 column 布局
- 移动端革新：底部 hamburger 菜单 + 文件浏览器 overlay + Git Diff 全屏 + iPad pad-mode 两栏 + 上下文血条铺到手机
- Markdown action bar 收纳复制按钮进下载菜单（避免覆盖 + 132 行 i18n 新 key）
- 多 repo Git 探测（项目根 + 一级子目录）+ 图片预览 + 行数 `+N -M` 徽章（含 untracked 文件）
- 主题快切（雪山白/曜石黑）+ Claude Code `/theme` PTY 命令同步 + 终端自动 focus 反馈
- File Explorer 拖拽移动 + 系统拖入导入（`/api/import-file` + 自动展开 hover 500ms）
- ImageLightbox：滚轮缩放 / 双击切换 fit / 拖拽 / iOS 安全区，对话/diff/markdown 多入口接入
- 自定义用户名/头像 CLI（`--user-name` / `--user-avatar`，本地 png/jpg/gif/webp ≤2MB 或 http URL）
- macOS 代码签名/公证（entitlements + notarize 脚本，超时降级为跳过保 CI 60min 内）
- Mermaid 渲染 + DOMPurify svg profile + 主题切换重渲

### 1.6.100 ~ 1.6.129 (2026-04-05 ~ 2026-04-09) — 自动审批基建、流式打字机预备、Mobile 增量加载、CSS 颜色统一

- 简化工具显示模式：默认折叠工具调用为紧凑 tag，Edit/Write/Agent/TaskCreate/EnterPlanMode/ExitPlanMode/AskUserQuestion 保留全展示，hover popover/click popover
- 终端 Shift+Enter 换行 + Ctrl+C 双击拦截 + bracketed paste 单块粘贴
- AskUserQuestion `PreToolUse` hook bridge：`/api/ask-hook` 长轮询 + WebSocket 路由，结构化答案绕开 PTY 模拟，超时 30s 自动恢复
- Tool 审批面板首版（Bash/Edit/Write/NotebookEdit）：黄色虚线动画边框，键盘 Tab/Esc 友好，focus 自动恢复
- 移动端 SSE 增量加载：初始 200 条，按 100 条 batch 请求 `/api/entries/page`，session 级冷热分片（8 热 + IndexedDB 冷）
- LRU cache 系列：`renderMarkdown` 1024 / `highlight` 512 / `renderAssistantText` 512，session 级增量 `buildAllItems`
- 流式 spinner / streaming border / loading pet pixel 动画
- iOS 移动版面板互换：聊天主、终端 overlay（Safari 兼容）
- 体感小修补：`mobileVirtuoso` Footer 不重渲（context prop） / 超 240 条 → 0 → race / `_processEntries` 4 pass 合并 / `setState` rAF 节流（500/s → 60/s）
- CSS 颜色 203 → 102（-49%）：rgba/rgb/named 统一 hex，灰/蓝/红/绿/黄合并，inline style 抽到 module
- ToolApprovalPanel 进入聊天区域（`position: absolute` 相对 `messageListWrap`），自动 focus Allow，Esc 拒绝
- Multi-device perm/plan/ask 广播 `*-resolved` + ask-hook 跨设备同步
- 全局设置日志目录：runtime `setLogDir()` + preferences UI + GlobalSettings concept doc 18 语言
- WebFetch/WebSearch 加入 `APPROVAL_TOOLS`，git/npm guard 合并到 perm-bridge 消除 Bash matcher 冲突
- 终端 pending 文件 tag 条 + 多设备同步 + Enter 自动注入路径 + git checkout `??` 改 `git clean -fd`
- KV-Cache popover 重构 builtin/MCP 分组 + ConceptHelp 接入
- File Explorer 右键菜单 7 项（reveal/copy path/rename/delete/new file/new dir/open terminal）+ Git Changes 右键 hover actions
- ipinfo.io 国旗 + 5s timeout 失败隐藏；`/api/import-file` 从 OS 拖文件进项目目录

### 1.6.50 ~ 1.6.99 (2026-03-28 ~ 2026-04-05) — Plan/Dangerous 审批、AskUserQuestion 多问、文件浏览器右键、PTY 镜像

- Plan 审批 GUI（ExitPlanMode）：内容预览 + Approve/Edit/Reject 按钮；危险操作（Bash/Edit/Write）琥珀色审批卡 Allow/Deny；权限拒绝红色 `Denied` 徽章
- AskUserQuestion 多问支持：multi-select Other 通过 → + Enter 提交；isMultiQuestion 标记尾问；PTY ↑↓ delay strategy 让 inquirer 重渲
- AppBase 拆分 Mobile/PC entry：动态 import code splitting，`AppBase.jsx` 共享 + `App.jsx`/`Mobile.jsx` 子类
- 文件浏览器：内联 rename（双击/F2）、可点击聊天文件路径跳转 + 自动展开目录树、文件/文件夹右键菜单、删除/`reveal in explorer`/`copy path`/`new file`/`new folder`
- markdown preview toggle for `.md` files + DOMPurify 全链路
- 多设备审批/计划/问答同步 + perm-bridge 白名单反转（只 Bash/Edit/Write/NotebookEdit 走审批）+ 32 单测
- Image Lightbox：PC 滚轮+拖拽+双击；移动端 pinch+拖拽+点击关闭；iOS safe-area
- Native teammate detection：`Agent` 工具子代理改名 `Teammate`，hook context 自动提取名字 + 颜色哈希
- 流式状态 SSE 全链路（`stream-progress`）：聊天输入条 SVG 流光边框 + Virtuoso footer spinner + 5 层渐变
- 终端剪贴板图片粘贴 + Retina 降采样 + 多设备同步 image-upload-notify
- chat textarea image paste + 文件 chip 预览 + 延迟路径注入（send 时拼接而非贴入 textarea）
- iOS Safari 移动布局：`mobileCLIBody` flex 方向修复，键盘安全
- macOS 系统头像 fallback、文件资源管理器集成（`/api/reveal-file`/`/api/open-terminal`/`/api/create-dir`/`/api/create-file`/`/api/delete-file`/`/api/rename-file`/`/api/import-file`）
- TerminalPanel chat 镜像：`pendingImages` 双向同步，textarea 不污染、send 时注入
- /api/file-raw 路径穿越 + 符号链接保护（realpathSync containment）

### 1.6.0 ~ 1.6.49 (2026-03-18 ~ 2026-03-28) — 增量重构、Teammate 显示、KV-Cache 缓存内容、SSE 心跳

- ChatView 增量重构：`buildToolResultMap` WeakMap O(1) + `buildAllItems` 单 pass + `appendCacheLossMap` append-only + Last Response 独立 state（消除 middle-insertion reflow）
- `_reqScanCache` 拆独立计数器，`isTeammate` WeakMap，`extractTeammateName` per-request cache
- Teammate 显示优化：`Teammate: name(model)` 格式 + 专属 team 图标 + per-name HSL 哈希着色 + 真实姓名从 SendMessage `routing.sender` 提取
- AskQuestionForm 抽组件 + multi-select 本地 state 隔离消除父级 re-render
- `ptyChunkBuilder.js` 纯函数生成 PTY 序列；`writeToPtySequential()` 服务端写队列；`input-sequential` WS 类型
- Mermaid 图表渲染（lazy-loaded ~460KB）+ DOMPurify svg profile + 主题适配
- Proxy Hot-Switch：`fs.watchFile` 动态切换 API URL/Auth/Model 不重启 Claude Code，profile.json 0o600
- 大 JSONL 文件 OOM 修复：服务端不再 reconstruct delta，原始 SSE 推送，前端本地 reconstruct；分块 1MB 读
- 移动端 SSE 增量首版（`since` filter + Map dedup）+ react-virtuoso 虚拟列表（24000 → 2000 DOM 节点）
- 上下文血条：`readModelContextSize()` 解析 `[1m]` 后缀，`watchContextWindow` polling 移除避免跨进程数据污染
- 国家国旗（ipinfo.io）+ drag-drop 文件上传
- SSE heartbeat 30s + 客户端 45s 自动重连（最多 10 次）
- `/api/local-log` 独立 SSE 流隔离 CLI mode + checkpoint 对齐分页
- KV-Cache popover：仅展示 `cache_control` 内容块、tools/system/messages 三段折叠、SubAgent KV-Cache-Text
- File Explorer 内联 rename、点击文件路径跳转、自动展开目录、auto-refresh on Edit/Write 检测
- AskUserQuestion `ensureAskHook` PreToolUse hook 自动注入 `~/.claude/settings.json`，xterm Ctrl+C 双击拦截 i18n toast
- TeamModal hook order violation 修复（早 return 移到 hooks 之后）
- 浅色样式诸多过渡：sticky bottom 按钮位移、虚线动画、xterm 主题, light theme palette 修补

---

## Pre-1.6 版本汇总 (Pre-1.6 Version Summary)

> 以下为 1.6.0 之前所有版本的功能摘要，详细变更记录已归档。
> Below is a condensed summary of all versions prior to 1.6.0.

### 1.5.x (2026-03-08 ~ 2026-03-17) — 上下文血条、CodeMirror 编辑器、交互式审批

- 上下文血条：「当前项目」tag 替换为 context usage 血条（绿/黄/红），statusLine wrapper 脚本捕获 `used_percentage` 推送 SSE；`getModelMaxTokens()` 模型上下文窗口映射；KV-Cache user prompt 点击跳转 + `scrollend` 动画时机 (1.5.24/26/45)
- AskUserQuestion 交互式：聊天面板内渲染 Radio/Checkbox + 提交按钮，支持单选/多选/Other 自定义输入/Markdown preview；已回答自动切换静态卡片；多问题串行 PTY 提交 (1.5.21/39/41/43)
- Plan approval UI：ExitPlanMode 卡片审批/拒绝/反馈按钮，内置默认选项 fallback 无需等 PTY 侦测 (1.5.37/39)
- CodeMirror 6 编辑器：FileContentView 从 highlight.js 迁移到 CodeMirror，支持编辑保存（Ctrl+S + `/api/file-content`）、minimap、自定义 gutter；GitDiff 点击路径跳转对应行 (1.5.3/11/16/22)
- `$EDITOR` / `$VISUAL` 拦截：Claude 编辑请求在 FileContentView 打开，保存关闭继续；服务端 editorSessions Map + WebSocket 广播 (1.5.14)
- CCV 进程管理：列出 7008-7099 端口所有实例，PID/port/命令/启动时间展示，UI 停止闲置进程；`GET /api/ccv-processes` + `POST /kill` 带安全校验 (1.5.12)
- CLI 透传改造：`ccv` 成为 claude drop-in 替换，参数直传；`ccv -logger` 独立安装 hook；`-v/-h/--version/--help` 绕过 hook；`--d` = `--dangerously-skip-permissions`；注入 Claude PID 到 `onNewEntry` (1.5.19/23/25)
- 移动端性能与体验：IndexedDB 本地缓存 + 7 天过期；消息列表分页 (末尾 240/300 + load more)；SSE 增量加载 (`since/cc` metadata) ；User Prompt 查看器 + 导出；长 bash 自动折叠；stick-to-bottom 按钮 2x 尺寸；display 设置进 mobile menu (1.5.0/5/8/10)
- iOS 专项：终端从 WebGL 降级 Canvas 解决严重卡顿；`visualViewport` + fixed positioning 修复键盘顶起导航栏；`interactive-widget=resizes-content` viewport meta；scrollback iOS=200 / Android=1000 / Desktop=3000；虚拟按键栏 touchstart preventDefault + 按键后 blur，消除按键误触发虚拟键盘 (1.5.7/17)
- Terminal 增强：文件上传按钮（PC 工具栏 + chat input）50MB 限制 + 唯一文件名；bracketed paste (`\x1b[200~`) 阻止多行粘贴误触发 submit；`ultrathink` 按钮；大写入分 32KB 跨帧避免主线程阻塞；outputBuffer ANSI 安全截断 (1.5.4/15/31/42)
- Log 管理：下载/批量删除日志（`/api/download-log`、`/api/delete-logs`）；Log 列表 List→Table 可排序；JSONL 紧凑格式 + MAX_LOG_SIZE 200MB→150MB + 合并 API 300MB 上限；Preview 列 Popover（hover/click）带 stats-worker v6→v8 缓存失效 (1.5.1/5/18/37/40)
- Git/File 联动：Claude 写操作后（Write/Edit/Bash/NotebookEdit）自动刷新 FileExplorer 和 GitChanges；Git U 状态绿标替换 `??`；侧边栏文件夹/Git 按钮改 toggle (1.5.22/27/29)
- 插件 API：`httpsOptions` hook (waterfall) 替换硬编码 HTTPS cert；`serverStarted` hook 新增 `url/ip/token`；`/api/local-url` 尊重实际协议；`proxy-errors.js` / `proxy-env.js` 移入 lib/ (1.5.21/32)
- 修复与回归：`watchLogFile()` 初始化 `lastSize` 修复重启重复广播；`proxy-errors.js` 补进 npm files array；`installShellHook` 内容比对替换过期 hook；SSE clients 数组 mutate-in-place 修复断连后失联；`claude -v/-h` 正确透传；QR popover 自适应宽度；DiffView 固定 gutter + 背景全宽；ConceptHelp dark-theme 修复 (1.5.2/6/9/20/30/34)
- 测试与覆盖率：覆盖率 line 68.98%→71.23%、branch 69.17%→72.81%；新增 `test/git-diff / log-watcher / findcc / context-watcher / upload-api / proxy-errors / updater / stats-worker` 系列单测；`npm run test:coverage` 脚本 (1.5.29/31)

### 1.4.x (2026-03-02 ~ 2026-03-07) — CLI 模式与终端集成

- CLI 模式 (`ccv -c`)：内置 PTY 终端直接运行 Claude，支持 npm/nvm 安装路径自动检测
- 分屏布局：终端 + 对话双面板，可拖拽调整比例
- 文件浏览器：树形目录、文件内容预览、minimap、支持 dot files 和 gitignore 灰显
- Git 集成：变更文件列表、统一 diff 视图（双行号）、diff minimap
- 工作区管理：多工作区切换、SSE 状态同步
- 插件系统：动态加载/卸载、启用/禁用状态管理
- 自动更新器：版本检测与自动升级
- 终端优化：WebGL 渲染 + context loss 恢复、Unicode11 CJK 支持、WebLinks、scrollback 扩容、PTY 输出批量合并
- SSE 分块加载：大日志文件分 50 条 chunk 传输，带进度指示
- 安全：LAN 移动端 token 鉴权修复
- 卸载命令 (`ccv --uninstall`)：完整清理 hooks 和配置

### 1.3.x (2026-02-28 ~ 2026-03-02) — 移动端适配与国际化

- 移动端响应式：虚拟按键栏、触摸滚动惯性、固定列宽自适应字号
- 国际化 (i18n)：支持 18 种语言（中/英/日/韩/法/德/西/葡/俄/阿/印/泰/越/土/意/荷/波/瑞典）
- 代理模式 (proxy)：拦截 Claude API 流量并记录
- 设置面板：主题、语言、显示选项等可视化配置
- 对话模式增强：thinking block 折叠/展开、工具调用结果渲染优化
- 安全：访问 token 认证、CORS 配置

### 1.2.x (2026-02-25 ~ 2026-02-27) — 对话模式

- Chat 模式：将原始 API 请求/响应重组为对话视图
- Markdown 渲染：代码高亮 (highlight.js)、表格、列表
- Thinking blocks：可折叠的模型思考过程展示
- 工具调用结果：结构化渲染 tool_use / tool_result
- 搜索功能：全文搜索对话内容
- 智能自动滚动：仅在用户位于底部时自动跟随

### 1.1.x (2026-02-25) — 数据统计面板

- Dashboard：请求统计、模型用量图表、token 消耗分析
- 缓存重建分析：按原因分类统计（TTL、system/tools/model 变更、消息截断/修改）

### 1.0.x (2026-02-24 ~ 2026-02-25) — 请求查看器

- Request/Response 详情查看器：原始请求体、响应体、流式组装
- 缓存重建分析：精确识别 system prompt / tools / model 变更原因
- Body Diff：JSON/Text 视图切换、复制按钮
- 双向模式同步：Chat ↔ Raw 模式跳转定位
- Claude Code 工具参考文档（22 个内置工具）

### 0.0.1 (2026-02-17) — 初始版本

- 拦截并记录 Claude API 请求/响应

