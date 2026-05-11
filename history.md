# Changelog

## 1.6.260 (2026-05-11)

- fix(image-viewer): Mac 触控板 pinch 缩放灵敏度过高根治 + React passive wheel listener 修复 + 5-agent UltraReview 采纳
  - **症状**：FileExplorer 详情面板的图片预览（ImageViewer）在 Mac 上做触控板 pinch 缩放时，轻轻一捏从 100% 直接跳到 300%+，几乎无法精确控制。
  - **根因 #1（灵敏度爆表）**：`src/components/ImageViewer.jsx:116-130` `handleWheel` 公式 `prev * (e.deltaY < 0 ? 1.15 : 1/1.15)` **每次 wheel 事件固定 ±15% 缩放，完全忽略 deltaY 大小**。macOS 触控板 pinch 被浏览器翻译成 `wheel` event with `ctrlKey=true`，每秒发数十次小 deltaY（0.5~3px），每次 ×1.15 → 5 次 ×2.0、10 次 ×4.0 累积爆炸。鼠标滚轮稀疏发大 deltaY（~100px），单次 15% 才是合理手感——旧公式偏袒鼠标用户，惩罚 trackpad 用户。
  - **根因 #2（page-zoom 抵消修复，UltraReview 发现）**：React 自 v17 起把 `onWheel` 注册成 passive listener，`e.preventDefault()` 静默失败（Chrome 控制台仅 warn）。Ctrl+wheel / trackpad pinch 触发浏览器整页缩放，与组件的图片缩放叠加，灵敏度修复价值被部分抵消。
  - **修复（src/components/ImageViewer.jsx:116-145，仅 1 文件）**：
    1. 改 clamp + 指数公式（业界 zoomable-canvas 常见模式）：`delta = clamp(deltaY, -10, 10)`、`scale *= Math.exp(-delta * 0.014)`。trackpad 小 delta=2 → 单帧 ~2.8%（柔和，比原 15% 柔 5×）；鼠标大 delta=100 被 clamp 到 10 → 单次 ~13%（接近原 15% 手感保留鼠标用户肌肉记忆）。无需检测设备类型，跨 deltaMode (PIXEL/LINE/PAGE) 也被 clamp 兜底——Firefox 行模式 / Windows 精度触控板 / Linux libinput 量级差异自动归一。
    2. React `onWheel` JSX 属性改为 `useEffect` + native `addEventListener('wheel', handler, {passive: false})`，让 `preventDefault()` 真正生效，杜绝叠加整页缩放。
    3. zoom-to-mouse 锚点算法（mx/my、offset ratio 更新）原样保留，缩放比例 `next/prev` 不变，行为等价；仅替换缩放比例计算与监听器绑定方式。
  - **5-人 UltraReview 采纳**：**P1 (platform-reviewer)** passive listener 修复（最关键，本次 commit 的核心增量）；**P2 (math + ux 两位共识)** factor 从 0.01 调到 0.014 兼顾鼠标和触控板手感；**P2 (quality-reviewer)** history.md 业界归因措辞软化（不点名 Leaflet/Figma 等具体库以避免未验证的精确归因）。**不采纳记 backlog**：(a) ctrlKey 区分 pinch/scroll（改 zoom→pan 行为大，scope creep）；(b) ImageLightbox 同病（用户未提，1.06/event 已较柔且有 touch pinch 路径）；(c) 按钮 +0.25 vs 滚轮乘法不一致（pre-existing，非本次回归）。
  - **测试**：`npm run build` 通过；`npm run test` 1891/1891 全绿；待用户在 Mac 实机验证 pinch 手感 + Ctrl+wheel 不再触发整页缩放。
  - **覆盖范围**：本修复同时受益于 `MobileFileExplorer.jsx` 中的 ImageViewer 复用路径（iPad Magic Keyboard 触控板 pinch 同样走 wheel 事件链）。

## 1.6.259 (2026-05-11)

- fix(mobile): 移动端开启 Terminal 后权限审批 modal 飞出屏幕根治
  - **症状**：mobile 视图（窄屏 < 768px、非 pad-mode）下，用户点击 Terminal 切到终端视图后，工具调用触发的「权限审批」浮层（`ToolApprovalPanel` `.panelGlobal`）位置跳到屏幕外几乎看不见；未切 Terminal 时 modal 位置正常。
  - **根因**：`src/components/ChatInputBar.jsx` 内 `useLayoutEffect` 依赖数组为 `[]`，仅 mount 时跑一次并捕获闭包内的 `el = rootRef.current`。ChatInputBar 在 `terminalVisible=true` 时短路 `return null`（line 201-209），`<div ref={rootRef}>` 不再渲染，React 把 `rootRef.current` 置 null 卸载旧 DOM。但 `[]` 依赖让 cleanup 不触发，已注册的 `ResizeObserver(el)` + `visualViewport.resize` + `window.resize` 三个监听仍持闭包旧 `el` 引用。开 Terminal 时 `.mobileChatOverlay` 的 `transform: translateX(0)` transition / iOS 软键盘 / 浏览器工具栏抖动均触发 `visualViewport.resize`，setVar 对脱离 DOM 的 el 调 `getBoundingClientRect()` 返回 `{top:0,...}`（HTML spec：detached 节点无 layout box，rect 全 0），让 `distFromBottom = vh - 0 = vh`（≈800px），写入 `--chat-input-bar-height: 800px`，`.panelGlobal` 的 `bottom: max(calc(800+12), 56) = 812px` 把 modal 顶到视口顶部外 800px → 看不见。**经典 React effect stale closure + DOM 卸载竞态**，与 `mobileChatOverlay.transform` 创建 stacking context 无关（modal 已主动渲染在 `mobileCLIBody` 之外避开 transform 影响）。
  - **修复（src/components/ChatInputBar.jsx:56-106，仅 1 文件）**：
    1. effect 依赖 `[]` → `[terminalVisible]`，切换 Terminal 时旧 ResizeObserver / vv listener / window listener 正确 cleanup，新 effect 拿到当前 `rootRef.current`。**注意**：真正 unmount（ChatView 离开 / workspace 切换）走的还是 React 标准 cleanup 路径，旧的「unmount 时保留 var 最后值不清除」FOUC 防护（v1.6.176 引入）依然保留；新加的 removeProperty 只发生在 `el === null` 的 toggle 分支，即输入栏确实不在 DOM 的时刻——此时 fallback 200px 才是「正确」位置，不是 FOUC。
    2. `el` 为 null 时（terminal 模式 ChatInputBar return null/chip）主动 `document.documentElement.style.removeProperty('--chat-input-bar-height')`，让 `.panelGlobal` 回退 fallback 200px（max() 兜底 56px），Terminal 模式下 modal 自然贴底 212px，正好让出 60px 虚拟键盘条 + 35px 工具栏 + ~117px 缓冲。
    3. `setVar` 内新增双重防御：`!el.isConnected` 兜底 detached 节点；`rect.width === 0 && rect.height === 0` 兜底 display:none 祖先（attached 但无 layout box）—— 极端情况 RO / vv callback 在 el 卸载或祖先隐藏后的下一轮派发仍触发也不写脏值。
    4. 顶部注释完整记录 stale-closure 根因与修复意图，留 trace 给后人（项目历史多次反复重构这块定位逻辑：v1.6.172 引入 var、v1.6.176 改 unmount 保留、v1.6.246 加 zoom 折算 + max() 兜底，trace 价值高于行数）。
  - **测试**：`npm run build` 通过；`npm run test` 1891/1891 全绿；手动验证：chat 模式 modal 紧贴输入栏 12px，切 Terminal 后 modal 回到底部 212px 位置稳定，多次切换无累积错误，iPad/pad-mode 不受影响（pad-mode 用 `.panel` 非 `.panelGlobal`）。
  - **5-人 UltraReview 采纳**：P2 (hooks-reviewer) display:none 祖先防御已加 rect w=h=0 check；P2 (quality-reviewer) setVar 内注释精简为 2 行，根因 trace 保留在顶部段；P3 (quality-reviewer) 措辞「microtask」改「下一轮派发」（ResizeObserver callback 实际在 sync layout 阶段，非 microtask；vv.resize 是普通 task）。**P1 (mobile-ux-reviewer) 不采纳，记 backlog**：切 Terminal 时如有 modal 存在会跳 ~130px（从贴输入栏 80px → fallback 212px）。两种 mitigation——加 `.panelGlobal { transition: bottom 0.3s }` 或 terminal 模式隐藏 modal——前者会破坏 iOS 键盘高频升降时 modal 即时跟随响应性（vv.resize 频率远高于 terminal 切换），后者改 modal 可见性策略影响面太大。当前从「飞出屏幕 800px 不可用」改善到「跳到 212px 可见且可操作」已是绝对改善，离散切换时的视觉跳跃属低频可接受 trade-off。

## 1.6.258 (2026-05-11)

- fix(windows): 广义 Windows 适配批 2 —— 4 安全洞 + FileExplorer 5 处 UX + 14 项杂项 + 5-agent UltraReview 采纳 P0/P1 单 PR 3 logical commit 落地
  - **commit 1 安全 / 数据丢失 4 件**：
    - `server.js:1853` `/api/delete-file` statSync → `lstatSync` 拒符号链——防 TOCTOU 攻击者把目标换 symlink 让 `rmSync` recursive 在 POSIX 上跟随删 cwd 外目录。defense-in-depth：rmSync 前 realpath 再校验关闭 lstat↔rmSync 间窗 swap。
    - `server.js:1787-1801` `/api/move-file` EXDEV fallback 加 `lstatSync` 拒符号链——同款 TOCTOU 攻击向量，cpSync + rmSync 跟随路径。批 1 漏点修复。
    - `server.js multipart 3 处` `/api/upload-image` `/api/import-file` `/api/import-skill` 加 Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）守卫——Windows 上 `writeFileSync(join(dir, 'CON'))` 戳物理设备 `\\.\CON` 而不是创建文件。`.trim()` 防 `CON ` 拖空格绕过（Windows API 自动 trim 尾随空格 / 句点都视为同名）。
    - `server.js:134 gitRestoreLocks Map` per-file mutex + handler 3121-3138 promise chain 串行化「git status + checkout/clean」同 key 子命令对——多 tab 并发同文件 revert race 根治。finally 主清理 + setTimeout(30s).unref() 兜底防 finally 异常累积内存。lockKey 走 `resolve()` 规整 `./foo.js / foo.js` 同形态防绕过。
  - **commit 2 FileExplorer 5 处 Modal.confirm fetch-fail silent close**：
    - `src/components/FileExplorer.jsx:396/417/437/571/592` 5 处 Modal.confirm onOk 改 async/throw + `message.error` 显式提示——mirror #84 PR 的 `handleRestore` 同款修法，4xx/5xx 不再让弹窗静默关闭，throw 让 antd Modal.confirm 保住弹窗供重试。
    - `src/i18n.js` 新增 3 个 i18n key × 18 locales（mirror restoreFailed 结构）：`ui.contextMenu.createFileFailed` / `createDirFailed` / `deleteFailed`。
  - **commit 3 杂项 14 项**：
    - `lib/file-api.js` export `renameSyncWithRetry(src, dst, opts?)` 共享 helper（EACCES/EPERM/EBUSY 限定 retry 3×20ms，其它 code 直接抛——窄于旧 inline retry）；`interceptor.js` / `lib/interceptor-core.js` / `lib/log-management.js` / `workspace-registry.js` 4 处 renameSync 调用统一接入。
    - `workspace-registry.js:104` Windows NTFS 大小写不敏感：仅 Win 下 `pathEq` 小写化比较，POSIX 原样不变（避免重复 workspace 注册 `C:\App` vs `c:\app`）。**注意**：旧 `workspaces.json` 残留的大小写变体重复条目不自动迁移，用户首次发现可手动清理一次。
    - `server.js:4299` `process.kill(pid, 'SIGWINCH')` 加 platform 守卫——Win 无 SIGWINCH，前面 `resizePty` 已跨平台处理 resize。
    - `electron/main.js:135` 抽 `killChildEscalating(child, escalateMs=3000)` helper：Win 直接 `child.kill()` 走 `TerminateProcess` 立即结束（旧 SIGTERM noop 让 tab close 卡满 5s）；POSIX 保留 SIGTERM → 3s SIGKILL 升级。两处 IPC-disconnected 路径调用 helper。
    - 路径字符串切片 5 处：`server.js:2883/3405` `absPath.split('/').pop()` → `basename()`；`server.js:1830` `toDir+'/'+name` → `join().replace(/\\/g,'/')` 响应 JSON 统一 POSIX 风格；`lib/log-management.js:142` `files.split('/')[0]` → `split(/[\\/]/)[0]`。
    - Shell/spawn 4 处：`findcc.js:121/176` platform 分支 `where` vs `which`/`command -v` + realpath backslash → forward-slash normalize（regex 匹配统一）；`cli.js` 3 处 `execSync(\`${cmd} ${url}\`)` → `spawn` 数组防 `&` 截断（Win 走 `cmd /c start`）；`server.js:1964` `explorer /select` 合一个 arg + `windowsHide:true`；`server.js:2160` `cmd.exe` spawn 加 `windowsHide:true` 防闪窗。
    - CRLF 微强化 2 处：`server.js:3158` git status `split('\n')` → `split(/\r?\n/)` 防未来 strict 比较破窗；`cli.js` `injectCliJs` 检测主导 EOL 保留 split + join 防 LF→CRLF 单向转。
  - **commit 4 (UltraReview 采纳 P0/P1)**：
    - 补 commit 1 漏的 `/api/upload-image` 保留名守卫（commit 1 message 声称 3 处但实际只落地 2 处）。
    - 3 处 reserved name regex 提取到模块级 const `WINDOWS_RESERVED_NAMES` dedup。
    - cpSync 显式 `dereference: false`——Node 默认就是 false 但显式写明意图防默认变更让递归 copy 跟随内嵌 symlink。
    - 30000 magic number 提到 `GIT_RESTORE_LOCK_CLEANUP_MS` const。
    - `renameSyncWithRetry` 测试补 retry-path 守卫（mirror retry 语义跑一遍验证 EBUSY 触发 retry 直到第 3 次成功）。
  - **测试**：`test/windows-compat.test.js` 16 → 30+ case（含 reserved name 8 个边界 / git-restore mutex 串行化 / renameSyncWithRetry 3 case / EOL preservation 2 case）；总计 1891/1891 全过 + build 通过。
  - **跳过的 UltraReview 项**：defensive #1 `/api/delete-file` isFile branch unlinkSync TOCTOU（误判：POSIX unlinkSync 不跟随 symlink）/ defensive #2 within-FS symlink rename（non-security）/ defensive #4 setTimeout unref 时机（进程退出无关）/ architect 其它 2 处 IPC inline kill（legit different code paths）。
  - **批 3 入 backlog（P2/P3）**：chokidar 轮询间隔 / 剪贴板 backslash / Electron 签名 / UAC 防火墙 UX 文档 / `.gitattributes` EOL / `## Unreleased` 段 publish 流程文档。32 条审计完整清单仍在 `/Users/sky/.claude/plans/imperative-imagining-ullman.md`。

## 1.6.257 (2026-05-11)

- fix(git): Issue #84 —— GitChanges 单文件「撤销变更」在 Windows 下静默 no-op
  - **现象**：PC 浏览器 → Git 变更面板 → 文件行后「撤销变更」→ 弹窗确认 → 弹窗关闭，**但文件并未撤销**，依旧在变更列表里。报告者环境：Windows 11 + cc-viewer 1.6.255 本地部署。
  - **根因 1（Windows 路径分隔符）**：`server.js` 与 `lib/file-api.js` 共 10 处路径包含校验硬编码 `realCwd + '/'` / `srcResolved + '/'`，而 Node `realpathSync` 在 Windows 返回 backslash 原生路径（`C:\repo\src\file.js`），`"...\\".startsWith("...//")` 永远 false → 凡是 `existsSync(fullPath)` 为 true 的文件全部 400「Path traversal not allowed」。只有「已删除文件」侥幸走 false 分支跳过校验，所以同界面其它 Git revert 子场景表现不一致。
  - **根因 2（前端静默吞错）**：`GitChanges.jsx` `handleRestore` 的 `onOk` 只在 `r.ok` 时 `refreshAllRepos()`，对 4xx/5xx 不分流也不 toast；fetch 异常 / 网络错误也无 `.catch()`。`Modal.confirm` 把 resolved promise 当成功，弹窗照关，用户当成做对了。
  - **修法**：
    - 全局 sweep：`lib/file-api.js:19` 与 `server.js` 9 处（500 / 1768 / 1846 / 1909 / 1964 / 2055 / 2105 / 2184 / 3060）从 `+ '/'` / `+ '\\'` 统一改 `+ sep`（`server.js:7` 已 import `sep`，`file-api.js` 补 import）。语义在 POSIX 下完全等价（`sep === '/'`），Windows 下从「永远拒」变成「正确放行子路径」。
    - `GitChanges.jsx`：`handleRestore` 改 async；失败路径走 `message.error(t('ui.gitChanges.restoreFailed', { error }))` + `throw` 让 antd `Modal.confirm` 保住弹窗供重试，4xx/5xx body 里的 `error` 字段会展开给用户。
    - `src/i18n.js` 新增 `ui.gitChanges.restoreFailed` 18 语种翻译（mirror 同段 `restoreConfirm` 结构）。
  - **测试**：新增 `test/git-restore.test.js` 14 case：modified / 未跟踪 / 工作树删除 / 嵌套子目录（path-separator 回归守卫）/ `../` 穿越 / 绝对路径 / 缺 path / 非 JSON body / `isPathContained` 跨平台 5 case（含 prefix-match 兄弟目录 ROOT vs ROOT_extra 防误判）。1860/1860 全过 + build 通过。
  - **作用域取舍**：未把 9 处 inline 校验合并进 `isPathContained` —— 同形不同上下文（有的带 `realDir !== realCwd` 守卫、有的对 `srcResolved`），按 CLAUDE.md「bug 修复不夹带 refactor」原则留作 backlog；MobileGitDiff 无 per-file revert 按钮（确认过），无平行 bug。
  - **5-agent UltraReview 采纳 P1**：code-quality 提的 `handleRestore` 控制流摊平（单 throw + 单 toast）+ 注释自包含（去掉 "见 #84" 外部引用）已落地；side-effects 发现 `FileExplorer.jsx` 5 处 Modal.confirm 文件操作（411 / 432 / 572 / 593 / 669）存在同款「fetch 失败弹窗静默关」UX 漏洞，按 CLAUDE.md scope 纪律入 backlog 单独 PR 修；compatibility 提醒「## Unreleased」段在本仓首次出现，发版时需手动并入新版本号 header。

- fix(windows): #84 同类排查广义 Windows 适配批 1 —— 6 P0 + 2 P1 一锅修
  - **触发**：#84 修了 10 处 `+ '/'` → `+ sep` 之后，用户要求顺线深扫 Windows 同类问题。5 个并发 Explore agent + 2 reviewer 复核出共 32 条，本批挑出 6 P0 + 2 关键 P1，剩余 P1/P2 入 backlog 独立 PR。
  - **P0-1 `server.js:2729`**：CLAUDE.md viewer detail endpoint 的路径包含校验 `realDir.endsWith('/') ? realDir : realDir + '/'`，**#84 漏掉的第 11 处**——分两步拼让原版 grep 命中不了。Windows 上 realpathSync 返回 backslash 路径，永远不命中前缀，**全员 403** 拿不到 CLAUDE.md 详情。改成 `realDir + sep`；为避免跟模块顶层 `import { sep }` 重名，局部变量从 `sep` 改名 `realDirWithSep`。
  - **P0-2 `server.js:1854` 受保护目录守卫被反斜杠绕过**：`protectedDirs.has(part)` 检查 `node_modules/.git/.svn/.hg`，但前面是 `filePath.split('/')`——用户 POST `path: "node_modules\\foo"` 切完是单元素，**直接绕过守卫被 rmSync 递归删**。同样 `.GIT/HEAD`（NTFS case-insensitive）也能绕。**真 P0 安全洞 + 数据丢失**。修法：`filePath.split(/[\\/]/).map(s => s.toLowerCase())`，反斜杠 + 大小写双兜底。
  - **P0-3 `lib/file-api.js` 6 处 `reqPath.startsWith('/')`**：用来检测「绝对路径走严格校验，相对路径默认放行」。Windows 上 `C:\evil` 不以 `/` 开头，`includes('..')` 也不命中，**直接走 fallback `join(cwd, "C:\\evil")`**——Node 在 Win 上 `path.join` 见到绝对参数会**覆盖前面 cwd**，结果就是 `C:\evil` 本身，sandbox 直接被绕走任意读写。**真 P0 安全洞**。修法：6 处 `reqPath.startsWith('/')` → `isAbsolute(reqPath)`（统一覆盖 POSIX `/foo`、Win `C:\foo`、UNC `\\server\share`、driveless `\foo`）；import 补 `isAbsolute`。POSIX 行为完全等价（`isAbsolute('/foo')` 跟 `'/foo'.startsWith('/')` 同结果）。
  - **P0-4 `interceptor.js:876,880` SSE 块 `split('\n\n')` 在 CRLF 上失败**：HTTP SSE 规范是 `\r\n\r\n` 分块。Windows 直收的就是 CRLF，硬切 `'\n\n'` 整块响应当一个事件，**Claude API 流式响应解析全失败**。改成 `split(/\r?\n\r?\n/)` + `split(/\r?\n/)`，POSIX 端因 normalize 过的 `\n` 同样命中。
  - **P0-5 `lib/git-diff.js:129` git log block `split('\n')`**：git on Win piped stdout 是 CRLF，split 完每行末尾留 `\r`，文件路径直接含 `\r` → 前端展示乱码。改 `split(/\r?\n/)`。
  - **P0-6 `lib/log-watcher.js:23` 日志条目 `split('\n---\n')`**：interceptor 在 Win 写时若用 `os.EOL`，分隔符变 `\r\n---\r\n`，硬切完全失效**所有条目拼一起或漏**。改 `split(/\r?\n---\r?\n/)`。
  - **P1-13/14 `server.js:421` + `:4214` `/tmp/cc-viewer-uploads` 硬编码**：Win 无 `/tmp`，上传 mkdir ENOENT 直接挂。修法：platform 分支 —— Win 走 `join(tmpdir(), 'cc-viewer-uploads')`，POSIX 继续 `/tmp/cc-viewer-uploads/` 保留 1.6.245 PR #81 macOS allowlist 修复（`/private/tmp` realpath）；image 同步校验 endpoint 同时认 win/posix/macOS-realpath 三种前缀。
  - **测试**：新增 `test/windows-compat.test.js` 12 case ——`win32.isAbsolute('C:\\..')`/`posix.isAbsolute`/CRLF log 条目（LF / CRLF / 混合 EOL）/getUnpushedCommits 文件路径不带 `\r` 守卫 /protectedDirs `\` + `.GIT` case bypass / 普通路径放行。1872/1872 全过 + build 通过。
  - **批 2/3 入 backlog**：剩余 P1（信号 SIGWINCH / SIGTERM / 文件锁 rename retry / case-insensitive workspace / multipart 保留名 CON/PRN / `which` vs `where` / cli URL quote / explorer /select / windowsHide / cli hook 混合 EOL / FileExplorer.jsx 5 处 Modal.confirm fetch-fail silent-close UX 同 #84 同款 BUG 在 lines 411/432/572/593/669 / delete-handler TOCTOU statSync→rmSync 跟随 symlink race / git-restore 多 tab 并发 race）+ P2/P3（chokidar 轮询 / 剪贴板 backslash / Electron 签名 / UAC 防火墙 UX 文档 / `## Unreleased` 段 publish 时手动 rename 流程文档）逐条单独 PR 修。32 条审计完整清单在 `/Users/sky/.claude/plans/imperative-imagining-ullman.md`。

## 1.6.256 (2026-05-11)

- feat(ui): GitChanges 面板新增"文件夹折叠/展开"+ 按项目 sessionStorage 持久化
  - **背景**：截图里 GitChanges 显示带箭头的 `src/`、`components/`、`utils/`、`test/` 等文件夹，但箭头是装饰性的—— TreeDir 组件无展开/折叠 onClick 能力（GitChanges.jsx:25 直接渲染所有 dirs / files）。用户需要"允许开关文件夹 + 状态保留 sessionStorage 按项目分 key"。
  - **storage util 重构**：`src/utils/fileExpandedPathsStorage.js` 抽出内部 `loadSet(prefix, projectName)` / `saveSet(prefix, projectName, set)` helper，既有 `loadExpandedPaths` / `saveExpandedPaths` 改为薄 wrapper（FileExplorer 调用方零改动）；新增 `loadGitChangesCollapsedDirs` / `saveGitChangesCollapsedDirs`，prefix `'ccv_gitChangesCollapsedDirs:'`，与 `'ccv_fileExpandedPaths:'` 物理隔离。模块顶注明示两 bucket **语义反向**（FileExplorer 存"展开" 默认全折叠 vs GitChanges 存"折叠" 默认全展开），由函数名 + key 前缀防 maintainer 混用。
  - **TreeDir 改造**：接 3 个新 prop `collapsedDirs` / `onToggleDir` / `parentPath`；累计 `dirPath = parentPath ? '${parentPath}/${name}' : name`，folding key `${repoPath}::${dirPath}`；`collapsible = !!(name && onToggleDir)` —— `name=''`（根节点）和 commit details 路径（不传 onToggleDir）天然降级为纯渲染。可折叠时整个 dir row 加 `onClick` + `role="button"` + `tabIndex={0}` + `onKeyDown(Enter/Space)` + `aria-expanded`，键盘可达（mirror FileExplorer a11y）；折叠时不渲染 `dirNames.map` + `files.map`；箭头通过 `.rotated90` class 有无切换（mirror 既有 repoArrow/commitArrow 旋转语义）。
  - **GitChanges 主组件**：接 `projectName` prop（ChatView 传入）；`useState(() => loadGitChangesCollapsedDirs(projectName))` lazy hydrate；`useEffect([collapsedDirs, projectName])` 单点写盘（避开 StrictMode setState updater 闭包内写盘双跑违约）；`useEffect([projectName])` + `firstMountRef` 跳首跑后 rehydrate（mirror MobileFileExplorer P1 修法）；`onToggleDir(dirKey)` 即时 Set 切换。
  - **工作树 vs commit details 分岔**：父组件给工作树 TreeDir（L329）传真实 `collapsedDirs` + `onToggleDir`；commit details TreeDir（L127 CommitRow 内）不传 → 降级为只读。commit-scoped 状态短命，UX 影响小，本 PR 不持久化。
  - **CSS**：`.dirItem` 仅在可折叠时叠加 `.dirItemClickable`（cursor:pointer + `:hover` bg + transition），commit details 路径无 hover 误导。
  - **测试**：`test/fileExpandedPathsStorage.test.js` 加 3 case 覆盖 GitChanges bucket round-trip / 跟 FileExplorer bucket 同 projectName 同字符串 key 不串扰 / 空 projectName 守卫。1846/1846 全过 + build 通过。
  - **5-agent review 采纳 P1**：edge #7 真问题 —— projectName 异步到达期间用户折叠操作被覆盖。lazy useState 时 projectName='' load 拿空 Set，用户在 `/api/project-name` 回包前折叠 → setState 写内存（save effect 因 projectName='' 早返回不落盘），projectName 到达 → rehydrate effect 用 load(realName) 空 Set 覆盖 → 折叠丢失。修法：rehydrate effect 加 `prevProjectNameRef`，`空 → 非空` 这一跳视为延迟初始化跳过 rehydrate（save effect 用新 projectName 把内存自然落盘），真正的 workspace 切换（非空 → 非空 / 非空 → 空）才 rehydrate。其余 review 项：UX dir 行点击区域、Regression tabIndex 引入 Tab 顺序变化均入 P2 backlog。

- chore(refactor + perf): 全会话 5-agent final review 采纳 P0/P1
  - **P0-1 死引用清理**：`FileContentView.jsx:370-371` `scrollMemoViewerTypeRef` 创建+写入两行全文件零读取，删 2 行 + 同步收窄上方注释。
  - **P1-1 抽 `useSessionStoragePersistedSet` hook 统一三处持久化样板**：架构师指出 FileExplorer / MobileFileExplorer / GitChanges 三处此前各自手抄"lazy useState + persist effect + firstMountRef + （后补）prevProjectNameRef"，GitChanges 的"空→非空 projectName 异步到达不覆盖"修复未回流到前两处，已出现 paste drift。新增 `src/hooks/useSessionStoragePersistedSet.js` 把三件套打包；MobileFileExplorer / GitChanges 各 ~20 行模板代码替换为一行 hook 调用；ChatView 是 class 组件不能直接用 hook，在 `componentDidUpdate` 内手抄同款 `prev && next` 守卫（空→非空跳过 rehydrate），三处行为对齐。
  - **P1-2 GitChanges TreeDir 闭包重建优化**：递归组件每次 collapsedDirs toggle 都让全树 TreeDir re-render；原 inline `onClick`/`onKeyDown` 每次创建新闭包，深目录树 N 对闭包 × M 次 toggle 持续 GC 压力。改用 `useCallback([onToggleDir, dirKey])` 让每个 TreeDir 实例 handler 跨自身 re-render 稳定（onToggleDir 由父组件 useCallback([]) 稳定，dirKey 是同一字符串字面量），N 对闭包仅创建一次。
  - **P1-3 electron-builder 26.0.12 → 26.8.1**：architect 指出 electron-builder 26.0.x 与 electron 42 产物布局/签名兼容性未充分验证，跟进到 26.8.x 最新 patch 系列。**注意**：`npm run electron:build` 实测打包链仍需用户本地跑一次冒烟，agent 跑不了 GUI 打包。
  - **P1-4 history.md 补 Electron breaking changes 指引**：见下条。
  - **P2 入 backlog**：FileContentView 1032 行抽 `useFileScrollMemo` hook；TreeDir 12 props → `TreeContext`；`handleUpdateFileScroll`/`Consume`/`Get` 命名 → `set/clear/peek`；`fileExpandedPathsStorage.js` 文件改名 `treeFoldStateStorage.js`；MdxEditorPanel querySelector 失败加 `console.warn`；GitChanges commit details 折叠态短命持久化或 tooltip。
  - 测试与 build 通过；总技术债评分由 6.5/10 降至预估 4.5/10。

- feat(ui): 文件浏览器标题栏新增手动刷新按钮
  - **背景**：cc-viewer 自动刷新走 `_checkToolFileChanges`（Write/Edit/MultiEdit/NotebookEdit + Bash mutating 命令）的 tool_result 触发链路，但外部 mv/cp、IDE 直接修改、Git stash apply、文件系统级 watch 之外的变动等 **不被工具调用感知**的场景需要用户兜底刷新。
  - **实现**：`FileExplorer.jsx` 标题栏与折叠按钮之间加图标按钮（Feather 风格 `refresh-cw` 双弧箭头 SVG，跟其它工具栏图标 stroke-2 / size-14 一致），点 → 触发 `ChatView` 既有的 `fileExplorerRefresh++` 链路 → TreeNode useEffect 监听到变化重拉已展开目录。零新链路，复用既有自动刷新机制。
  - **CSS**：`.collapseBtn` 改名 `.headerCloseBtn`（语义更准 + 不跟 OpenFolderIcon.module.css 的 `.iconBtn` 名字混淆）；刷新按钮的样式封装在新 `RefreshIcon` 子组件的 `.module.css`，不引入 `!important` 符合 CLAUDE.md。
  - **a11y + i18n**：`<span role="button">` 跟 OpenFolderIcon 同款轻量交互；i18n 新增 `ui.fileExplorer.refresh` + `ui.gitChanges.refresh` 18 语翻译（zh "刷新"、en "Refresh"、zh-TW "重新整理"、ko "새로 고침" 等）。
  - **后续 P1 拓展（同一 PR 内继续）**：抽 `src/components/RefreshIcon.jsx`，封装 300ms cooldown 防狂点 + 一次性 360° 旋转反馈；GitChanges 标题同款接入；FileExplorer iframe 改用 RefreshIcon 子组件；CSP 收窄到只 `allow-scripts` 并叠加 `connect-src 'none'; form-action 'none'` 兜底防恶意 HTML 外发流量。
  - 1846/1846 全过 + build 通过。

- fix(server + ui): HTML 预览相对资源解析 —— 让 c8 / nyc 这类报告的 `<script src="prettify.js">` 同目录脚本可正常加载
  - **现象**：继上轮放行 CSP `allow-scripts` 后，DevTools 仍报 `Uncaught ReferenceError: prettyPrint is not defined at window.onload`；prettify.js / sorter.js / block-navigation.js 全部 404。
  - **根因**：iframe src 是 `query-style` `/api/file-raw?path=coverage%2Findex.html`，浏览器对 HTML 里相对路径 `<script src="prettify.js">` 的解析规则是"去 query + 剥最后 segment + 拼脚本名"，结果是 `/api/prettify.js`（脱离 coverage 目录），server 当然 404；`<base href>` 也救不了，query 不算 path 一部分。
  - **修法**：server `/api/file-raw` 新增 path-style 调用 `/api/file-raw/<encoded-segments>`，reqPath 直接从 `pathname` 取，复用既有 `isReadAllowed` + mime + CSP sandbox 全套；`FileExplorer.jsx` iframe src 从 `?path=...` 改为 path-style，path 各 segment 单独 encode 保留 `/`。浏览器对相对资源天然按同目录解析 → `/api/file-raw/coverage/prettify.js` 命中 ✓。query-style 老接口保留向后兼容，图片预览等单文件场景不动。
  - **副作用警告（无害）**：c8 报告还会试图把"已展开断点行"存到 localStorage，因为 sandbox 强制 unique origin → quota=0 → `Failed to set... breakpoints exceeded the quota`。这是 sandbox 隔离的预期行为，断点持久化失效但不影响渲染。
  - 1846/1846 + build 通过。

- fix(server): HTML 预览 CSP `sandbox` 放行 `allow-scripts` —— 根治 c8 覆盖率报告等带脚本的 HTML 在 iframe 里"页面不完整"
  - **现象**：用户在 cc-viewer 文件浏览器里打开 `coverage/index.html`（c8 / nyc 生成）；DevTools 报 "Blocked script execution in '...' because the document's frame is sandboxed and the 'allow-scripts' permission is not set"，sortable 表格 / prettify 高亮等交互全废。
  - **根因**：`server.js:2868` 给 `text/html` 响应下发 `Content-Security-Policy: sandbox`（无 allow- token，最严格）；CSP 与 iframe sandbox 属性同时存在时取**交集**，原先 `'sandbox'` 没有任何 token 直接覆盖掉 `FileExplorer.jsx:826` iframe 上的 `sandbox="allow-scripts allow-popups allow-forms"`，结果 iframe 上的 `allow-scripts` 被废，脚本全数被拦。
  - **修法**：server CSP 对齐 iframe 三 token：`'sandbox allow-scripts allow-popups allow-forms'`。仍保留 sandbox 强制 unique origin（即便绕过 iframe 直接访问 `/api/file-raw` 也拿不到 cc-viewer 同源 storage/cookie），但放行 scripts，c8 / 静态 HTML 报告这类站内自包含脚本恢复正常。注释同步说明 trade-off。
  - 1846/1846 测试通过 + build 通过。

- chore(deps): electron 35→42 升级补充指引
  - 跨 7 个大版本（Chromium 132→148 / Node 20→24 / V8 13.2→14.8），若仓库有自定义 main 进程（`electron/main.js`）请参考 [electron 36-42 breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)：常见踩坑 = `contextIsolation` 默认 true / `nodeIntegration` 默认 false / `webPreferences` 移除项 / `app.allowRendererProcessReuse` deprecation / `webRequest` filter 行为微调。配套升 `electron-builder@^26.8.1`（含 electron 42 产物布局兼容修复）。**发布前必须本地跑 `npm run electron:build`（最好 + `electron:sign`）一次冒烟**，agent 测试覆盖仅至 vite build / unit test 层。

- feat(ui): 文件详情打开时记录 scroll 位置，write/edit 触发刷新时自动恢复（三 viewer 全适配，不持久化，关闭即失效）
  - **背景**：文件详情用 `<FileContentView key={fileVersion}>` 设计，Write/Edit/MultiEdit/NotebookEdit 触发后 500ms debounce `fileVersion++` → 整组件 remount → 用户原 scroll 位置丢失。三种 viewer（CodeMirror / 旧 marked 预览 / MDX 编辑器）滚动容器各不同。
  - **方案**：snapshot 走 ChatView instance ref（`this._fileScrollSnapshot`）而非 React state——onScroll throttle 100ms 期间高频写入，走 state 会反复 re-render 拖累滚动顺滑度。FileContentView 收 3 props：`onUpdateScroll(snap)` / `getRestoreScrollSnapshot()` / `onConsumeScrollSnapshot()`。
    - 三 viewer 各自上报：CodeMirror 走 `view.elementAtHeight(scrollTop)` + `state.doc.lineAt().number` 得视口顶行号（soft-wrap / 异高 block 兼容）；旧 marked 预览 / MDX 编辑器走 `scrollTop / scrollHeight` 百分比（mermaid / 高亮异步撑高时百分比比像素鲁棒）。
    - 恢复时机：`!loading && content !== null && !scrollToLine` —— `scrollToLine`（Git diff 行号跳转）优先级高于 snapshot 恢复，互斥不冲突。RAF 等首帧 layout，CodeMirror view / MDX contenteditable 未就绪走最多 10/30 次重试。行号 clamp 到 `[1, doc.lines]` 兜底文件缩短。
    - 失效清理：`ChatView.componentDidUpdate` 检测 `prevState.currentFile !== state.currentFile` 一处统一清快照（覆盖 8 处 `setState({currentFile:...})` 站点，比逐处加行稳）；FileContentView 内 `viewerType` 变化（用户 markdown ↔ text 切换）主动 consume，避免切回老视图拿陈旧位置；snapshot 严格按 `{path, viewerType}` 匹配恢复，不跨文件 / 不跨视图。
    - throttle 实现：trailing-edge，pending 在 unmount cleanup 时 flush 一次，保证 fileVersion bump 前最后一帧的 scroll 不丢。
  - **MdxEditorPanel scroll API 暴露**：`useImperativeHandle` 加 `getScrollEl()` 返回 `wrapperRef.current?.querySelector('.mdxeditor-root-contenteditable')`，库升级改类名时只在 MdxEditorPanel 一处升级，不侵入 FileContentView。
  - **范围明确**：本 PR 仅 PC 端（mobile 走 `MobileFileExplorer.jsx` 不走 fileVersion 链路，无 auto-refresh，本就不需要 scroll 记忆）。markdown 含 mermaid 时百分比 ±5% 偏移、MDX 编辑期外部 Edit 丢光标（pre-existing），均不在本 PR 修复范围。
  - **5-agent review 采纳 P1**：
    - UX/Correctness 跨文件污染防御：`handleUpdateFileScroll` 加 `snap.path !== state.currentFile` 守卫单点拦下旧 path snap，独立于 React 生命周期时序（throttle 100ms 内用户切文件 / unmount cleanup flush 的旧 path 都被这里挡掉）。
    - Regression workspace 切换：`componentDidUpdate` 监听 `projectName` 变化时同步清 `_fileScrollSnapshot`，新工作区巧合打开同 path 文件不再恢复到旧位置。
    - Edge CodeMirror restore 守卫：补 `view.scrollDOM.clientHeight <= 0` RAF 重试（mount 早期 measure 未跑完 dispatch 会被零高度容器吞掉、consume 完就没第二次机会）；`dispatch scrollIntoView` 包 try/catch 兜底 view 在 RAF 间隙被 destroy 的微窗口。
    - 入 P2 backlog：抽 `trailingThrottle` 到 `src/utils/` + 单测、抽 `useFileScrollMemo` hook 把 5 个 effect 收纳、viewerType 字面量提常量、顶部 1-10 帧闪烁 `visibility:hidden` 罩、mermaid 异步撑高 MutationObserver reapply、MDX restore 用户已滚短路。
    - 1843/1843 全过 + build 通过。

- feat(ui): 文件浏览器展开状态按项目 sessionStorage 持久化 + PC popover 箭头居中
  - **背景**：展开/折叠目录树原本是 `ChatView.fileExplorerExpandedPaths` 和 `MobileFileExplorer` 各自的 in-memory `Set`，刷新/切 tab/重开抽屉就丢，跨项目还会串扰（同一 Set 装多项目相对路径）。
  - **修法**：新增 `src/utils/fileExpandedPathsStorage.js` 纯函数 helper（`loadExpandedPaths` / `saveExpandedPaths`），key 形如 `ccv_fileExpandedPaths:${projectName}`，值是 `JSON.stringify(Array.from(set))`。全部 try/catch 兜底 Safari Private Mode / 配额满 / JSON 损坏；空 projectName 守卫跳过读写避免孤儿 ":" key；空 set 走 removeItem 不留垃圾。`ChatView.jsx` 构造函数 lazy hydrate + 三处 `setState(updater, callback)` 写盘（toggle / 两处 git diff 级联打开）+ `componentDidUpdate` 监听 `projectName` 切换重 hydrate；`MobileFileExplorer.jsx` 接收 `projectName` prop + `useState(() => loadExpandedPaths(...))` lazy init + `useEffect([projectName])` rehydrate + toggle / 级联展开 useCallback 内同步写盘；**移除原"关闭抽屉清空 expandedPaths"语义**（与持久化矛盾）。`Mobile.jsx` 给 `<MobileFileExplorer>` 补传 `projectName`。
  - **测试**：新增 `test/fileExpandedPathsStorage.test.js`（node:test，mock 全局 sessionStorage）13 case 覆盖 round-trip / 项目隔离 / 空 projectName 三态守卫 / JSON 损坏 / 非数组 / 非字符串 entry 过滤 / 抛异常 mock。1842/1842 全过。
  - **5-agent review 采纳 P0/P1**：
    - correctness #3+#4：MobileFileExplorer 把 `saveExpandedPaths` 从 `setExpandedPaths` updater 闭包内挪出（StrictMode 下 updater 双调用违约 + 写盘双跑），改用 `useEffect([expandedPaths, projectName])` 单点写盘；projectName-change hydrate effect 用 `firstMountRef` 跳过首跑（lazy `useState` 已读过）。
    - side-effects 附加 micro-race：ChatView 3 处 `setState(..., callback)` 在 updater 外 `const projectName = this.props.projectName` capture 闭包，避免毫秒内切 workspace 把 A 项目的 set 写到 B 项目的 key。
    - tests #1：补 `save with empty set swallows removeItem throw` case，覆盖 storage helper 的 removeItem catch 分支。
    - tests #2：`after(() => delete globalThis.sessionStorage)` 防止全局污染外泄到将来的 jsdom 测试。
    - quality #6：`fileExpandedPathsStorage.js` 在 `set.size===0 → removeItem` 处补一行 WHY 注释。
    - 1843/1843 全过。

- chore(deps): 安全补丁批次（11 → 2，剩 2 个 moderate 系 `@anthropic-ai/sdk` 不可利用面，明确保留）
  - **9 个非破坏性 patch**（`npm audit fix`，package.json 未动 + package-lock.json 净瘦 -201 行）：`@xmldom/xmldom`（高，XML 注入/DoS）/ `dompurify`（中，ADD_TAGS/SAFE_FOR_TEMPLATES/CUSTOM_ELEMENT_HANDLING 多路绕过）/ `fast-uri`（高，路径穿越 + 主机混淆）/ `hono`（中，JSX 注入/bodyLimit 绕过/JWT 校验/Cache vary 泄露）/ `ip-address`（中，XSS）+ 链式 `express-rate-limit` / `postcss`（中，CSS Stringify XSS）/ `uuid`（中，buffer 越界）。
  - **1 个跨大版本 devDep 升级**：`electron ^35.1.2 → ^42.0.1`（一次性消掉 17 个 high CVE：AppleScript/USB/clipboard/Windows registry 注入、多处 use-after-free、IPC origin 错位等）。`electron-builder@26.8.1` 实测仍兼容 electron 42，`@electron/notarize@3.1.1` 不变。1843/1843 + build 通过；electron 主进程/打包真实跑通待 `npm run electron:dev / electron:build` 实测。
  - **保留 2 个 moderate**：`@anthropic-ai/sdk` 0.79-0.91 区间 Memory Tool 文件权限不安全 + 链式 `@anthropic-ai/claude-agent-sdk` ≥0.2.91 拖入。本仓 `lib/sdk-manager.js` 只 `await import` 后调 `query()`，**未触 Memory Tool**，无利用面。fix 路径要求降 claude-agent-sdk 0.2.138 → 0.2.90（倒退 48 patch）代价高于收益，明确不修，待上游放出非脆弱区间 sdk 再跟。

## 1.6.255 (2026-05-10)

- fix(ui): 文件浏览器 / Git 面板自动刷新机制重写——根治 Edit/Write/MultiEdit 触发时"忽刷忽不刷"
  - **背景**：旧逻辑五条独立缺陷叠加：① 只把 `Write` 列入 needFileRefresh，`Edit/NotebookEdit` 只刷 Git 不刷文件树，`MultiEdit` 完全漏判；② 监听 tool_use（工具尚未执行，特别是 Bash 长命令）拿到旧文件状态；③ 仅扫 `mainAgentSessions`，subAgent / teammate（Task / Agent Team）的修改完全感知不到；④ `_processedToolIds.size > 5000` 暴力 clear() 让残留的旧 tool_use 被重新认作"新事件"再触发刷新；⑤ 文件浏览器关闭期间的信号被守卫直接丢弃。
  - **修法**：`ChatView.jsx::_checkToolFileChanges()` 重写为 Pass 1 收集 `tool_use_id → {name, input}` 索引 + Pass 2 扫 `tool_result` 触发刷新双阶段；`tool_result` 出现 = 工具已执行完，`is_error=true` 跳过；两阶段都同时扫 `mainAgentSessions` + `props.requests` 覆盖 subAgent/teammate；`FILE_MUTATING_TOOLS = Set('Write','Edit','MultiEdit','NotebookEdit')` 取代长串 OR；`_pendingFileRefresh / _pendingGitRefresh` 累积关闭期间信号，打开瞬间消费；`_processedToolIdQueue` FIFO + LRU 砍头（上限 20000 / 保留 15000）替代暴力 clear；`collectToolUseBlocks` 提到模块顶层避免每次 cdU 重建闭包；`tool_use_id` 长度 cap 256；dev-only INVARIANT assertion；`componentDidUpdate` 的 `requests` 变化分支也调 `_checkToolFileChanges()`（否则 subAgent 路径感知不到）。
  - **command 正则补 delete 系列**：`commandValidator.js::MUTATING_CMD_RE` 加 `rmdir` / `unlink` / `\bfind\b[^|;&\n]*-delete\b`（限定单条命令内避免跨管道误匹配）+ JSDoc 注明 trade-off。
  - **测试**：新增 `test/commandValidator.test.js` 20 case 覆盖删除系列 / 创建移动 / 元信息 / git mutating / 包管理 / 重定向 + "已知 trade-off"分组带 ⚠️ 维护者警告。1829/1829 全过。

- fix(ui): AskUserQuestion 弹窗"标题在但内容空白"——根治老 Claude Code 不传 tool_use_id 触发的 portal 失配
  - **背景**：用户多次反馈 modal 顶部"需要回答"标题在但内容区空白，同时对话流 inline 卡片渲染正常。
  - **根因**：`ask-bridge.js` 的 `payload?.tool_use_id || null` 在老 Claude Code PreToolUse hook payload 不传 `tool_use_id` 时拿到 null → `server.js:2387` 走 fallback 自生成 `ask_${Date.now()}_${rnd}`。前端 `pendingAsk.id` 是这个 fallback id 但对话流 `tool_use.id` 是 `toolu_xxx`，两套命名空间不映射。`ChatMessage.jsx` portal 决策只对 `__ask__`（LEGACY 占位）通配不对 `ask_*`（fallback）通配 → owner 那条 ChatMessage 走 inline 但 modal askSlot 永远空。
  - **修法**：portal 决策抽到 `src/utils/askPortalMatcher.js::shouldPortalAskForm()`，明确列举三种合法 `activeAskId` 形态（`toolu_xxx` strict / `__ask__` LEGACY 通配 / `ask_${ts}_${rnd}` fallback 通配）。owner-idx 算法保证只有 owner 那条 ChatMessage 持非 null `lastPendingAskId`，通配不扩散误命中历史 tool_use。`server.js:2390` fallback id 生成处加 cross-link 注释指向 matcher，防 server 改格式后前端漏改。**不引入 modal 自渲染 fallback**——用户明确要求治本不治标。

- chore(deps): 新增 c8 单元测试覆盖率工具
  - devDep `c8 ^11.0.0`（零 CVE）。新增 `npm run test:coverage:html` 生成 `coverage/index.html`；原 `test:coverage` 补漏 `src/utils/*.js`。`package.json` 顶层 `c8` 配置 include/exclude/all/report-dir。`.gitignore` 加 `coverage`。当前基线：Statements 58.69% / Branches 74.88% / Functions 75.54% / Lines 58.69%。

- chore(review): 三轮 5-agent UltraReview 采纳 P0/P1
  - 第 1 轮（文件浏览器刷新）：常量化 `PROCESSED_TOOL_IDS_MAX/KEEP` / `FILE_MUTATING_TOOLS` Set / 命名 `dirty` → `pending` / 上限抬到 20000 / 新增 commandValidator 单测。
  - 第 2 轮（portal 修复）：扩展 `ask_*` 通配（防御性 + 架构师双 ACCEPT）。
  - 第 3 轮（累积 7 文件）：INVARIANT 守卫 `NODE_ENV === 'development'`（vite prod 能 DCE）；`_processToolResult` 加 `typeof fp === 'string'` 防御；test 加 ⚠️ 维护者警告；抽出 `askPortalMatcher.js` + server.js cross-link 注释形成 server↔client fallback id 协议显式锚点。1829/1829 全过 + `npm run build` 通过。

## 1.6.254 (2026-05-10)

- feat(ui): 侧栏三个 hover popover（数据统计 / Team 会话 / 用户 Prompt 导航）改为视口贴顶 + 箭头跟随触发器中心
  - **背景**：用户反馈 Token 数据统计 popover 内容过高时把整个画面"撑出"viewport，顶部被裁掉。原配置 `placement="rightTop"` + Antd 默认 `autoAdjustOverflow={adjustY:true}`（翻转 placement，不平移）。
  - **修法**：三处 popover 统一改成 `placement="right"` + `arrow={{pointAtCenter:true}}` + `autoAdjustOverflow={false}` + `align.overflow.{adjustX:true, shiftY:true}`。`shiftY:true` 走 rc-align 的"沿 Y 轴平移"分支让 popup 整体向上平移直到塞进 viewport 顶部，`pointAtCenter` 让箭头沿 popup 边自动跟踪触发器中心，从而"上方借标题栏空间 + 箭头始终指对"。content 外套 `maxHeight: calc(100vh - 48px)` + `overflow-y: auto`（上下各留 24px：顶部贴标题栏 / 底部预留 footer 工具栏视觉余量）。
  - **统一样式**：用户 Prompt 导航 popover 同步 Team 会话风格（背景 `--bg-elevated` + `border: 1px solid --border-light` + `padding: 0`），并新增 sticky 标题栏 `用户 Prompt 导航 (N)`。`.userPromptNavWrap` 用 flex 列布局让标题固定、列表滚动。
- fix(ui): 拒绝的 tool result 红框只保留 `✗ 已拒绝` badge，去掉下方"The user doesn't want to proceed..."固定模板长说明（纯噪音，无动态信息）；同时 `[Request interrupted by user for tool use]`（含历史变体 `[Request interrupted by user]` / `[Request interrupted...]`）这条 CLI 注入的占位 user message 整条隐藏，与 badge 语义重复。
  - **过滤位置**：`src/utils/contentFilter.js::isSystemText` 加 `^\[Request interrupted` 前缀匹配；`classifyUserContent` 二次提取（`stripSystemTags` 后回收用户文本的兜底逻辑）补一道 `!isSystemText(userText)` 守卫——避免 `[Request interrupted...]` 这种纯标记文本被回收成用户气泡。`test/synthetic-classification.test.js` 同步 KEEP-IN-SYNC 内联副本 + 新增 4 个用例覆盖三种变体 + 用户中段引用反例。
- fix(electron): `watchTheme()` `preferences.json` 解析失败由静默回退改为首次 `console.warn`（避免连续 fs.watch 事件刷屏），加生命周期注释说明 watcher 跟随 main process 自动清理 / 不重入。
- fix(server): `serveIndexHtml()` SSR 主题注入加自检——模板缺 `<html ... data-theme="...">` 时首次 warn（避免 SSR 优化静默 no-op），并写明四层主题来源优先级（URL ?theme= → localStorage → preferences.json → 模板 default）。
- test(pty): 新增 `test/pty-prompt-retry.test.js`（14 case），镜像 `_submitViaSequentialQueueInternal` 决策段：覆盖 ws-not-open 短路 / 第一次自检失败 → 150ms 重试 / history 兜底过滤 plan|dangerous / reverse 取最新 active / retryCount 单调防无限循环。1809/1809 全过 + `npm run build` 通过。
- chore(deps,electron): 合入 PR #82（@xiaoyuervae）—— 默认剥离 `CLAUDE_CODE_NO_FLICKER`，wrap 嵌入式 fallback / scratch shell 让用户 rc 仍能跑、然后再 unset；显式 `CCV_KEEP_CLAUDE_CODE_NO_FLICKER=1` 可保留旧行为。新增 `lib/terminal-env.js` + 配套测试，wrapper 文件写到 `~/.claude/cc-viewer/shell-rc/`，**不污染**用户 `.zshrc` / `.bashrc`。
- chore(review): 5-agent UltraReview 采纳 P0 + 全部 P1（PTY 重试单测 / fs.watch warn / Popover footer 余量 / fs.watch 生命周期注释 / SSR data-theme 自检 / 主题优先级文档）。

## 1.6.253 (2026-05-10)

- fix(sessionMerge): 反向锚点对齐替换正向 prefix-overlap，根治 mainAgent "复制翻车" 残余 + 引入 wire format 单一真理源文档
  - **背景**：用户反馈 mainAgent 对话内容仍偶发"复制翻车"——同一对话里 K 条尾部消息被当新增内容再 push 一次。1.6.249/1.6.250/1.6.251 三轮服务端层 fix（`_inPlaceReplaceDetected` 信号 / Plan C eager-update race）必要但不充分：客户端 sessionMerge 仍用旧的「正向 prefix-overlap + slice(0,64) 单条 fp」算法，遇到 `<system-reminder>...` / `<command-name>/...` 共有 64 字符头部碰撞 + CLI Plan Mode 故意发的 "K 条尾部重叠 + 后段新增" 窗口，仍会 (a) `newLen===curLen` 末位 fp 异时选错最大 K 切掉真新增；(b) `newLen>curLen` 盲推 `newMsgs[curLen..]` 复制重叠 K 条。
  - **历史**：分支 `claude/fix-mainagent-copy-bug-nq4m8` commit `9711024` 已写好反向锚点 + fp 三元组算法（`length + first32 + last32`），206/206 test pass，但当时判断"已有服务端信号驱动 fix 足够"被搁置未合并。本轮把它从孤儿分支移植到 main，并在它基础上加了 fp 缓存优化（findReverseAnchor 内预算 `newMessages` fp 数组，SSE 5000+/s 路径节省 25-100ms 累计延迟）。
  - **算法核心**：以 `newMessages[0]` 为锚从 `lastSession.messages` 末尾反向扫，配合多块连续 fp 等价校验决定 append / no-op / rebuild；anchor 命中即真锚点的概率最高（流式真锚点贴近末尾），避免命中靠前的 fp 碰撞误锚点；fp 升级 `length + first32 + last32` 三元组让单条碰撞概率压到忽略量级，多块连续碰撞概率近 0。anchor 未命中时按 newLen 与 curLen 关系 fallback：`<` → `/compact` rebuild、`===` → 整段 append（Plan Mode 2-msg 全替换窗口）、`>` → 严格前缀扩展 push tail（保 1.6.244 之前语义防回归）。
  - **未引入客户端队列（用户主张方案 C）**：审视 `AppBase.jsx:1110-1305` 后确认客户端 SSE → `_pendingEntries` → RAF → `_flushPendingEntries` → 单一 `setState` updater 这条链已经天然串行（RAF 浏览器保证 + React 18 自动批 + 单 tab 单 EventSource + 多 tab Electron 进程隔离），引入 per-session 队列**不解决任何正确性问题**反而掩盖算法层缺陷。直接对治根因（sessionMerge 算法替换）+ 加诊断挂钩，不引队列。
  - **诊断挂钩**：`src/utils/sessionManager.js::applyInPlaceLastMsgReplace` 7 级守卫的"信号到达但守卫拒绝"分支加 verbose 日志（gated by `globalThis.__CCV_SESSIONMERGE_TRACE__ === true`）+ 分类计数器 `applyInPlaceLastMsgReplace.fallbackCount`（`length-mismatch` / `response-missing` / `messages-too-short` 等）+ 成功路径计数 `appliedCount`。无信号路径（绝大多数 entry 的正常路径）不计数防 SSE 高频流量淹没。未来 race 复发时 console 直接读计数即可定位是信号缺失 / 哪条守卫拦了。
  - **wire format 单一真理源**：新建 `docs/WIRE_FORMAT.md`（§1 entry 4 形态 + §2 关键字段词典 + §3 6 种已知特殊窗口 + §4 信号链路图 + §5 5 层容错 + §6 维护责任 6 关键词搜索清单 + 附录 A 历史演进）。`interceptor.js` / `lib/delta-reconstructor.js` / `src/utils/sessionManager.js` / `src/utils/sessionMerge.js` 顶部注释指向该文档。本轮**无 wire 字段名 / 触发条件 / 客户端消费契约变更**，旧 jsonl 兼容。
  - **测试**：`test/incremental-merge.test.js` 新增 11 case：① 9711024 的 6 个 reverse-anchor regression（共 64-char 头部不再误判 / `newLen>curLen` 末尾重叠不再 K 条复制 / 严格前缀扩展引用稳定 / suffix-subset 引用稳定 / 空 fp 防御 / 反向扫多候选选最右）；② short-message fp robustness 3 case（length=1/16/31 字符边界 first32===last32 重叠抗碰撞）；③ reordered tail anchor disambiguation 1 case（末尾消息重排序）；④ fuzzy invariant 1 case（100 轮固定种子 LCG 随机 entry，校验末尾消息无 fp 等价连续重复）。`test/session-manager.test.js` 新增 2 case：`_isCheckpoint` 缺失但 `_inPlaceReplaceDetected:true` 应 fallback / fallback 计数器机制（`length-mismatch` + `response-missing` + `messages-too-short` + `appliedCount` 各路径锁死）。1783/1783 全过 + `npm run build` 通过。
  - **5-agent UltraReview 采纳**：P0（history.md 必更新——本条）+ P1（export `messageFingerprint` test 复用 / findReverseAnchor `newFps` 边界注释 / fixture `system-reminder` 加固到 ≥ 64 字符以真触发旧 slice(0,64) 共有前缀碰撞 / fuzzy seed 复现说明 / WIRE_FORMAT 附录 A 协议兼容性声明）。

## 1.6.252

- fix(proxy): 摘掉上游 `accept-encoding` 里的 zstd，根治 Node<22.15 环境下 routify 类自建代理回 zstd 压缩响应导致的 `API Error: Failed to parse JSON`
  - **背景**：用户在 Node 20/22 早期版本上跑 ccv，命中 routify.alibaba-inc.com 上游时遇到 `API Error: Failed to parse JSON`；最近一条 200 响应 body 在网络面板里是一片 ` ` + 零散字符（典型「压缩字节被当 UTF-8 解码」表现）。
  - **根因链**：① Claude CLI 用新版 undici 自动加 `accept-encoding: gzip, deflate, br, zstd`；② `proxy.js:69-70` 把请求 headers 整包透传上游（只删 host）；③ routify 看到客户端声明能解 zstd → 选 zstd 压缩；④ 但**真正收响应的是 proxy.js 的全局 fetch**，绑定**用户机器的 Node 版本**——Node bundled undici 在 22.15 之前不识 zstd，`response.body` 是原始 zstd 字节；⑤ `interceptor.js:801` TextDecoder 当 UTF-8 强解出乱码；⑥ `proxy.js:102` 又把 `content-encoding: zstd` header 剥了透传给 Claude CLI，CLI 当 JSON parse 当场炸。换句话说 Claude CLI 替 proxy.js 做了 zstd 承诺，但兑现承诺的是 proxy.js 自己。
  - **修法**：`proxy.js` 新增 exported helper `stripZstdAcceptEncoding(headers)`，在转发给上游之前从 `accept-encoding` 摘掉 zstd token（保留 gzip/deflate/br/q-value/TitleCase 大小写、单 zstd 时回退到 `gzip, deflate, br`、词边界正则不误伤 `fzstd`/`zstd-foo`）。一行调用接到 `headers = { ...req.headers }; delete headers.host` 之后。零依赖、对所有 Node 版本生效、上游 fetch 拿到的就是它能解的算法，链路恢复正常。
  - **方案权衡**：A 摘 zstd（采纳，1 行、零依赖、Node 全版本兼容）；B 删整个 accept-encoding（不彻底，新 undici 自己又会加回 zstd）；C 检测 `content-encoding: zstd` 时手动 `zlib.createZstdDecompress` 解压（救不到 Node 20、proxy/interceptor 双解码点都要接、二次拷贝）；D 替换为 npm `undici@7`（牵动 interceptor.js 整个 fetch patch 路径）；E bump `engines.node >=22.15`（抬门槛，用户迁移阻力）。结论 A 是当前最小改动 + 最大覆盖。
  - **测试**：`test/proxy.test.js` 新增 `stripZstdAcceptEncoding` 10 case 覆盖 ① 缺失头静默返回；② 未列 zstd 静默返回；③ 小写头去除 zstd；④ TitleCase 头去除 zstd；⑤ q-value 形式去除；⑥ 单独 zstd 时回退默认值；⑦ 词边界不误伤 `fzstd`；⑧ 不变更入参对象；⑨ 数组型 accept-encoding 容错；⑩ null/undefined 容错。1770/1770 全过 + `npm run build` 通过。

- fix(ui): GitChanges 面板调换顺序——当前工作区变更上移、本地未推送 commit 折叠区下移，中间用 1px dashed 虚线分隔
  - **需求**：1.6.251 引入「本地未推送 COMMIT」折叠区放在工作区文件树上方，但用户反馈最高频查看的工作区变更应该在上面，未推送 commit 应该在下面，并希望两块之间有视觉分隔。
  - **改动**：`src/components/GitChanges.jsx` 新增 `unpushedSeparator`（仅 `showUnpushed` 为真时渲染，避免无未推送 commit 仓库出现孤立分隔线），单仓库分支与多仓库分支两处渲染顺序统一调整为 `工作区树 → 虚线 → 未推送 header → 未推送 commits`。`src/components/GitChanges.module.css` 新增 `.unpushedSeparator`：`margin: 6px 8px; border-top: 1px dashed var(--border-primary); opacity: 0.7;`，无 `!important`。
  - **影响范围**：纯前端 UI 顺序调整，无 i18n 新增、无后端改动、无测试断言变更（现有 `test/git-unpushed.test.js` 校验后端数据不验证 DOM 顺序，纯顺序调整不影响）。

## 1.6.251

- fix(interceptor): Plan C `_inPlaceReplaceDetected` 在并发 mainAgent 请求竞态下漏检的根治（doubled-history 残余 case）
  - **背景**：1.6.250 已在 client 端消费 `_inPlaceReplaceDetected:true` 信号修掉 SUGGESTION MODE 末位替换的 doubled-history。但实证（cc-viewer 自验证 jsonl line 3489/3487 @21:33:46）发现 teammate 终止快速串行场景下，**信号根本没发出**——interceptor.js Plan C 漏检。
  - **根因**：`_lastMessagesCount` / `_lastTailFp` 仅在 `_commitDeltaState`（响应完成后）才更新。mainAgent LLM 流式响应耗时数秒，期间若有另一条请求 30ms 内连续 firing（teammate shutdown_response → idle_notification → teammate_terminated 三波快速串行 / SUGGESTION MODE 多次替换），后续请求处理时 prev 状态仍是更早的值，长度比对 `messages.length === _lastMessagesCount` 失败 → Plan C 不触发 → 客户端拿到无信号的 entry → `mergeMainAgentSessions` prefix-overlap=0 → push 整段 → mainAgentSessions 内存翻倍（doubled-history）。
  - **修法**：`interceptor.js:611-682` 在请求开始处理时即 **eager update** `_lastMessagesCount` / `_lastTailFp`（snapshot 旧值给 Plan C 用），不再等到 `_commitDeltaState`。effect：30ms 内连续 firing 的下一条请求能看到上一条已 in-flight 的 count/fp，Plan C 命中 → 写 `_inPlaceReplaceDetected:true` → 客户端 helper 短路。
  - **失败请求场景兜底**：如果一个请求 startRequest 后失败，`_lastMessagesCount` 残留为该请求的 length，下一条成功请求会覆盖（不会永久错位）。最差情况是误命中 Plan C 写一个多余 checkpoint，client helper 的 `messages.length === lastSession.messages.length` 守卫会让 fallback 到 mergeMainAgentSessions —— 不会损坏数据。
  - **delta 计算修正**：line 676 `messages.slice(_lastMessagesCount)` 改为 `messages.slice(_prevMessagesCount)`，否则 eager-updated 的 `_lastMessagesCount` 等于本请求的 length，slice 出空数组（消息被吞）。
  - **协议契约不变**：`_inPlaceReplaceDetected:true + _isCheckpoint:true` 字段语义与 client `applyInPlaceLastMsgReplace` 之间的 KEEP IN SYNC 关系**完全保持**。本次修法是让 Plan C 检测更可靠，不改双端契约。
  - **测试**：`test/interceptor-eager-update-race.test.js` 新增 5 case 覆盖：① eager update 命中竞态 in-place replace；② **control case**：关闭 eager update（旧行为）必须漏检（这是原 BUG）；③ sequential 路径回归；④ 3 路连续 replace 全部命中；⑤ 失败请求残留兜底。1759/1759 全过 + `npm run build` 通过；现存 `interceptor-delta-tail-fp.test.js` 8 个 Plan C case 全部仍 pass（eager 对 sequential 行为等价）。

- feat(git): 在 git 变更面板顶部新增「本地未推送 commit」折叠区
  - **需求**：之前面板只展示工作区未提交变更，看不到本地领先 origin/<branch> 的 commit。
  - **后端**：`lib/git-diff.js` 新增 `getUnpushedCommits(cwd, {maxCommits=100})`，单次 `git log --pretty='...%x1f...' --name-status @{u}..HEAD` 同时拉 commit 元数据 + 改动文件（用 `\x1e`/`\x1f` 哨兵字符避免 subject 含 tab/换行误解析）；upstream 缺失 / 分离 HEAD / 非分支时返回 `{commits:[], hasUpstream:false}`，前端据此**静默隐藏**该区。同文件扩展 `getGitDiffs(cwd, files, commitHash)` 支持 commit-context diff（旧内容用 `<hash>^:file`，新内容用 `<hash>:file`，状态查 `git diff-tree -r --name-status --root <hash>`，`--root` 让初始 commit 也能正确标记 `A`）。新增 `isValidCommitHash` 严格 hex 校验（7..40 位）防 git 路径注入。
  - **API**：`server.js` 新增 `GET /api/git-log-unpushed?repo=<path>` 返回 `{commits, hasUpstream, branch, upstream}`；`GET /api/git-diff` 新增可选 `commit=<hash>` 参数（commit-context diff），未通过 `isValidCommitHash` 校验时回退工作区模式不抛错。
  - **前端**：`src/utils/gitApi.js` `fetchAllRepos` 同时并发拉 `git-status` + `git-log-unpushed`；`src/components/GitChanges.jsx` 抽 `CommitRow` 组件，每行显示短 hash + subject + author + 智能日期（今日时:分 / 否则月-日）+ 文件数 badge，点击展开内嵌 `TreeDir` 渲染该 commit 改动文件；commit-context 文件复用 `STATUS_COLORS`/`STATUS_LABELS`/`buildGitTree`，但隐藏 restore 按钮（commit 已落盘不应工作区 restore）。`selectedCommitHash` 与 `selectedFile`/`selectedRepo` 三元唯一标识高亮，避免工作区文件与同名 commit 文件高亮串扰。`src/components/GitDiffView.jsx` 接受 `commitHash` prop 透传到 API，并在头部多渲染一个短 hash chip 让用户知晓上下文。`src/components/ChatView.jsx` `currentGitDiff` state 增加 `commit` 字段。
  - **设计决策**（user 单选锁定）：① 顶部折叠区与"工作区变更"并列于同一面板；② 点 commit 行展开文件 + 点文件右侧看 diff（与现有行为一致）；③ 无 upstream / detached HEAD 时静默隐藏该区。
  - **i18n**：`src/i18n.js` 新增 `ui.gitChanges.unpushedCommits` 18 语言翻译。
  - **CSS**：`src/components/GitChanges.module.css` 新增 `.unpushedHeader` / `.commitItem` / `.commitArrow` / `.commitHash` / `.commitSubject` / `.commitMeta` / `.commitFileBadge`，无 `!important`。
  - **测试**：`test/git-unpushed.test.js` 新增 14 case 覆盖 `isValidCommitHash` 校验边界 / `getUnpushedCommits` 无 upstream / detached HEAD / 已同步 / commits ahead / subject 含 tab 的哨兵分隔健壮性 / `getGitDiffs` commit 模式（hash 校验 / 正常 diff / 文件新增 / 文件删除）。1750/1750 全过 + `npm run build` 通过。
  - **多角色 review**（functional / risk / quality 三 agent）：P0 = 0；P1 三项均判为可接受不动（键盘 a11y 与现有 TreeDir 一致；初始 commit `^:` 已被 `--root` + is_new 守卫消化；R100/C75 截断到首字母不影响渲染）；P2/P3 全 ✓。

- fix(ui): 弱化顶部"新版本"强提醒，移到 footer 版本号后的小黄签
  - **需求**：顶部 Antd Tag color="orange" 横条强提示视觉过强；用户希望弱化为版本号后的小黄签 + hover 完整文案。
  - **改动**：`src/components/AppHeader.jsx` 删除 `updateInfo && <Tag color="orange" closable>` 块及对应 `updateInfo`/`onDismissUpdate` props 与 `shouldComponentUpdate` 比较；`src/App.jsx` footer 把原 `<svg>NEW</svg>` 徽章改为 `<Tooltip title={ui.update.majorAvailable}><span className={newBadgeText}>有新版本</span></Tooltip>`，点击仍打开升级 Modal；同步删除传给 AppHeader 的失效 props。
  - **CSS**：`src/App.module.css` 新增 `.newBadgeText` 用 `--color-warning` / `--color-warning-bg-faint` / `--color-warning-border-light` 渲染黄色 chip + hover 加深；删除已废弃的 `.footerVersionNew` / `.newBadge`。
  - **i18n**：`src/i18n.js` 新增 `ui.update.newBadge`（"有新版本"）18 语言翻译。

## 1.6.250

- fix(chat): 消费服务端 `_inPlaceReplaceDetected` 信号根治 SUGGESTION MODE 末位替换触发的 doubled-history（实证 cc-viewer 自身复现锁定）
  - **根因**：`interceptor.js:623-648` Plan C 在 mainAgent wire 上检测到 messages.length 不变但末位 fp 变化时强制写 `_isCheckpoint:true + _inPlaceReplaceDetected:true` 完整 entry。但客户端 `src/AppBase.jsx` `_flushPendingEntries` 从未消费 `_inPlaceReplaceDetected` 字段，依然走 `mergeMainAgentSessions` → `sessionMerge.js:113` prefix-overlap 算法。该算法在 `newLen===currentLen + 末位 fp 异` 必然 `maxOv = N-1` 永远找不到 K=N 全等匹配 → `overlap=0` → push 整段 newMessages → `lastSession.messages` 长度翻倍（doubled-history）。前端 ChatView 按 ts 渲染整段 → 视觉上每个 mainAgent bubble 在它自己 timestamp 旁多出一份相同内容 → "多位置穿插+整个 session 历史"翻倍。
  - **复现实证**（cc-viewer 自身验证）：用户反复关 hunter teammate（每次输入 `'继续关闭 @hunter-X'` 替换 SUGGESTION MODE 末位）时，jsonl `_inPlaceReplaceDetected:true` 与 BUG 出现 1:1 对应（hunter-D ln=2029 / hunter-E ln=2047 命中 → BUG 触发；hunter-B ln=1981 `_isCheckpoint:false` 走 delta 路径 → 不触发）。
  - **修法**：在 `src/utils/sessionManager.js` 新增 `applyInPlaceLastMsgReplace(prevSessions, entry, timestamp, isNewSession)` helper —— 命中信号时构造新 lastSession（前 N-1 条 message 引用复用 + 末位用 `entry.body.messages[N-1]`），返回 `{applied: true, sessions}`；未命中返回 `{applied: false}` 让调用方走原 `mergeMainAgentSessions` 路径。`AppBase.jsx:1234` 在 `assignMessageTimestamps` 后、`mergeMainAgentSessions` 前调用 helper，`applied=true` 直接接收 sessions 跳过 sessionMerge。
  - **避开 1.6.249 拆 Layer 2 两个坑**：① 不靠客户端 fp 启发式（直接看服务端明确信号 `_inPlaceReplaceDetected:true`，interceptor 端 fp 检测更准、只在确定命中时才写）② 不覆盖整个 `lastSession.messages`（只替末位，保留前 N-1 引用 → 同 carrier ts 多条 message 不会被误并、`_timestamp` / `_generatedTs` 等 metadata 全保留）。
  - **不修 sessionMerge.js 算法**：用户铁戒 + 9711024 反向锚点重写已证算法重写无效（算法层面无法可靠区分 in-place last-msg replace vs Plan Mode 全替换 sliding window，两者都是 `newLen===currentLen + 末位 fp 异`）。信号驱动是正交修复维度——不动 sessionMerge 内部，在 AppBase 入口加 helper 短路。
  - **下游 React 重渲染影响（必要代价，非性能 bug）**：`lastSession` 引用变化是**必要的**——ChatView `_sessionItemCache[last].session !== session` → cache miss → 该 session 全量重渲染。这正是修复要的效果：让末位 ChatMessage 真重渲染才能显示新内容（用户真实输入替换 SUGGESTION MODE）。**反例**：如果 in-place mutate `lastSession.messages[N-1]` 不换 lastSession 引用 → ChatView 走 FULL HIT 路径复用 sc.items → 末位 chip 不刷新 → 用户看不到自己的输入 → 修复破坏。前 N-1 条 message 元素引用稳定 → React reconciliation 复用 DOM 大部分；只有末位 ChatMessage 真重渲。in-place replace 是低频事件（用户输入触发，非高频流式），N=200 场景估算 50-150ms，性能影响可控。
  - **协议契约**（KEEP IN SYNC: `interceptor.js:644` 与 `src/utils/sessionManager.js applyInPlaceLastMsgReplace`）：服务端写 `_inPlaceReplaceDetected:true` 当且仅当 wire 上 mainAgent messages.length 不变但末位 fp 变化（_isCheckpoint:true 同时存在）。客户端 helper 是该字段唯一消费方。重命名 / 删除前需双端同步 + 跑 test/interceptor-delta-tail-fp.test.js + test/session-manager.test.js 双向回归。
  - **测试**：`test/session-manager.test.js` 新增 `describe('applyInPlaceLastMsgReplace')` 8 case 锁死：① 命中信号 → 在原地替换末位、前 N-1 引用稳定、长度不翻倍、lastSession 引用变化；② 无 `_inPlaceReplaceDetected` 字段 → applied=false fallback；③ `isNewSession=true` → applied=false 保留新 session 起点语义；④ `messages.length` 不一致 → applied=false 防误吃增量 push；⑤ 空 `prevSessions` → applied=false 让首条 entry 走 mergeMainAgentSessions 创建初始；⑥ `messages.length > currentLen` → applied=false（防意外消费信号导致丢消息，5 角色 review 采纳建议）；⑦ `entry.response` 缺失 → applied=false 防 ChatView Last Response 污染（5 角色 review 采纳建议）；⑧ `messages.length < 2` → applied=false（单消息退化为完全替换不安全，5 角色 review 采纳建议）。1739/1739 pass + `npm run build` 通过（5 角色 review 后净加 +44 LOC：3 case 防御性测试 + 5 守卫 + 2 段协议契约注释）。

- refactor(chat): 流式吸底状态机抽离为 StickyBottomController（修 4 个设计缺陷 + 锁泄漏 P0 + 死循环 P0）
  - **真因**：`ChatView.jsx` 流式吸底（stickyBottom）经多轮迭代后过度复杂 —— **11 个状态字段** + **7 处独立 scrollTop 写入** + **3 套并行机制**（Virtuoso 原生 followOutput / 自研双 rAF 缓动 / RO `_followToTargetIfSticky`）互打补丁。已识别 4 个致命设计缺陷：
    - **缺陷①** `_userTouching` 实现与注释相反 —— 注释说"含 momentum 前的握持"，但 `touchend` 立即翻 false，iOS momentum 起点恰好失效；document 全局监听零 target 过滤会被 sidebar / ChatInputBar / antd Modal 触摸误翻
    - **缺陷②** `_stickyScrollLock` boolean 无 owner —— 三个并发写入路径（`startRender` / `_followToTargetIfSticky` / `_startSmoothStickyFollow`）共用同一锁，A 路径 rAF 解锁会让 B 路径 step 写入暴露给 onScroll 翻 sticky，缓动半截被打断
    - **缺陷③** commit 9ff46ac 自称"不再依赖 mainAgentSessions 引用变化"未切干净 —— `cdU L588-606 → startRender → scrollToBottom` 路径仍然存在，浅拷贝外壳每次都换引用导致强制写 scrollTop
    - **缺陷④** Android Virtuoso 三套机制重叠跑 —— `followOutput='smooth'` + 自研缓动 + RO 路径，靠 `if (this._stickyScrollLock) return;` 短路当补丁兜
  - **架构重构（plan v2.1，桃源乡套餐）**：抽出独立 `src/utils/stickyBottomController.js`（class StickyBottomController，~330 行），收敛全部吸底状态、引用计数 lock、双 rAF 缓动、ResizeObserver、scrollTop 写入；ChatView 仅持 controller 实例并通过回调（`getSticky` / `setSticky` / `getMode`）注入；不依赖 React，纯 vanilla JS 可独立单测
  - **关键不变量**：`_lockDepth >= 0` 永远成立 + dispose 后 `_lockDepth === 0` 且不再变化；所有 rAF 闭包入口 `_disposed` 守卫；闭包内 `_lockDepth = Math.max(0, _lockDepth - 1)` 防下溢
  - **API 设计**：`bind(el)` idempotent + 切换 el 时清旧装新；`writeUnderLock(el, target)` 唯一 scrollTop 写入入口（双 rAF 后 lock--）；`startSmoothFollow(el)` step 链用 `_smoothLockHeld` boolean 作 owner 标记整个链占 1 个 lock 引用；`cancelSmoothFollow()` + `dispose()` + `notifyAtBottom(isAtBottom)`（Virtuoso atBottomStateChange 接管，含真值修正层 + 翻转决策层）+ `suppressOnce()`（handleLoadMore 桌面分支裸写 scrollTop 后锁短路一帧防 RO 拉到底）
  - **缺陷①修法（_userTouching → _recentTouchTs）**：controller 在首次 bind 时注册 document touchstart/touchend/touchcancel；touchstart 写 `_recentTouchTs = -1`（按住中），touchend/cancel 写 `Date.now()`；`handleScrollerResize` 内若 `now - _recentTouchTs < 300ms` 跳过 writeUnderLock 但仍 refreshFollowTarget。**同时修了原 momentum 起点失效 bug**（300ms 抑制窗口正好覆盖 momentum 起点），且仅 RO 路径读不影响 onScroll 翻 sticky 决策
  - **缺陷②修法（_stickyScrollLock → _lockDepth 引用计数 + Set<rafId>）**：boolean 改 int 引用计数，多并发写入路径堆叠正确；`_writeLockRafIds` 用 `Set` 而非 `Array`（流式高频 add/delete O(1)，避免原 `Array.filter` O(n²) 累积成内存泄漏路径——P0 perf 修复）
  - **缺陷③修法（startRender setState cb 重写）**：删除原 `wasSticky` 快照与 boolean 加锁；setState cb 内显式分流：(a) `_scrollTargetIdx != null || scrollToTimestamp` 跳转语义优先调 `scrollToBottom()`；(b) sticky 时同步 `refreshFollowTarget + writeUnderLock`（避免 React 18 batched commit 后一帧"先看顶后瞬移"视觉跳变 —— 比 RO 异步路径更稳）
  - **缺陷④修法（notifyAtBottom 统一接管 Virtuoso）**：`atBottomStateChange={(atBottom) => this._stickyController.notifyAtBottom(atBottom)}` 收敛 atBottomStateChange 路径 + 16ms 决策去重（合并同 rAF tick 内 RO + atBottomStateChange 双发）+ DOM 实测距离 60px 兜底防 footer（lastResponse / spinner / streamingLiveItem）抖动误判
  - **隐藏 P0 修复（守卫前置）**：`writeUnderLock` 入参守卫 `Number.isFinite(target)` 必须**前置**到 `_lockDepth++` 之前 —— 否则极端值（NaN/Infinity）让 lock 白占一个 rAF 周期；同时 `startSmoothFollow` step 链加 `Number.isFinite(gap)` 防御 —— `scroller.scrollTop=NaN` 时 `gap = target - NaN = NaN`，`gap <= 0.5` 永远 false，`Math.max(1, Math.min(NaN*0.35, 120)) = NaN`，会**死循环 step + 锁永久泄漏**（5 个 reviewer 都没显式提到，是从 P0-1 守卫推演时发现的隐藏 bug）
  - **ChatView.jsx 修改清单**（11 个集成点）：① constructor 实例化 controller；② cdM 删 `_userTouching` + 3 个 document touch 监听；③ cdU L559/L563 双 smoothFollow 驱动点改 `controller.startSmoothFollow`；④ cdU L660 mobileChatVisible 改 `controller.writeUnderLock`；⑤ cdU 末尾 `_rebindStickyEl` 改 `controller.bind`（idempotent）；⑥ cwUM 删 5 段旧 sticky 字段清理代码改 `controller.dispose`；⑦ startRender setState cb 重写；⑧ scrollToBottom 简化（删 stickyOverride 参数 + 保留方法名供 queueNext 调用）；⑨ handleStickToBottom 改 `controller.writeUnderLock`；⑩ handleLoadMore 桌面分支前调 `controller.suppressOnce()`；⑪ Virtuoso scrollerRef + atBottomStateChange 改接 controller。**整段删除**：`_refreshFollowTarget` / `_followToTargetIfSticky` / `_onScrollerResize` / `_bindVirtuosoResizeObserver` / `_bindStickyScroll` / `_rebindStickyEl` / `_unbindStickyScroll` / `_startSmoothStickyFollow` 共 8 个旧方法（~160 行）
  - **代码量收敛**：`ChatView.jsx` -205 / +56（净 -149 行）；新增 `src/utils/stickyBottomController.js` ~330 行 + `test/sticky-bottom-controller.test.js` 27 case ~440 行 + `test/sticky-bottom-controller-integration.test.js` 9 case ~210 行
  - **单测覆盖**（27 + 9 = 36 case）：bind idempotent + 切换 el / unbind / dispose 三态；writeUnderLock 双 rAF 锁释放 + 双并发引用计数 + dispose 飞行中 lockDepth 不下溢；startSmoothFollow + 并发 writeUnderLock 路径 + 中途 sticky=false 链停 + cancelSmoothFollow 重复调用防下溢；onScroll gap > 50 / ≤ 10 阈值翻转 + gap==阈值临界 case；smoothFollow easeOut step 35% gap min 1px max 120px；不可滚容器 startSmoothFollow 立即 release；RO 回调 sticky/non-sticky + touch 300ms 抑制 + lock 期间 RO 仍刷 followTarget；notifyAtBottom 锁短路 + 60px 兜底 + 16ms 决策去重；suppressOnce 单帧锁短路；集成测覆盖 ChatView 11 个集成点的调用序列
  - **测试盲区显式标注**（单测顶部注释）：setState cb 与浏览器 layout/paint 真实相对时序 / `el.scrollHeight` 触发 forced layout 实际开销 / Virtuoso 内部 rAF 节流与 controller rAF 排队的交错 / iOS WebKit RO 触发频率特异性 / iOS momentum scroll 期间 scrollTop 写入被忽略 —— 依赖手动 8 场景验证
  - **手动验证场景**（8 个）：桌面流式跟底 + 缓动平滑 / 桌面阈值翻转（5px 内 sticky=true，80px 外 sticky=false）/ Android Virtuoso footer 抖动不误翻 sticky / iOS 键盘弹起 visualViewport 改 layout sticky 跟到底 / iOS momentum scroll 中 chunk 抵达不打断 / 桌面 session 切换无顶部闪烁 / 桌面 queueNext 自动滚动 / 桌面 handleLoadMore 历史分页位置维持
  - **流程**：plan v2.1（`/Users/sky/.claude/plans/modular-floating-hopper.md`）经 3 个 review agent + 5 人 round-1 team review（架构 / 回归 / 代码质量 / 测试覆盖 / 性能）+ 5 人 round-2 team review（需求 / 防御 / 架构 / 代码质量 / 性能安全）双轮审计；累计采纳 P0 ×3（数组→Set / 守卫前置 / step 链 NaN 防御）+ P1 ×7（边界单测 4 + 常量注释 2 + GC 优化 1）；P2/P3 入 backlog 不本轮处理
  - **不在本次范围**：ChatView.jsx 4297 行的其他历史遗留复杂度；Mobile.jsx（已 0 吸底）；`atBottomThreshold:60` 常量解耦；iOS visualViewport → .container 高度同步链路（在 Mobile.jsx，与吸底解耦）；双 rAF helper 提炼 / setSticky 双重去重职责梳理 / `_canAutoScroll` predicate / touch listener module-level once / `notifyAtBottom` 高频去重单测加强
  - **测试**：1731/1731 全过（含 36 个新增 sticky case）；`npm run build` 通过

- revert(chat): 拆掉 client 端 in-place last-msg replace 短路（修同 carrier ts 多记录被合并 regression）
  - **真因**：`AppBase.jsx:1246-1250` 的 `isInPlaceLastMsgReplace(prevMessages, messages)` 检测命中后，**直接覆盖整个 lastSession.messages 引用**为 entry.body.messages —— 同 carrier ts 的多条旧 msg 一并被新 entry 的 messages 替掉，渲染只剩末位。这是为防 doubled-history 加的客户端层叠防御（Layer 2）。
  - **拆除决策**：用户实测 doubled-history 在有该层时**仍存在**，证明此层未真正生效；同时它造成了「同时间多条记录被合并只剩最后一条」的 regression。Layer 2 既无收益又有副作用 → 拆除。
  - **修法**：① `src/AppBase.jsx` 删 import `isInPlaceLastMsgReplace` + 删 SSE handler 内的 if-branch（line 1246-1253，~16 行），改为无条件走 `mergeMainAgentSessions(... { skipTransientFilter: true })`；② `src/utils/sessionManager.js` 删 `messageIdentityFp` (line 14-42, 29 行) + `isInPlaceLastMsgReplace` (line 55-62, 8 行) 两个 helper（合计 ~60 行）；③ `lib/interceptor-core.js:fingerprintMsg` 注释更新（KEEP IN SYNC 提示去除，标注「服务端独立使用」）；④ grep 实证 `src/ test/` 已无残留引用。
  - **保留**：① 服务端 Plan C（`interceptor.js` 的 `_lastTailFp` + `_sameLenInPlaceReplace` + 强制 checkpoint；`lib/interceptor-core.js:fingerprintMsg`；`test/interceptor-delta-tail-fp.test.js` 25 case）—— 服务端给客户端正确 wire，是 doubled-history 的唯一防线；② Layer 3 timestamp `_generatedTs` 全套；③ Layer 4 双向映射 `resolveBubbleProducerTs`。
  - **已知 trade-off**：拆 Layer 2 后，SUGGESTION MODE 原地替换由 `mergeMainAgentSessions` 的 prefix-overlap 启发式（sessionMerge.js:110-132）独立处理，可能复现 doubled-history。但此 bug 真实根因尚未定位（Layer 2 没真正阻止它），后续单独排查。
  - **测试**：1695/1695 全过；`npm run build` 通过，新 dist hash `ProxyModal-Bdf1BO7i.js`，bundle 中已无被删 helper 残留（grep 验证）。
  - **diff 收敛**：`src/utils/sessionManager.js` 从 +129/0 降到 +68/0（删 61 行）；`src/AppBase.jsx` 从 +68/0 降到 +49/0（删 19 行）。

- fix(chat): 对话 ↔ 网络报文双向映射错位修复（"查看请求"按钮 + 网络报文反向跳转 + 蓝色虚线选框）
  - **追加修复**：`ChatView.jsx:3872` 蓝色虚线选框（highlight active/fading 动画）的 findIndex 也用 carrier `item.props.timestamp` 跟 `highlightTs` (= scrollToTimestamp = request 自身 ts) 比较 —— assistant bubble 的 carrier ts ≠ 该 request 的 ts，永远匹配不到，蓝框落到错位的 bubble。改为 `(item.props.displayTs || item.props.timestamp) === highlightTs`，让 assistant 走 displayTs（= _generatedTs = producer ts），跟 highlightTs 同源 —— 选框现在落在产出该 bubble 的真实 request 对应位置。这是双向映射的第三个查询点（前两个：reqIdx forward / tsItemMap reverse），错过了所以再补

  - **真因**：上一轮 `_generatedTs` 修复让 bubble 显示时间正确（assistant 显示 producer 的 ts，不是下一次 carrier 的 ts），但**双向映射 msg ↔ request 仍按 carrier `_timestamp` 走**：
    - **Forward**（"查看请求"按钮）：`ChatView.jsx:1228-1229` `tsToIndex[msg._timestamp]` 给 assistant 拿到的是 NEXT request 的 idx（carrier ts），点击跳转的是承载者而不是产生者。`helpers.js:resolveProducerModelInfo` 用 `idx-1` hack 在 model 头像层补偿，但**没传染到 reqIdx 按钮**。
    - **Reverse**（网络报文 → 对话）：`ChatView.jsx:1791` `tsItemMap[msg._timestamp]` 把 assistant bubble 注册在 NEXT_T，不是该响应被产出的 T，点击网络列表 T 时滚不到对应 assistant bubble。
  - **修法**：新增纯函数 `src/utils/sessionManager.js:resolveBubbleProducerTs(msg)` —— assistant msg 返回 `_generatedTs || _timestamp`，其他 role 返回 `_timestamp`。两处映射点切到该 helper 作 lookup key，所有 `_timestamp` carrier 语义保持不变（resolveModelInfo / SubAgent 时间排序 / dedup / requestCacheTokenMap 等其他消费者不动）。
  - **`ChatView.jsx`** 改 2 处：① line 1228-1229 加 `lookupTs = resolveBubbleProducerTs(msg)`，`reqIdx = tsToIndex[lookupTs]`；② line 1777-1791 拆 `msgWallTs = m.props.timestamp` (carrier，给 SubAgent 时间排序用) 和 `msgLookupTs = m.props.displayTs || m.props.timestamp` (generation-first，给 tsItemMap 注册 key 用) —— 利用上一轮已经传到 ChatMessage 的 `displayTs={msg._generatedTs}` prop 而不需重构 renderSessionMessages 返回结构
  - **不动**：`helpers.js:resolveProducerModelInfo` 的 `idx-1` hack（line 1235 `resolveModelInfo(ts, msg.role)` 收到的 `ts` 仍是 carrier，hack 维持有效，不会双重偏移）；SubAgent 路径 line 1782/1800（`sa.timestamp` 是 SubAgent 自身 ts，generation = carrier）；Last Response 路径 line 1835（`session.entryTimestamp` 是该 entry 自己的 ts）
  - **测试**：`test/timestamp-assignment.test.js` 新增 `describe('resolveBubbleProducerTs')` 5 case（asst 有/无 `_generatedTs` / user msg 即使有 `_generatedTs` 也忽略 / null & undefined & {} / 缺所有 ts 字段返回 null）；1695/1695 全测试通过 + build OK，新 dist hash `ProxyModal-_uUScrR4.js`
  - **回归风险**：0 —— user msg 的 lookup 路径完全等价（`_timestamp` 不变）；assistant 的 lookup 切到 `_generatedTs`，缺时 fallback 到 `_timestamp`（= 旧行为），最坏情况是与 fix 前一致而非比 fix 前更糟
  - **跟前两轮 fix 的关系**：第 1 轮（`_generatedTs` 字段 + ChatMessage `displayTs ?? ts`）修了 bubble 显示时间；第 2 轮（`_processEntries` slimmed-iter push 阶段不 gate isAsst）修了离线批量路径下 `_generatedTs` 漏赋；本轮第 3 轮把双向映射 lookup key 也切到 `_generatedTs`，让"查看请求"按钮 + 网络列表反向跳转都跟 bubble 显示对齐 —— 三层一致

- fix(chat): assistant message bubble 时间戳错位 _processEntries slimmed-iter 漏洞补丁 + 调试代码清理（接续 _generatedTs 主线）
  - **真因（接续）**：上一条 `_generatedTs` 主修复在 SSE 实时路径（`AppBase.jsx:1302+ if (!entry._slimmed)`）正确，但**离线批量路径** `_processEntries` 在 `_batchSlim` 之后跑，slimmed entry 的 `body.messages=[]` 仅靠 `_messageCount` 占位 —— 旧实现 `for (let j = timestamps.length; j < count; j++) { const isAsst = messages[j] && messages[j].role === 'assistant'; generatedTimestamps.push(isAsst && prevMainAgentTs ? prevMainAgentTs : null); }` 的 push 阶段 gate `isAsst` 取自 `messages[j]` —— slimmed iter 时 undefined → `isAsst=false` → **永远 push null**。后续 unslimmed checkpoint（下一帧 mainAgent 触发当前被 slim 后的下一个 mainAgent）的 inner loop 写位 `if (generatedTimestamps[j]) messages[j]._generatedTs = generatedTimestamps[j]` 看到 null 跳过，**整段 slim 范围内 assistant 永远拿不到 `_generatedTs`** → ChatMessage `displayTs ?? ts` 退化到 `_timestamp`（= 下一次 entry 的 ts）→ bubble 错位渲染 14:21:40 显示 L369 长 markdown 而非 14:17:57（用户截图实证 2026/5/9）
  - **Ground truth 验证**：用 `lib/delta-reconstructor.js` 重建 `~/.claude/cc-viewer/cc-viewer/cc-viewer_20260509_123509.jsonl` 后回放：L369 (06:17:57) 真实响应 = thinking + 长 markdown 文本，L367 (06:17:11) = thinking + Bash，L487 (06:21:40) = 派 4 个 agent + 4×Agent tool_use；conversation view 把 L367 Bash 显示在 14:17:57 下、L369 长 markdown 显示在 14:21:40 下，整体晚一拍
  - **修法**：双层循环职责分离 —— push 阶段无条件记录 `prevMainAgentTs` 作"该位置首次加入时的上一个 mainAgent ts"，inner loop 用 `m.role === 'assistant'` 在写入时 gate。slim iter 仍 push prev-ts 不丢信息，后续 unslimmed checkpoint 的 inner loop 拿到正确 `generatedTimestamps[j]` 能 backfill；user msg 由 `m.role` gate 不会误赋 `_generatedTs`
  - **AppBase.jsx:372-389** 改 ~10 行；SSE 路径无需改（`!entry._slimmed` 守卫已规避，`assignMessageTimestamps` 函数本身对 slim 输入是 no-op）
  - **ChatView.jsx:1410** teammate fallback `<ChatMessage>` 加 `timestamp={session.timestamp}` prop（teammate response 即时生成时戳即等于 request ts，不需 displayTs；之前缺 timestamp 让 bubble 没时间标签）
  - **测试**：扩展 `test/timestamp-assignment.test.js` 新增 3 case 覆盖 slim 场景（① slim entry + unslimmed checkpoint backfill 验证；② 连续多 slim → 最终 ckpt 一次性 backfill 全部；③ 实战 trace 反 regression：L367 Bash + L369 长 markdown + L487 ckpt，msg[511]._generatedTs 必须 = T_369 否则 bubble 错位回 14:21:40 哨兵）；提取私有 helper `simulateProcessEntries` 直接模拟双层循环逻辑无 React class 依赖；1689/1689 全测试通过 + build OK
  - **clean**：删除 `__CCV_DBG_*` 调试探针 ~254 行（`AppBase.jsx` 顶层 globalThis bootstrap 含 cache-state dump / timeline / counterfactual URL 开关 `?disableShortCircuit=1` / find-doubling helper + SSE handler 内 _dbgPrevLastMsgs / _dbgTeamFirstFire / _dbgStateChanged / merge-jump 探针 + `ChatView.jsx:1425-1456` DUP-IN-STATE 检测器），bug 已定位错题集已记录方法论 git history 可回溯；`ChatView.jsx` 移除 `messageIdentityFp` 未用 import；短路逻辑（`isInPlaceLastMsgReplace`）保留作正常 fix；`messageIdentityFp` 仍被 `isInPlaceLastMsgReplace` 内部用，`sessionManager.js` 不删

- fix(chat): assistant message bubble 显示生成时间戳（_generatedTs 新字段，根治时间戳"晚一拍"错位）
  - **真因**：`AppBase.jsx:1310-1312` 给新增 message 赋时间戳时不区分角色，统一用 `entry.timestamp`。但 assistant 响应是上一次 API 调用产出的，被这次 API 调用带进 body.messages —— 所以 assistant msg 的 `_timestamp` 永远是"下一次 request 的 ts"，bubble 显示时间晚一拍。`helpers.js:resolveProducerModelInfo` 已用 `idx-1` hack 修了 model icon 的 off-by-one，但 bubble 时间标签直接拿 `_timestamp` 显示给用户，导致 12:53:09 显示前一帧 Bash 响应 / 12:55:37 显示 5×Agent 调用（实际应在 12:53:09）
  - **修法**：保留 `_timestamp` 语义不变（仍是 carrier ts，所有 dedup / tsToIndex / nextSessionStart / resolveProducerModelInfo 等消费者继续工作），新增 `_generatedTs` 字段表"消息生成时刻"，仅 ChatMessage bubble 显示用
  - **新增 `src/utils/sessionManager.js:assignMessageTimestamps`** 纯函数：(messages, prevMessages, isNewSession, prevCount, currentTs, prevMainAgentTs) → in-place 给 assistant 角色的新增 msg 额外赋 `_generatedTs = prevMainAgentTs`；历史 msg 继承 `_timestamp` 和 `_generatedTs`；user 角色不赋（fallback 到 `_timestamp`）
  - **AppBase.jsx 两条路径协同改**：① SSE 增量 `_flushPendingEntries`（line ~1295-1316）改用 helper + 维护 instance 字段 `this._prevMainAgentTs`，isNewSession 时 reset 防跨 session 串场，处理完 mainAgent entry 后 update；② 批量加载 `_processEntries`（line ~316-380）保留 `timestamps[]` 数组模式 + 加平行 `generatedTimestamps[]` 数组 + 局部 `prevMainAgentTs` 变量，跨 entry 维护
  - **ChatMessage.jsx `formatTime(ts)`** 改成 `effectiveTs = this.props.displayTs ?? ts`，所有 8 处现有 formatTime 调用自动 fallback；`shouldComponentUpdate` 加 `displayTs` 比对避免无效重渲
  - **ChatView.jsx** 两处 assistant `<ChatMessage>` 调用（filteredContent 路径 + string content 路径）加 `displayTs={msg._generatedTs}` prop；其他角色不传，自然 fallback 到 `timestamp`
  - **不改的文件**：`src/utils/helpers.js`（`resolveProducerModelInfo` 的 `idx-1` hack 保留 —— 它依赖 `_timestamp` 是 carrier ts，跟新逻辑不冲突）；`src/utils/sessionMerge.js`（4 处 `if (!msg._timestamp)` fallback 不触发，AppBase 已先赋）；`interceptor.js`（服务端不动）
  - **回滚**：删除 ChatView 两处 `displayTs={msg._generatedTs}` prop 即可立即回滚（数据层 `_generatedTs` 字段保留无害，IDB 持久化兼容）
  - **测试**：新增 `test/timestamp-assignment.test.js` 12 case（首次 entry / append user / append assistant / 历史继承 / isNewSession / checkpoint 多 assistant / 已有 ts 不覆盖 / 已有 ts 但缺 _generatedTs 补一刀 / null 安全 / 空数组 / L137→L223→L341 真实序列模拟）；1686/1686 全测试通过 + build OK
  - **跟前面 Plan C / 第 7 轮 client 短路的关系**：本次修的是显示层时间戳错位，跟 doubled-history（消息内容翻倍）是两个独立 bug。Plan C 修上游，第 7 轮短路修客户端 in-place pattern，本次修 bubble 显示时间—— 三层互不依赖，叠加防御

- fix(interceptor): in-place last-msg replace 强制 checkpoint，根治 delta 压缩丢失"末位换内容"信息（Plan C，doubled-history bug 上游修复）
  - **真因**：cc-viewer interceptor.js:621 `messages.slice(_lastMessagesCount)` 仅按长度算 delta。当 Claude Code CLI 在 mainAgent 末位**原地替换** user msg（典型场景：① CLI idle 时注入 SUGGESTION MODE 末位 → 用户真实输入到达替换；② Synthetic recap 通道用 CLI 生成的 prompt 替换 SUGGESTION MODE）—— wire 上 messages 数组**长度不变**但**末位内容变了**，旧逻辑算出 delta=`[]` 写入日志 → 客户端 delta-reconstructor 重建时拿到错误的"前态末位" → 下游 mergeMainAgentSessions prefix-overlap 启发式把整段当全新对话再 push 一遍 → lastSession.messages 从 N 翻倍到 2N（错题集 A 段算法假设的 doubled-history 触发链）
  - **证据链**：① 真 jsonl L3311 `2026-05-09T03:13:16.561Z` 是 Synthetic recap 调用，body.messages=[]、_totalMessageCount=227 不变、response 是 recap 文本但永不进 messages（`messageIdentityFp` 单独通道）；② mock fixture 13:13:19 帧反事实 A/B 实证：fix 开 351→351；fix 关 351→702 翻倍 + 175 行 DUP-IN-STATE；③ 错题集第 7 轮 client-side `isInPlaceLastMsgReplace` 短路是症状治疗，根因在 interceptor delta 压缩
  - **新增 `lib/interceptor-core.js:fingerprintMsg(m)`** 计算单条 message 指纹（KEEP IN SYNC: src/utils/sessionManager.js:messageIdentityFp 算法跟客户端必须一致；text 前 80 + tool_use `<name:id 后 8>` + tool_result `<tool_use_id 后 8:body 前 40>` body 下钻 array of blocks 取真实文本避开 String() 塌陷成 `[object Object]` 的 collision 坑 + string content 前 80 字符够区分 `<teammate-message teammate_id="..."` 模板末尾的 ID 名 + role 前缀）
  - **interceptor.js delta 段加 `_lastTailFp` 状态 + `_sameLenInPlaceReplace` 复合判定**：`messages.length === _lastMessagesCount && _lastMessagesCount > 0 && _lastTailFp !== '' && _deltaOriginalTailFp !== '' && _deltaOriginalTailFp !== _lastTailFp` 命中即让 needsCheckpoint=true 走全量 messages 写入分支 + 加 `_inPlaceReplaceDetected: true` 诊断字段（频率约 1-2%，用于在生产 jsonl 里事后核对触发率）；`_commitDeltaState(originalLength, originalTailFp)` 扩展第二参数在响应落盘后更新 `_lastTailFp`；5 处 caller（line 921/932/1002/1030/1035）全部改成传第二参数；`checkAndRotateLogFile` 重置 delta 状态时新增 `_lastTailFp = ''`
  - **回滚开关 `CCV_DISABLE_TAIL_FP_CHECKPOINT=1`**：env flag 命中即跳过 in-place 检测回到旧行为，紧急 disable 用
  - **客户端 0 改动**：`lib/delta-reconstructor.js:isCheckpointEntry`（line 20-29）已正确处理 `_isCheckpoint=true` 路径；`lib/log-stream.js:isCheckpointRaw`（line 88-92）regex 已识别 `"_isCheckpoint":true`；老 cc-viewer parser 100% 兼容，只是看到的是 checkpoint 而非 delta，重建结果正确
  - **测试**：新增 `test/interceptor-delta-tail-fp.test.js` 25 case（fp 单测 10 + 状态机基础 5 + in-place 核心 4 + 边界 5 + 反向 1）；扩展 `test/delta-e2e.test.js` `simulateInterceptorWrites` 加 `replaceLast` turn 类型 + 2 个新 e2e case（in-place 触发 ckpt 后重建末位是新内容；反事实证伪：legacy 模拟器跑同序列保留旧末位 vs Plan C 正确反映替换）；1674/1674 全测试通过 + build OK
  - **跟第 7 轮 client 短路（src/utils/sessionManager.js:isInPlaceLastMsgReplace + AppBase.jsx 短路）的关系**：Plan C 是上游修复，让客户端拿到 wire 真实内容，client 短路自此变成冗余防御（保留不删，作 defense-in-depth）

- fix(sessionMerge): 反向锚点对齐替换正向 prefix-overlap，根治流式 mainAgent "复制"翻车（远端 ultraplan agent 的根因诊断 + 修复）
  - 旧 `src/utils/sessionMerge.js` 三分支按 `newLen vs currentLen` 各走各的：① `newLen===curLen` tail-fp 异时走 1.6.245 的"正向 prefix-overlap"，O(K²) 线性递减找最大匹配 K；text/thinking 取 `slice(0,64)` 单条 fp 易碰撞（共有 `<system-reminder>...` / `<command-name>/...` 头部），算法挑最大 K 优先选错 → 真新增的尾部消息被切掉、流式过程实际丢消息。② `newLen>curLen` 盲推 `newMsgs[curLen..]`，假设严格前缀扩展；CLI Plan Mode 后偶发 "K 条与末尾重叠 + 后段新增" 但 newLen>curLen 的窗口会被当作新内容再 push 一遍 → 同对话出现两次相同消息，即用户报的"复制翻车"。③ `newLen<curLen` 仅尾部全等才保留，少一条不同就重建，长 session 偶尔被一条 race 拍没。
  - 新算法：以 `newMessages[0]` 为锚点，从 `lastSession.messages` 末尾 `curLen-1` 反向扫，配合多块连续 fp 等价校验决定 append / no-op / rebuild。三分支收口到一个 `findReverseAnchor` 主路径，仅在 anchor 未命中且 `newLen<curLen` 时走 /compact rebuild、`newLen===curLen` 走整段 append（Plan Mode 2-msg 全替换窗口）、`newLen>curLen` 回退到旧"严格前缀扩展"语义保兼容。fp 加固：text / thinking / string content 从 `slice(0,64)` → `length + first32 + last32` 三元组，单条碰撞概率压到忽略量级；tool_use / tool_result 保留 API 强保证唯一的 id 主键不变。
  - 流式热路径零分配：anchor.overlapLen===newLen 时不进 push 循环、不动 `messages` 引用，下游 `appendToolResultMap` WeakMap 缓存继续命中。复杂度：单候选 O(L)，最坏 O(curLen·newLen) 与旧 O(K²) 同阶；典型 K<200 可忽略。
  - 替代了之前的 v2 prevEntry-diff + id-dedup 模型（`_seenToolUseIds` / `_seenToolResultIds` Set + `_prevEntryMessages` baseline 全部移除）；保留 diagnostics 基础设施在 ChatView/AppBase/ChatMessage 等其他位置；sessionMerge 仅保留 `sessionMerge.merged` / `sessionMerge.newSession.differentUser` 两个 enabled-gated 事件供新算法可观测性
  - **测试**：`test/incremental-merge.test.js` 用反向锚点版本 853 行替换 v2 953 行（含 `describe('reverse anchor regression')` 6 case 锁死翻车场景：① text-only 共 64-char 头部不再误判；② newLen>curLen 带 K-msg 末尾重叠不再 K 条复制；③ 严格前缀扩展引用稳定；④ suffix-subset 引用稳定；⑤ 空 fp 防御；⑥ 反向扫多候选选最右）；其余 v2 test cases（id-dedup / cold-bootstrap / sliding window）随 v2 模型移除一并删除

- diagnostics(frame-capture): mainAgent UI 重复/错位排查的证据捕获基础设施（默认关闭，生产零开销）
  - **背景**：memory `project_doubled_history_two_rewrites_failed.md` 记录 2 次"修复"翻车（warning counter=0 误判修复成功），教训：必须靠原始证据（snapshot + DOM 验证）定位污染最初出现的 hop
  - **3 高嫌疑点**（4 探查 + 2 review agent 共识）：(A) `sessionMerge.js:274` additions push 不 bump `messages._cacheGen`（仅 modifications L251 bump），纯 append 帧 ChatView WeakMap 命中陈旧 toolResultMap；(B) `ChatView.jsx:659-662` `sessionsActuallyChanged` 浅比较，session 对象 in-place mutate 时假阴性；(C) `ChatView.jsx:1879-1895` `nextSessionStart` 假设 `firstTsBySi[]` 严格递增，null/乱序/重复时 subAgent 错位
  - **新增** `src/utils/diagnostics.js`：frame snapshot ring buffer (max 20)、`identityHash` (WeakMap-backed 不持引用)、`registerMsgRender` / `unregisterMsgRender` (ChatMessage mount/unmount 注册式重复检测，无 querySelectorAll 热路径)、`captureFrameSnapshot` (shape-only：sessionRefId/msgsRefId/cacheGen/firstTs/seenToolUseIdsSize 不持 messages 引用，GC 友好)、`shouldSample(denom)` (固定模式 counter%denom，避开 Math.random() 开销)、`setLastKnownSessions` (AppBase 注入)、`checkDuplicates` (rAF 触发器扫 `_msgRegistry`)
  - **新增 `__CCV_DIAG__` API**：`enableCapture(true)` / `captureNow(label)` / `getFrames()` / `exportFrames()` / `clearFrames()` / `duplicates()` / `checkDuplicates()`
  - **埋点**（全部 `if (!isDiagEnabled()) return;` 早 return）：
    - sessionMerge：`sessionMerge.addition.accept` / `sessionMerge.addition.dedupSkip` / `sessionMerge.addition.cacheGenStatus` (嫌疑 A 关键证据：`add>0 cacheGen 不变` 直接现形) / `sessionMerge.mod.miss`
    - AppBase：`appBase.merge.cacheGenAfter` + `setLastKnownSessions` 让 `captureNow()` 默认有数据
    - ChatView：`chatView.didUpdate.sessions` (嫌疑 B 关键证据：`refChanged=1 actualChanged=0`) / `chatView.invalidate.si` / `chatView.firstTsBySi` (嫌疑 C 证据：sample 1/20) / `chatView.nextSessionStart`
  - **重复检测器**：ChatView `componentDidUpdate` 末尾 `requestAnimationFrame` 调 `checkDuplicates()`，发现 `_msgRegistry[uuid].count >= 2` 自动 capture frame；assistant `<ChatMessage>` 加 `_diagMsgUuid={msg.uuid}` / `_diagKeyPrefix` 两个新 prop（uuid 缺失时跳过 register，不撞 React data-attr 警告）
  - **使用**：`window.__CCV_DIAG__.enableCapture(true)` → 复现 bug → `copy(window.__CCV_DIAG__.exportFrames())`。`enableCapture` 是统一总开关——一次启用 console verbose + ring buffer + frame snapshot + dup detector + 所有 gated 详细事件，不再需要单独设 `__TS_DEBUG__=true`。snapshot 含每个 session 的 `sessionRefId / msgsRefId / msgsLen / cacheGen / firstTs / lastTs / seenToolUseIdsSize / 末 30 条 msgs[uuid8/role/ts/contentLen/blockTypes/tuIds/trIds]` + 当前 `duplicates[]` + 末 30 条 `lastEvents` + 末 10 条 `lastWarnings`
  - **测试**：`test/diagnostics.test.js` 加 9 case 覆盖 disabled-no-op / 重复 register 命中 / shape-only snapshot / ring 滚动 / shouldSample 严格固定 / exportFrames JSON 解析 / autoTriggerOnDup 自动 capture / disable 清空 registry / identityHash 同 obj 同 id；1683/1683 pass + build OK
  - **本轮明确不修**：sessionMerge.js:274 cacheGen bump 缺失 / sessionsActuallyChanged 浅比较 / nextSessionStart 时间戳扫描——等用户实际复现并提供 snapshot 后再据证据决策修哪一层（避开 warning counter 误判翻车的老路）

- fix(chat-view): nextSessionStart 时间反向导致 subAgent 整段被 drop 的渲染层 P0
  - **真因**：`ChatView.jsx:1878` 原 `mainAgentSessions[si + 1].messages[0]._timestamp` 假设 sessions 数组按时间升序，但 sessionMerge `new-session-different-user` 路径把新 session 追加到数组末尾，其 `firstTs` 可能早于既有 sessions 内部 message 的 timestamp——nextSessionStart 时间反向，本属当前 si 的 subAgent 整段被 drop（用户实测 si=0 dropped 408→469 持续累积，si=1 / si=2 同样被错误过滤）
  - **诊断证据**：用户上传 `console-1778204747112.log` 显示 `droppedFirstTs(18:20:55) > nextSessionStart(18:01:12)` 时间反向 19 分钟；同时 sessionMerge 端 `dedupSkipped=0` / `mod=0 add=2 d=0` 完全干净——bug 不在 sessionMerge 数据层而在 ChatView 渲染层
  - **修复**：扫所有非当前 si 的 sessions，取 `firstTs > 当前 session.lastTs` 的最小 firstTs 作 nextSessionStart。不依赖数组下标顺序，跨 device 切换 / userId 切换场景下也对
  - **历史教训**：本周前后 3 次 ship 都误以为是 sessionMerge 数据层 bug（4 层防御 → 双层 head-alignment guard → v1 index-keyed → v2 prevEntry-diff+id-dedup），全部修错层。直到 3 个独立 agent 从 3 角度（信号分布/调用栈/HTML 比例）会聚到 ChatView 渲染层才锁定。Memory 里早期笔记 "lastSessionLastTs 倒退 → ChatView nextSessionStart 把 subAgent break 飞" 已预言此 bug 但被 sessionMerge 假象盖过去
  - 1673/1673 pass + build OK

- refactor(sessionMerge): 二次重写，根治 CLI doubled-history 漏判
  - **问题**：第一版 index-keyed slot-based 的 append 路径只按位置不按内容去重——CLI 单帧偶发把首部 history 副本拼接到末尾（如 `[m1..366, m1..368]`），副本位置原本是空的，无 slot rewrite 触发，被无脑 push 导致整段对话翻倍。诊断 log 看似干净
  - **新模型**：lastSession 加 `_prevEntryMessages` 缓存上一帧 CLI raw messages 作 diff baseline + `_seenToolUseIds` / `_seenToolResultIds` 累积 session 内 tool_use.id 与 tool_result.tool_use_id（Anthropic API 强保证唯一）。每帧用 prev vs new 算 positional diff，modifications（前 min 内 fp 不同的 slot）走 offset+fp 守卫双校验定位 lastSession.messages 中的目标位置原地覆盖 + bump _cacheGen + 同步 Set；additions（尾段超出 prev 部分）经 id-dedup 过滤，命中已见 id 直接 skip——CLI 副本必定命中。纯 text/thinking 永不 dedup 容许用户重发同文本
  - **保留**：isPostClearCheckpoint / isCompactCheckpoint / 异 user / transient-skip / sliding window（基于 lastSession.messages 末尾子集，聚合视更可靠）。createNewSession 工厂统一处理 4 个新 session 分支
  - **可观测**：`recordWarning('sessionMerge.dedupSkipped')` / `sessionMerge.modificationMissed` / `sessionMerge.multiSlotRewrite` 命中时触发；`__CCV_DIAG__.counters()['sessionMerge.dedupSkipped'] > 0` 即证明 doubled history 真被拦截
  - **测试**：`test/incremental-merge.test.js` 新增 6 个 dedup 专项 case 锁死核心场景：tool_use 副本 / tool_result 副本 / 纯 text 不误删 / _prevEntryMessages 跨帧 progression / postClear 重置 / sliding window 也刷 prev
  - 1671/1671 pass + build OK
  - **背景**：用户实测 22MB HTML 导出里 78 user bubble + 905 assistant bubble（实际只发 ~10 条 user message），单一 timestamp 重复 205 次。前后投入 4 轮防御（双层 head-alignment guard / immutable rebuild / per-si 失效 / 改造 0 prefix-overlap shadow rewrite + diagnostics 模块）都没覆盖"alignedHead === currentLen 全对齐 + newMessages [currentLen..] 实际是 lastSession 历史副本"这个死角——CLI 偶发把累积历史在 newMessages 末尾再发一份，老 push-based merge 盲信切片 newMessages[currentLen..] 是真增量，把历史副本接到 lastSession 末尾雪崩
  - **根因**：merge 一直是 additive 模型（lastSession.messages 长度只增不减），其工作前提是"CLI 每帧 body.messages 单调追加，前 currentLen 条永远等于上次 lastSession 前 currentLen 条"——这个前提从来没在代码里被强制校验过。alignedHead 70% / prefix-overlap / full-rewrite-rebuild 等启发式都是位置/结构层面的 patch，捕不到协议语义异常
  - **新模型**（用户提议的 index-keyed slot-based）：
    - lastSession.messages 是按 entry.body.messages 下标索引的 slot array，每条 message 打 `_originIndex`
    - 现存 slot fp 不同 → in-place 覆写 + bump `messages._cacheGen`
    - newLen > currentLen → push 新 slot；newLen < currentLen + tail subset → sliding window 保留 messages 不动；newLen < currentLen + non-subset → slots [0..newLen-1] 覆盖 + [newLen..] 保留
    - 长度天然封顶 max(已见 newLen)，CLI 单帧报文几条就显示几条，**绝不跨帧累加翻倍**
    - CLI 单帧内部重复（[hist, hist_copy] 这种 CLI 上游 bug）忠实展示——cc-viewer 的责任边界是"按位置渲染 CLI 给的内容"，内容语义由 CLI 负责
  - **新增 /compact 边界检测** `isCompactCheckpoint(entry, prevMessageCount, prevMessages)`：CLI 协议层无显式标记，用 `_isCheckpoint=true && newLen<prevMessageCount && msg[0] fp 改变 && 非 /clear` 4 信号联合推断，命中即创建新 session，旧 session.messages 完整保留——避免 /compact 把累积对话整段冲走
  - **删除的启发式分支**（共 ~170 行）：alignedHead 70% 检测 / prefix-overlap-append / full-rewrite-rebuild / non-subset-rebuild / head-not-aligned-rebuild / equal-len 多分支判定 / append-all-fallback。保留 isPostClearCheckpoint / transient-skip / 异 user 新 session / Plan Mode sliding window
  - **WeakMap cache pollution 治理**（多 agent review 揪出的 P0 阻塞）：messages ref 长期稳定后，单纯 ref 比对无法识别"slot 内容被改写"的 cache 失效。`src/utils/toolResultBuilder.js` 的 `getToolResultCache` 加 `messages._cacheGen vs cached._gen` 比对，gen 不匹配返回 null 强制重建；`setToolResultCache` 时记录 gen。`src/components/ChatView.jsx` 加 `_incToolCacheGen` 字段，fallback 路径下 ref + gen 任一不匹配 → 强制 createEmptyToolState 全扫
  - **测试**：`test/incremental-merge.test.js` 删 push 路径多分支判定的所有 case，重写为 index-keyed 语义 12 个 describe 36 个 case 覆盖 initial / 纯 append / slot rewrite / compression-window / /clear / /compact / 异 user / transient / 多 session / streaming dedup / edge cases / _cacheGen 进度
  - **可观测**：保留 `recordEvent('sessionMerge.slotRewrite' / 'sessionMerge.slidingWindow' / 'sessionMerge.postCompactCheckpoint')` + `recordWarning('sessionMerge.multiSlotRewrite')`（多 slot 同时改写罕见，便于 console 排查）
  - 1663/1663 pass + build OK

- chore(diagnostics): 调试日志策略重构 — 新建集中式诊断模块替代分散 TS-DEBUG console.log
  - **背景**：流式 mainAgent rebuild + cache staleness 系列排查中分散加了 14 处 `__TS_DEBUG__` 守卫的 console.log，每帧 stream-progress 至少 4-7 行，长会话开 `__TS_DEBUG__=true` 几秒刷千行；plan step 9 全删又会失去诊断手段——本次重构解决这对矛盾
  - **新模块** `src/utils/diagnostics.js`：三层抽象
    - `recordEvent(type, payload?)` — 永久累加 counter（零 console 开销），仅 `__TS_DEBUG__=true` 时写 ring buffer (≤500 条) + console.log
    - `recordWarning(type, payload)` — 始终持久化 warning array (≤200 条) + `console.warn`，不依赖 `__TS_DEBUG__` 开关
    - 全局桥接 `window.__CCV_DIAG__` 暴露 `events()/counters()/warnings()/summary()/clear()` 让用户在 DevTools Console 一行查现状
  - **改造覆盖**：`src/utils/sessionMerge.js` 10 处 + `src/AppBase.jsx` 3 处 + `src/components/ChatView.jsx` 5 处 全部迁移到 recordEvent / recordWarning
    - 关键事件转 event：`sessionMerge.append.{incremental-append|head-not-aligned-rebuild}` / `sessionMerge.shrink.{compression-window-keep|non-subset-rebuild}` / `sessionMerge.equal-len.{full-rewrite-rebuild|prefix-overlap-append|append-all-fallback}` / `sessionMerge.postClearCheckpoint` / `chatView.cacheInvalidate` / `chatView.subAgentInserted` / `appBase.processEntries` 等
    - 异常信号转 warning（始终 console.warn 让用户能直接看到，无需开 `__TS_DEBUG__`）：
      - `sessionMerge.alignedHeadDrift` — 70% 阈值放过的 push 错位（用户曾实测 alignedHead=154 currentLen=171 drift=17 仍走 push 的死角）
      - `chatView.subAgentDropped` — subAgent 因 nextSessionStart 截断（"卡片消失"症状的强信号）
      - `appBase.timestampsReset` — 中间态 entry 误判新会话起点导致 timestamp 倒退（曾踩过的坑）
    - 高频低价值打点删除：sessionMerge enter dump 大对象 / AppBase _processEntries START/END sessionsSnapshot / ChatView session loop iteration（每 si 每帧打）
  - **测试**：新增 `test/diagnostics.test.js` 14 case 覆盖 counter 累加 / ring buffer 限制（500/200）/ payload undefined 边界 / `__TS_DEBUG__` 开关行为 / 全局桥接 API 不可外部 mutate / clear() 重置
  - **使用**：用户在 DevTools Console 一行命令观测：`window.__CCV_DIAG__.summary()` 看 counter 分布 + warning 摘要 / `.warnings().slice(-10)` 看最近 10 条异常 / `.events()` 看最近 500 条详细事件（仅 __TS_DEBUG__ 开启时填充）
  - 1681/1681 pass

- fix(streaming-rebuild-cache-staleness): 流式 mainAgent rebuild 后 UI 显示陈旧内容根本性修复 — sessionMerge 与 ChatView cache 协议从矛盾变一致
  - **问题**：流式期间 CLI 触发 mainAgent 消息整段改写（SUGGESTION MODE → teammate-message / TeamDelete 历史重组）时，尽管 sessionMerge.js 双层 head-alignment guard 已触发 `full-rewrite-rebuild`，用户在浏览器仍看到旧内容
  - **真因**（3 个并行 Explore agent 调研 + 3 个 review agent 反馈）：
    1. `src/utils/sessionMerge.js:131/164/240` 3 处 rebuild 路径做 `lastSession.messages = newMessages` —— 仅 mutate session 对象的 messages 属性，不替换 session 对象本身的 ref
    2. `src/components/ChatView.jsx:587-602 sessionsActuallyChanged` 用 `prev[i] !== next[i]` 判 session ref 变化，rebuild 后 ref 不变 → 三大 cache（_sessionItemCache/_incToolState/_reqScanCache）都不清
    3. `ChatView.jsx:1676` FULL HIT cache key `sc.session === session && sc.msgsLen === session.messages.length` 在 rebuild + msgsLen 不变时永远命中陈旧 sc.items
    4. `ChatView.jsx:1138-1147` _incToolState fallback 永久污染漏洞：rebuild 后新 messages ref → fallback 用旧 _incToolState append 新数组尾段 → `setToolResultCache(messages, staleState)` 把脏数据写回新 messages 的 WeakMap，无机制能清
    5. 派生 byKey map 7 个字段（`_mergedPlanApprovalMapByKey` 等）在 sessionsActuallyChanged 路径未 reset
    6. `sessionMerge.js:211` prefix-overlap shadow rewrite 死角：`if (overlap === 0)` 守卫让 alignedMatchCount 仅在 overlap=0 计算 → 巧合 newMessages[0]==curMsgs[N-1] 时 overlap=1 跳过 rewrite 检测 → push 翻倍
  - **修复**：
    - **sessionMerge 改造 0**：alignedMatchCount 无条件计算（去掉 `overlap===0` 守卫），决策优先级变 rebuild > prefix-overlap > append-all，修 prefix-overlap shadow 死角
    - **sessionMerge 改造 A/B/C**：3 处 rebuild 路径改为 immutable replacement（`return [...prevSessions.slice(0,-1), {...lastSession, messages: newMessages, response, entryTimestamp}]`），提前 return 不 fall-through 到 L252-253 的 mutate 出口；incremental-append/prefix-overlap-append/compressionWindow subset 路径保留现有 mutation 优化
    - **ChatView 改造 F.1**：构造函数加 `_incToolMessagesRef = null`
    - **ChatView 改造 F.2/J**：`sessionsActuallyChanged` 路径 per-si 选择性失效（只清变化的 si，避免 si=N rebuild 让前面所有 si 整体重渲，性能 ~220ms → ~70ms 单帧）+ 同步 reset 7 个派生 byKey map（`_mergedPlanApprovalMapByKey/_prevPlanCacheByKey/_prevPlanDirtyByKey/_mergedAskAnswerMapByKey/_prevAskCacheByKey/_prevAskDirtyByKey/_prevAskLocalByKey`）+ active si 受影响时清 `_incToolState/_incToolMessagesRef`，否则跨 si 累积保留
    - **ChatView 改造 F.3**：`renderSessionMessages` fallback 加 `sameRefAsLastUse = _incToolMessagesRef === messages` ref guard，rebuild 后 messages ref 变 → 强制 createEmptyToolState，避免 stale state 写回新 messages 的 WeakMap key 永久污染；WeakMap 命中早返路径故意不更新 _incToolMessagesRef（命中说明 ref 未换）
  - **测试**：`test/incremental-merge.test.js` 6 处 rebuild case 追加 session ref 不等断言；新增 8 个 case 覆盖改造 0（rebuild 优先级 + append-all fallback 对照）/ 改造 H 边界（A3 短对话 currentLen<4 / A4 70% 边界 ±1 / C3 70% 阈值 ±1 / C4 绝对底 4）/ 改造 I（prefix-overlap-append ref 稳定）；1667/1667 pass
  - **回滚路径**：完整回滚 `git checkout HEAD -- src/utils/sessionMerge.js src/components/ChatView.jsx test/incremental-merge.test.js`；部分回滚优先 revert ChatView（保留 sessionMerge immutable，sessionsActuallyChanged 仍能触发清缓存）；不要单独 revert sessionMerge（留半截 bug）

- fix(teammate-detector): teammate 渲染不稳定 — 同一个 teammate 的 N 次 API call 有的标 "Teammate: 名字" 有的标 "SubAgent" 交替闪烁；根因：SDK Agent 的"嵌套工具调用"（teammate 内部 Bash/Read/Grep）API 请求里 tools 数组只剩那一个被调用的工具，SendMessage **不在里面**，前端 `isNativeTeammate` 严格按"system 含 'You are a Claude agent' + tools 含 SendMessage" 判据 → 嵌套调用全部降级为 SubAgent
  - `src/utils/teammateDetector.js` 加 sticky 名字缓存 `_knownTeammateNames` (Set<name>)：teammate 顶层调用（含 SendMessage）一旦确认就把 `extractNativeTeammateName` 提出的名字记入 Set，之后**无 SendMessage 但同名**的嵌套调用也归 teammate；严格 SendMessage 检查首先把"从未见过的 SubAgent"挡在第一关，sticky 只补救"已确认 teammate"的后续调用，不会把 SubAgent 误升级（顺序保证：jsonl 按 timestamp 写，teammate 顶层调用必然先于该 teammate 任何嵌套工具调用，前端按时序处理 requests 名字必然先入库再被嵌套查询）
  - `src/utils/teammateDetector.js` 新增 `resetTeammateNameCache()` 公开 API：用户切项目想避免名字残留误判时调用；测试用例之间隔离也用这个；现有 WeakMap req-cache 不动，sticky cache 是平行的二级缓存
  - `test/native-teammate-detector.test.js` 加 4 case：(1) 顶层 teammate 注册名字后同名嵌套调用也识别为 teammate；(2) 未注册名字的 SubAgent 仍判 false（防误升级）；(3) reset 后 sticky 失效；(4) sticky 不污染主 agent 判定（主 agent system 不命中 NATIVE_TEAMMATE_RE 第一关就 return false 不进 sticky）
  - **review pass** 复审采纳：(A1) `resetTeammateNameCache()` 接入 `src/AppBase.jsx` 的 `workspace_started` / `workspace_stopped` 事件 — 防用户切项目（不刷页面）时旧项目 teammate 名字残留命中新项目 SubAgent 误升级；同时把 `_cache` (WeakMap) 也整体替换为新实例（`let` 而非 `const`），避免老 req 上的 false 缓存遗留遮挡新判定；(D) ChatMessage isEmpty 注释从 5 行 trim 到 2 行，符合 CLAUDE.md "默认不写注释"；(E) sticky cache 头注释加 TODO 标记长远应在 server.js / sdk-manager 层补齐 req.teammate 后整体删除本前端补丁

- fix(chat-empty-content): ChatMessage `renderSubAgentChatMessage` innerContent 空时 return null 让消息从 UI 上凭空消失（不是折叠是不存在）；触发条件：response.body.content 全是 tool_use（无 text）+ collapseToolResults=true + tool 不在 Full-Display 白名单时 renderAssistantContent 返回空数组
  - `src/components/ChatMessage.jsx` 改为保留 label + timestamp + view 按钮的外壳，bubble 渲染 `(no displayable content)` 占位让用户至少看到这次 API call 发生过、能点 [view] 看原始请求
  - `src/i18n.js` `ui.subAgentEmptyContent` 18 语全译（zh "（无可显示内容）"/zh-TW/en/ja/ko/de/es/fr/it/da/pl/ru/ar/no/pt-BR/th/tr/uk）

## 1.6.248 (2026-05-08)

- fix(ask-orphan-badge): cc-viewer 现在能识别"被 CLI schema 校验拒收"的孤儿 AskUserQuestion——在 jsonl 渲染层加红色徽章 "❌ 此提问被 CLI 拒绝（schema 校验失败，未能投递到底层会话）" + 可展开"查看原始错误"折叠区显示完整 `<tool_use_error>InputValidationError…` 文本，让用户一眼区分 (a) 自己拒了 / (b) model 调用本身被 CLI 拒。背景：经 5-agent ask-robustness 团调研，根因是 `~/claude-code/tools/AskUserQuestionTool/AskUserQuestionTool.tsx:16` 的 `description: z.string()`（runtime 必填）经 `zodToJsonSchema` 应输出 `required:["label","description"]`，但 model 实际收到的 JSON schema 只有 `["label"]`——emission 与 validation 间存在某层 schema-rewrite（claude-code post-process / Anthropic 后端 well-known tool 处理 / 版本飘移待 follow-up 厘清），cc-viewer 永远无法在 PreToolUse hook 之前介入（toolExecution.ts:615 safeParse 在 toolHooks.ts:800 runPreToolUseHooks 之前执行，失败直接返 InputValidationError，ask-bridge 永不 spawn），只能在渲染层把症状暴露给用户。改动：(1) `src/utils/toolResultBuilder.js` 新增 `isInputValidationError = isError && /InputValidationError|<tool_use_error>/i.test && !isPermissionDenied`，挂到 toolResultMap entry 与已有 isPermissionDenied/isUltraplan 并列；(2) 抽 `src/components/AskValidationBadge.jsx` 单文件组件（接收 `resultText` prop，含展开 `<details>` 显示原文），`src/components/ChatMessage.jsx:437-470` AskUserQuestion 分支读 `toolResultMap[tu.id].isInputValidationError` 取 resultText，走交互/recap 任一路径前都渲染该组件去重；(3) `src/components/ChatMessage.module.css` 新增 `.askValidationErrorBadge / Title / Details / RawText` 样式（红色 token + monospace 折叠 pre）；(4) `src/i18n.js` 新增 `ui.askValidationErrorBadge` + `ui.askValidationErrorRaw` 18 语全译；(5) 兜底 normalize：`lib/ask-bridge.js:63` 解析 questions 后对 options[].description 缺失补 `""`（防 schema 修了但 hook 还在迁移期），`server.js:2319` POST /api/ask-hook 镜像同样的 normalize 覆盖 plugin/SDK 等非 ask-bridge client。配合上一条 fix-ask-submit-failure-modal 的 antd Modal 升级，构成"渲染层显式标错 + 用户提交时 modal 解释 + ask-bridge 兜底 normalize"三层防御
- fix(ask-submit-failure-modal): AskUserQuestion 提交失败时把 `message.warning` toast 升级为 antd `Modal.warning`，给用户更显著的反馈与原因说明。背景：当 ask 在 API 层就被 `InputValidationError` 拒绝（如 Claude Code 的 zod schema `description: z.string()` 必填但 zodToJsonSchema 输出 `required:["label"]` 只——assistant 按文档省略 description 即触发），底层 CLI 从未拿到 PreToolUse hook，cc-viewer 仍按 jsonl 里的 tool_use 渲染成可交互表单，用户点提交 → `_submitViaSequentialQueue` 检 `state.ptyPrompt` 不是合法 ask → `_abortAskSubmitWithRollback` 回滚乐观写入 + 弹 toast。toast 文字小、停留短，用户难以判断症状是临时网络/服务问题还是 ask 本身死了。改动：`src/components/ChatView.jsx:_abortAskSubmitWithRollback` 把 `message.warning(t('ui.askSubmitRetryHint'))` 替换为 `Modal.warning({ title, content })`，title 复用现有 `ui.askSubmitRetryHint`（"提交未送达，请重试"），content 用新 i18n key `ui.askSubmitFailedDetail` 写明 3 大原因（CLI 层拒绝 / WS 暂断 / hook bridge 未就绪）+ 下一步建议；底部加一行 `[reason] {abortReason}` 暴露技术码（ws-not-open / pty-prompt-invalid / ws-send-failed）便于排障。`src/i18n.js` 新增 `ui.askSubmitFailedDetail` 18 语全译。配套保持 `toolResultBuilder.js:181` 原 `isPermissionDenied` 判据不动——errored ask 仍渲染成可交互表单，让用户主动尝试提交触发 modal，而不是被 cc-viewer 静默标 rejected
- refactor(ask-question-form): AskUserQuestion `options[].description` schema 标记可选，cc-viewer 现有 5 处访问点（AskQuestionForm.jsx 4 处 + ChatMessage.jsx 1 处）原本各自内联 `opt.description && ...` / 三元 `opt.description ? \`${label}: ${desc}\` : label`，逻辑重复且无单测兜底；本机 jsonl 已确认 4 条 description 缺失的真实样本（2026-05-07）。抽出 `src/utils/askOptionDesc.js` 暴露 `optionAriaLabel(opt)` + `hasOptionDescription(opt)` 两个纯 helper：前者用 `String(opt.label)` 对齐原 JSX 模板字面量在 number label（如 `123`）下的渲染，避免误退化为空串丢 a11y；后者 `Boolean(opt && opt.description)` 与原 `&&` falsy 判定严格等价。`AskQuestionForm.jsx` 4 处 + `ChatMessage.jsx` 480 行全部切到 helper，`grep 'opt.description'` 后只剩纯值取用、不再有判断式。`test/askOptionDesc.test.js` 7 case 锁定 falsy/truthy 集合（含 whitespace/数字/对象/数组）+ number label 强转 + 空 opt 边界
- fix(ask-hook): 多并发 AskUserQuestion 时上一个未答的会卡死下一个 — 单槽 → Map<id> 多路复用
  - 现象：`pendingAskHook` 是单变量，第二个 ask-bridge POST 进来时 server.js:2324 直接 409 Superseded 老的，老 bridge 进程降级到终端 UI（`lib/ask-bridge.js:131-134` exit 0 fallback）；前端 `pendingAsk` 同时被覆盖，UI 上下一个 ask 也答不出来
  - 对照 perm-hook（`pendingPermHooks` Map + 队列 + id 寻址）和 SDK Plan（`_pendingApprovals` Map + 5min 独立 timeout）—— 这两条路径一直是健壮的多路复用，只有 ask-hook 是单槽。本次让 ask-hook 抄齐 perm-hook 的形态
  - `server.js` `pendingAskHook` 单变量 → `pendingAskHooks = new Map()` + `ASK_HOOK_MAP_MAX = 50` 一致防 OOM；`/api/ask-hook` POST 不再 supersede 前一个，改为生成 `id = ask_${ts}_${rand}` + cap 满时驱逐最老（429）+ 每 entry 独立 5min timer + `res.on('close')` 按 id 清理；广播 `ask-hook-pending`/`ask-hook-resolved`/`ask-hook-timeout` 全部带 `id`，与 `_notifyParentPending` 已有的 `msg.id != null ? String(msg.id) : '__ask__'` 路径打通（`server.js:141`）让 Electron tab worker `pendingByTab[tabId].ask` Map 按 id 多路复用（`electron/main.js:148, 199, 473-475, 667` 早就支持 id-keyed，这次 server 终于配齐）
  - WS `ask-hook-answer` handler 加 `msg.id` 寻址；无 id 时 fallback 到 Map 第一个 entry（保留旧前端兼容路径）；plugin interaction `getPendingAsk()` 保留单数 shim（返回 first），新增 `getPendingAsks()` 返回数组，`resolveAsk` 重载 `(id, answers)` 强类型 + 单参 legacy `(answers)` fallback
  - `src/components/ChatView.jsx` 加 `askQueue: []` 状态镜像 `permissionQueue`：`ask-hook-pending`/`sdk-ask-pending` 到达时如 head 已占用就入队（按 id 去重防 WS 重连重投），entry 形如 `{ id, questions, kind: 'hook'|'sdk' }`；新 `_promoteNextAskFromQueue` helper 在 head 解析（resolved/timeout）时弹下一个并同步 `_askHookActive`/`_sdkAskId`/`_askHookQuestions` 三个路由 instance 字段（kind=sdk 走 SDK 路径、kind=hook 走 hook bridge 路径）；`handleAskQuestionSubmit` 改为乐观推进队列（不再 `pendingAsk: null` 一刀切）；`_submitViaHookBridge(answers, explicitHeadId)` 新增 id 参数，`ask-hook-answer` payload 现在带 `id`（`__ask__` 占位仅旧 server 兼容时跳过）
  - `componentWillUnmount` 把 `state.askQueue` 也通过 `window.tabBridge.notifyAskResolved` 逐个清掉，否则 Electron `pendingByTab[tabId].ask` Map 残留导致 dock badge / flashFrame 状态不归零；ws-close 状态恢复路径（`_onTerminalWsState`）也清 askQueue
  - `lib/ask-bridge.js` 完全不动：bridge 对 id 不可知，发 POST 等回包，id 是 server 内部寻址用
  - `test/server-ask-hook-map.test.js` 2 case：两 POST 并发都不 409 supersede（核心 regression guard，旧单槽实现下首请求会被服务端 409 close）+ 空 questions[] 400 验证；workspace 模式无 WS server，故纯 HTTP 验证
  - **review pass** 复审采纳：(1) `pendingAskHooks.has(id)` collision guard 防 30bit 熵碰撞下 `Map.set` 静默覆盖泄漏 res；(2) `lib/ask-bridge.js` 区分 HTTP 429（cap 满驱逐）与其他 4xx，stderr 显式日志；(3) `LEGACY_ASK_PLACEHOLDER_ID` 常量化（5 处 `'__ask__'` 字面量）+ `ASK_KIND.HOOK/SDK` 常量化（3 处 `kind: 'hook'/'sdk'`）；(4) `sdk-ask-pending` 缺 id 改 `console.warn` 显式上报防御 invariant 违反；(5) 删 `getPendingAsks()` 之外的单数 `getPendingAsk()` shim + `resolveAsk(idOrAnswers, answersOrUndef)` 重载，强类型只剩 `resolveAsk(id, answers)`
  - 1635/1635 pass（包含 sticky teammate cache 4 个新 case）

## 1.6.247 (2026-05-07)

- chore(perm-bridge): `git commit` / `git push` 退出硬拦截白名单，仅 `npm publish` 仍走 Web UI 强制审批
  - `lib/perm-bridge.js` 正则从 `/git\s+(commit|push)|npm\s+publish/i` → `/npm\s+publish/i`；commit 可重写、push 可 force-push 回退，blast radius 局部；npm publish 不可撤销才走硬闸
  - `test/perm-bridge.test.js` 加 3 个 bypass-mode 契约 case：`git commit` / `git push` 在 `CCV_BYPASS_PERMISSIONS=1` 下被自动 allow；`npm publish` 仍 forward-to-server
- feat(mobile-menu): 移动端菜单顺序对齐 PC 端
  - `Mobile.jsx` 菜单 5 → 8 项；项目文件夹（mobile 独有）置顶、其余按 PC 顺序：日志管理 → 用户 Prompt → 插件管理 → CCV进程管理 → 代理热切换 → divider → 数据统计 → 偏好设置
  - `_closeAllMobileOverlays` 扩展含新 3 个 modal flag；汉堡按钮加 `aria-expanded`/`aria-haspopup`；i18n 复用 PC 既有 `ui.pluginManagement` / `ui.processManagement` / `ui.proxySwitch` 18 语全译
  - `App.module.css` `.mobileMenuDropdown` overflow 改 `max-height + overflow-y:auto` 防 iPhone SE 等小屏溢出；新增 `.mobileMenuDivider`（语义 token，无 `!important`）
- refactor(modals): 插件管理 / CCV进程管理 / 代理热切换 抽到独立组件 PC + mobile 共用
  - 新增 `src/components/{Plugin,Process,Proxy}Modal.jsx`；FC + hooks 实现，三种受控风格（self-contained / 半受控）的判定原则见 PluginModal 头注释
  - `AppHeader.jsx` 删 inline JSX + 17 个 handler + 11 个 state 字段，净减 ~390 行；删 8 个抽离后无引用的 antd / icon import
  - `Mobile.jsx` mount 3 个组件；ProxyModal 通过继承 AppBase 直接读 `proxyProfiles` / `activeProxyId` / `defaultConfig`；PC 与 mobile 共用同一份 fetch 逻辑
  - `ProcessModal` kill 确认 + `ProxyModal` 删除确认 + `PluginModal` 删除/CDN 子 modal 全部用受控 `<Modal>` 替代 `Modal.confirm` —— 父 modal 关闭时通过 `useEffect(!open)` 联动关闭，避免外层关了内层确认仍在屏的孤儿态；mobile zoom 0.6 容器下也能正确缩放
- feat(cache-popover): 在 "持久记忆" 上方新增 CLAUDE.md 入口分区
  - 新 `lib/claude-md-discovery.js`：从 cwd realpath 起向上 walk 父链至 `.git` / `$HOME` / fs root / 8 层封顶（任一即停），加上 `~/.claude/CLAUDE.md`，组合成候选清单；`basename(real) === 'CLAUDE.md'` 拒 symlink-name swap，按 `realpath` 去重，每条候选 id = `sha1(realpath).slice(0,12)`（48 bit，候选数 <20 时碰撞概率 ≈ 10⁻⁹）
  - 新 `GET /api/claude-md` 端点：不带参 → entries 数组（仅 `{id, scope, tail, mtimeMs}`，不暴露 realPath）；`?id=<hex12>` → 重算候选 + `basename` 二次校验 + 走 `isReadAllowed`（拿 `policy.real` 做 fd-based read，闭 TOCTOU 窗口）+ 512KB cap，输出 `{scope, tail, content}`
  - `CachePopoverContent.jsx` 新增 chip 列表分区，位于持久记忆**上方**（CLAUDE.md 是规则、记忆是产物，规则在前）；空候选时整段隐藏（不像 MEMORY.md 总在）；chip = `[项目]/[全局]` 徽章 + 路径尾段（`title=` 全路径），点击 → 复用 `MemoryDetailModal` 渲染 markdown
  - `MemoryDetailModal` 加 `linkMode` prop（`'memory'` 默认 / `'passthrough'`）：passthrough 模式下 `https?://` 链接 `window.open(_, '_blank', 'noopener,noreferrer')`，相对路径 / 其他协议（含 `javascript:`）一律 `preventDefault()`；MEMORY.md 流程不变
  - `AppHeader.jsx` / `Mobile.jsx` 双端各自 own `_claudeMd` / `_claudeMdDetail` 槽 + `_claudeMdSeq` / `_claudeMdDetailSeq` 计数器（与 `_memorySeq` 同语义防快慢回包乱序），workspace 切换 / 卸载都 bump 计数器作废在途请求；分槽避免与 `_memoryDetail` 交叉污染
  - CSS 用 `--color-primary-bg-light` / `--color-success-bg-light` 等语义 token，自动适配 dark/light 主题；无 `!important`
  - i18n 18 语：`ui.claudeMdSection`（CLAUDE.md 字面值跨所有语言）/ `ui.claudeMdScopeProject` / `ui.claudeMdScopeGlobal`
  - Windows 当前仅返回全局候选（POSIX 父链语义在 win 上未独立验证，留给 v2）
  - 测试 +20：`test/claude-md-discovery.test.js` 13 case（基本 + .git 终止 + 去重 + symlink basename 拒 + dir-not-file + readCandidateById 五态）+ `test/api-claude-md.test.js` 8 case（list/detail/400/404/200/413 + HTTP 层 symlink basename swap 防御）；1625/1625 pass

## 1.6.246 (2026-05-07)

- feat(chat): 流式 spinner 升级为 Claude 官方 SVG 动画（从 claude.ai webpack chunk 抠出 8 个 sprite-sheet）
  - 新增 `src/img/claude/{thinking,waiting,tickle,orbiting,writing,shimmer,entrance,exit}.svg`，每个用 SMIL `<animate attributeName="viewBox" calcMode="discrete">` 在嵌套 `<svg>` 上做精灵图逐帧滚动
  - 8 个文件外层 `<svg>` 统一上品牌橙 `#D97757`，与原 ModelAvatar logo 颜色保持一致
  - `ChatView` 流式 spinner（mobile Virtuoso footer + desktop 两处）由原内联 `<svg><circle><animateTransform/>` 替换为 `<img>` + 50/50 在 shimmer / orbiting 间随机；roll 移到 `componentDidUpdate` 检测 `isStreaming` rising-edge 一次性写入 instance ref，避免 render 内 `Math.random()` 副作用；spinner JSX 抽 `spinnerNode` 复用，去重两份复制粘贴
- feat(file-viewer): `ImageViewer` 现支持 SMIL 动画 SVG
  - `DOMPurify.sanitize` 默认的 `USE_PROFILES: { svg: true }` 会 strip `<animate>` / `<set>` 等 SMIL 节点，导致预览本仓库 / 任意 SVG 都冻在第 0 帧
  - 抽 `src/utils/svgSanitize.js` 集中：放行 SMIL 元素 + 必需属性，并加 `uponSanitizeAttribute` hook 拒绝 `<set>/<animate*>` 把 `attributeName` 指向 `^on` / `href` / `xlink:href` / `style`（defense-in-depth：现代浏览器 SMIL 引擎本身已挡 event-handler 注入，hook 是兜底）
  - 新增 `test/svg-sanitize.test.js` 14 case 覆盖 hook 字符串规则 + config 形状（hook 真实 sanitize 行为依赖 jsdom，未引入新 dep）
- refactor(model-avatar): `helpers.js` 的 `svgAnimated` 数据源替换
  - 删除旧 `src/img/model-claude-animated.svg`（1024×1024 CSS path-morph 触手 logo）
  - 改 import `src/img/claude/writing.svg?raw`（100×100 sprite-sheet 8 帧 / 0.72s loop）
  - `ChatMessage.module.css` 删除针对旧 pulse 触手"破圆"效果的注释
- i18n: `ui.lastResponse` 从英文占位翻译到 18 语
  - zh "最新回复" / zh-TW "最新回覆" / ko "최신 응답" / ja "最新の回答" / de "Letzte Antwort" / es "Última respuesta" / fr "Dernière réponse" / it "Ultima risposta" / da "Seneste svar" / pl "Ostatnia odpowiedź" / ru "Последний ответ" / ar "آخر رد" / no "Siste svar" / pt-BR "Última resposta" / th "คำตอบล่าสุด" / tr "Son yanıt" / uk "Остання відповідь"；en 保留 "Last Response"
- fix(mobile): `ToolApprovalPanel` 全局浮层在 zoom polyfill 容器下被推到屏底盖输入栏
  - 双保险：`ChatInputBar.jsx setVar` 加守卫拒绝 `distFromBottom < 5` 异常量测；`.panelGlobal` `bottom: max(calc(var(--chat-input-bar-height, 200px) + 12px), 56px)` 兜底最小避位
  - `ChatInputBar.jsx` 新增 `parentZoom` 折算：祖先 `zoom !== 1` 且 `getBoundingClientRect()` 未反映 zoom 时（Android WebView），`rect.top * parentZoom` 折算回视口坐标，避免审批面板被推得过高
- fix(mobile): 移动端血条抽屉 / 记忆 / Skill 详情 antd Modal 不适配暗主题
  - `Mobile.jsx` 在 `mobileCLIRoot` 外层加单一 `<ConfigProvider theme={this.themeConfig}>` 包裹，所有内嵌 antd Modal 通过 React Context 继承 `themeConfig`（Modal portal 仍走 React 树，Context 正确传递）
- fix(chat-input): `ghostText` 推荐文本盖在 `imagePreviewStrip` 缩略图上
  - `.ghostText` 原 `position: absolute; top: 0`，锚到 `.chatTextareaWrap`，有图片预览 strip 时直接漂到 strip 顶部
  - 修：包一层 `.textareaWithGhost` (`position: relative`) 仅围 textarea + ghostText + interimPreview，让两个 absolute 元素锚到 textarea 自身，避免与 strip 几何重叠
- fix(chat-view): "保持吸底"未真正贴 `.container`，依赖 `mainAgentSessions` props 变化驱动
  - 新增 `_followToTargetIfSticky(scroller)` helper：`stickyBottom && !_stickyScrollLock` 时直接 `scroller.scrollTop = _followTarget`
  - `_stickyResizeObserver`（桌面）+ `_virtuosoResizeObserver`（移动）callback 都 wire 进来，吸底改为容器尺寸驱动；任何让内容长高的事件（teammate / sub-agent / plan 文件异步到达 / 字体加载完）都自动吸底，不再依赖 props 变化是否经过 mainAgent 路径

## 1.6.245 (2026-05-06)

- fix(server): macOS 粘贴图片上传后预览 403 修复（合并 PR #81）
  - macOS `/tmp` realpath 后是 `/private/tmp`，若启动时 `/tmp/cc-viewer-uploads` 还不存在，`computeRoots()` 的 `realpathSync` 会 throw → fallback 到 raw `/tmp/cc-viewer-uploads`
  - 之后 upload 写文件、`/api/file-raw` 又把同一路径 realpath 成 `/private/tmp/...`，不命中 allowlist → 403 outside-allowlist
  - 双保险修复：① `lib/file-access-policy.js` 在 darwin 平台显式追加 `/private/tmp/cc-viewer-uploads` 到 allowlist；② `server.js` 在 mkdir upload 目录后调用 `bumpWorkspacesVersion()` 刷新 root 缓存
  - 新增 darwin-only 回归断言验证 allowlist 含 `/private/tmp` 上传根
- feat(mobile): 偏好设置与 PC 端能力对齐
  - 新增「仅窗口失焦时通知」开关（沿用桌面 `window.tabBridge` 守卫，纯 web 模式下不渲染）
  - 新增「日志设置」分组：`resumeAutoChoice` 开关 + 继承/新开 Radio
  - 「主题色」分组重命名为「主题风格」，`themeColor` 行补回左侧 label，新增「语言设置」选择器（18 语言，与 PC 完全一致）
  - 复用 AppBase 既有 handler（`handleResumeAutoChoiceToggle/Change`、`handleLangChange`、`handleApprovalPrefsChange`），无新增持久化通道
- style(mobile): 偏好设置区块分割与标题区分度优化
  - `.mobileSettingsSectionTitle` 从 13px/500/text-tertiary → 15px/600/text-primary + letter-spacing 0.2px，标题与行 label 立刻拉开档次
  - 新增 `.mobileSettingsGroup` 包裹层 + `.mobileSettingsGroup + .mobileSettingsGroup` adjacency selector：分组之间 24px margin-top + 16px padding-top + 一条细分割线
  - `.mobileSettingsGroup .mobileSettingsRow:last-child` 去掉每组最后一行的下边框，避免与新分割线重叠
  - `.mobileSettingsRow` 加 `gap: 12px`，padding 10→12px；`.mobileSettingsLabel` 加 `flex: 1 1 auto; min-width: 0` 防窄屏挤压
  - `.mobileSettingsBody` 加 `overflow-y: auto` 防内容溢出
- refactor(i18n): `LANG_OPTIONS` 提取到 `src/i18n.js` 作为单一源
  - 原 `src/components/AppHeader.jsx` (line 39) 与新加的 `src/Mobile.jsx` 同名常量重复，未来必 drift
  - 统一 export，`AppHeader.jsx` 与 `Mobile.jsx` 改为 `import { LANG_OPTIONS } from '../i18n' / './i18n'`
  - 顺手删除 AppHeader 旧版未被引用的 `short` 字段
- 1591/1591 pass

## 1.6.244 (2026-05-06)

- feat(ui): PC 端血条迁出 AppHeader，按场景就近显示
  - **终端开启** → 血条放在 TerminalPanel 工具栏中段（左按钮组与 ScratchBtn 之间），`flex: 0 1 200px` 自适应
  - **终端关闭** → 血条放在 ChatInputBar 底部按钮区中段（左 +/mic 与 hint+send 之间），同样 200px 上限
  - "当前项目:xxx" 留在 AppHeader 原位但变纯文本（无背景 / 无 popover / 不可点击）
  - 血条内文本改为 `213K (21%)` Context 数 + 百分比，左对齐，文字内嵌彩色填充之上
  - popover placement `bottomLeft → topRight`，trigger 现在在屏幕底部、popover 向上展开
  - 工具栏 / 输入区改为 3 段式（左 / slot / 右）flex 布局，slot 高度对齐相邻按钮（terminal 26px / chat 28px）
  - 实现：`ReactDOM.createPortal` + slot ref（App.jsx 持 contextBarSlot state，TerminalPanel/ChatInputBar 通过 ref callback 注册），AppHeader 仍持有数据所有权与 popover 状态，仅 DOM 位置外移
  - 移动端 (`Mobile.jsx` + `mobileCtxTag*`) 不动；raw / 网络报文等无终端无输入区模式下血条隐藏
- feat(calibration): 校准下拉从 7 个具体型号简化为 3 个上下文窗口尺寸：`auto` / `1M` / `200K`
  - **AUTO 自检测**：按最近一条 MainAgent 请求的 model 名匹配 `opus-4-7|opus-4.7|opus 4.7`（大小写不敏感）→ 1M；含 `1m` 子串（如 `deepseek-v3-1m`）→ 1M；否则 → 200K；冷启动（无 lastMainAgent）默认 1M
  - 老用户 localStorage 残留旧型号字符串显式迁移：`opus-4.7-1m → 1m`，`sonnet-4.6 / glm5 / kimi-k2.5 / minimax-2.1 / Qwen 3.5 → 200k`，保留校准语义而非降级到 auto
  - i18n label 从"Calibrate model:"语义跃迁到"Context window size:"，18 语种统一加 "context/上下文/контекст" 等消歧词避免误读为 UI 窗口尺寸
  - 校准 Select 宽度 `160px → 80px`（选项简化后内容很短）
  - 新 helper `resolveCalibrationTokens(calibrationModel, lastMainAgent)` + `CALIBRATION_TOKEN_MAP` 集中映射；不变量"永远返回 1000000 或 200000"让 AppHeader 简化掉一段不再可达的中间分支
- chore(constants): 抽 `AUTO_COMPACT_USABLE_RATIO = 0.835`（auto-compact 在 ~83.5% 触发，扣 16.5% buffer），AppHeader.jsx + Mobile.jsx 共 5 处替换硬编码；公式 `/ 83.5 * 100` 简化为 `/ AUTO_COMPACT_USABLE_RATIO`
- ux(popover): 折叠分组标题点击区从 `flex: 1` 占满整行收窄到 `flex: 0 0 auto + display: inline-flex`，避免误触
- ux(input-bar): ChatInputBar 中段血条与左侧 mic 按钮的间距从 4px 翻倍到 ~8px（`margin-left: 4` 叠加 `gap: 4`）
- chore(cleanup):
  - 删除 AppHeader.module.css 重复的 `.liveTagText` 规则
  - 删除 TerminalPanel.module.css 中 ScratchBtn 改用 `.toolbarRight` 包裹后已不被引用的 `.toolbarBtnRight`
  - `resolveCalibrationTokens` 加 `typeof raw !== 'string'` 防御守卫（proxy 异常返回 number/object 时不抛错）
  - AppHeader.jsx 清理已不使用的 `getModelMaxTokens` / `getEffectiveModel` 导入
- chore(test): `test/helpers.test.js` 新增 8 个 `resolveCalibrationTokens` case 覆盖直接查表 / auto + opus-4-7 / 大小写不敏感 / 1m 子串 / sonnet 走 200K / 冷启动 / legacy 值兜底；1590/1590 pass

## 1.6.243 (2026-05-06)

- feat(skills): 新增 `/api/skills/import` 上传接口 + 移动端 cache popover 抽屉「添加 skill / 管理」入口。前端三入口（文件夹 / .zip / SKILL.md）：PC 走 antd Dropdown，移动端（含 iPad）去 dropdown 直接 onClick → `.zip,.md` 文件选择器（webkitdirectory 在移动端浏览器普遍不支持，已 feature detect 隐藏文件夹项）。文件夹入口前端 JSZip 打包后复用 zip 通道。新组件 `SkillsManagerModal.jsx` + 独立 css module 解除对 AppHeader.module.css 的硬耦合；AppHeader / Mobile 共用，状态机（_skillsModal: open/loading/skills/error/toggling）与 toggle 乐观更新 + 失败回滚同构（短期接受重复，与既有 reloadFsSkills 一致）。新增 i18n key `ui.skills.add/addFolder/addZip/addMd/folderMissingSkillMd/uploadSuccess/uploadFailed/invalidType/zipMissingSkillMd` 全 18 语言；移除已弃用的 `ui.skillEnabled` / `ui.skillDisabled`（toggle 成功不再弹 toast，Switch 状态本身已反馈）；handleToggleSkill reload 后用 orderMap 保留 modal 显示顺序避免 card 跳位
- security(skills-import): 多层防御
  - **Zip Slip**：`resolve(targetDir) + sep` 后缀比较防 prefix 攻击（`my-skill-evil/x` 不能以 `my-skill` startsWith 通过）+ entry 名 `..` 过滤双层
  - **Symlink 拒绝**：检测 zip entry attr 高 16 位 unix mode `0o170000 == 0o120000` 直接 400
  - **Zip Bomb 双层**：第一层 `header.size` 廉价初检（单文件≤50MB / 总≤200MB）；第二层 `getData().length` 真实复核防 header 谎报
  - **multipart boundary 加固**：正则改 `[^;]+` 终止 + 长度封顶 200 + 引号去除
  - **文件名 Unicode 净化**：NFKC 规范化 + 控制字符 + 零宽/方向覆盖字符过滤防 homoglyph / RLO 混淆
  - **错误信息脱敏**：5xx 返 `'server_error'` 不暴露内部路径
  - **TOCTOU 修复**：`existsSync + mkdirSync(recursive:true)` → 原子 `mkdirSync()` + try/catch EEXIST 消除竞争窗口
- perf(context-tokens): AppHeader.jsx + Mobile.jsx 把 contextPercent 与 contextTokens 的两次反向扫描 requests 合并成单次循环（`lastMainAgent` + `lastTotalTokens` 共用），`calibration / precise / fallback` 三分支复用同一遍历结果。200 条 requests 场景每 render 节省 ~5-10ms
- ui(mobile): cache popover 抽屉里 SkillsManagerModal 适配 zoom: 0.6 抽屉 ——`width: calc(100vw - 8px)` 贴边 + body `zoom: 0.6` 与抽屉同步避免字号偏大；PC 端 `min(1200px, calc(100vw - 80px))` 不变
- deps: 新增 `adm-zip@^0.5.17`（dependency，server 端 zip 解压）+ `jszip@^3.10.1`（devDependency，前端 dynamic import，Vite 打包成独立 chunk）
- test: 新增 `test/skills-import.test.js` 14 case（happy path 4 / rejections 5 / security defenses 5 含 symlink / zip bomb / zip slip / sep-suffix prefix attack）；全量 1582/1582 pass

## 1.6.242 (2026-05-05)

- feat(memory): AppHeader / Mobile 血条 popover「持久记忆」区新增"刷新"按钮（图标+文字 + spin loading），主动拉取 `/api/project-memory` 并 `message.success/error` 反馈；与 lazy-load 静默失败策略区分（lazy-load 仅显示区内 errorBody，主动刷新失败 toast 5s）。三态契约：`null` 加载中（disabled+tooltip）/ `false` 失败可重试 / `{exists:false}` 无 MEMORY.md 文件（disabled+tooltip）/ `{exists:true}` 启用。seq 防 stale + 连点守卫 + workspace 切换复位 `_memoryRefreshing`。LiveTagPopover 中间层透传 `memoryRefreshing` / `onRefreshMemory` props。新增 i18n key `ui.memoryRefresh` / `ui.memoryRefreshSuccess` / `ui.memoryRefreshFailed` 全 18 语言；Mobile.jsx `componentWillUnmount` 与 AppHeader 对齐 seq 自增（`_fsSkillsSeq` / `_memorySeq` / `_memoryDetailSeq`）防止卸载后回包污染
- chore(ultraplan): 移除 UltraPlan 弹窗的 200K 上下文窗口警告（原在模型 context < 1M 时显示 "请先执行 /clear" 黄色提示）—— 删除 `UltraPlanModal.jsx` modal + `TerminalPanel.jsx` popover 两处独立渲染、关联 CSS 类（`.contextWarning` / `.ultraplanContextWarning`）、i18n key `ui.ultraplan.contextWarning` 全 18 语言条目，及 `ChatView.jsx` / `TerminalPanel.jsx` / `UltraPlanModal.jsx` 不再使用的 `getModelMaxTokens` import 和 `modelName` prop

## 1.6.241 (2026-05-05)

- perf(theme): `themeConfig` getter 改为返回模块顶层 `Object.freeze` 常量（LIGHT/DARK_THEME_CONFIG），消除每次 render 返回新 `{algorithm, token: {...}}` 字面量。旧实现导致 antd v5 cssinjs `useTheme` 的 `useMemo` cache 永远 miss → `DesignTokenContext.Provider` value 引用变 → 所有 useToken 消费者重渲染 + 整棵 antd 子树（Tooltip/Dropdown/EllipsisTooltip 等）重 mount。**Chrome Performance trace 实测同条件对比**（baseline 13.5s / new 25s 等比归一）：antd `R` 函数总耗时 5344ms (39.4%) → **260ms (1.04%)**（−95%）；`Vk` self 446 → 4.2ms（−99%）；`_objectSpread2` self 369 → 7.2ms（−98%）；`Yi` 子组件 mount 树 incl 2718ms → 47.8ms（−98%）；GC 总耗时 6242ms (46.1%) → **703ms (2.8%)**（−89%）；堆分配速率 ~120 MB/s → **4.8 MB/s**（−96%）；DOM totalObjects 106 796 → 79 982（−25%）；用户代码态 long task > 200ms 数量 → 0。修复"页面长时间卡死 + 滚动掉帧"主因

## 1.6.240 (2026-05-05)

- perf(entry-slim): raw payload tool_result 内容 intern（B 项 / v5）—— `internEntryBigFields` 扩展 walk `body.messages[*].content[*]`，对 `type='tool_result'` 且 string content (>= 256) 的 block 走 readResultPool 共享。SubAgent / Teammate entry 不被 slim 路径首次获得 raw payload dedup（v4 仅覆盖派生 toolResultMap.resultText 视图层，raw payload 此前每个 entry 独立分配）。**浏览器 console diag 实测：综合 hitRate 97.6% / v5 自身 41261 calls / 18418 hits / 0 evictions / poolSize 594，估算回收 36-92 MB raw payload 重复**。新增 `internToolResultIfPooled` 命中-aware 变体，解决 JS string === 是值比较导致 lazy-clone 失效的关键 bug（设计 review 阶段识别）；sig 加 mid-64 切片防御 length+前后缀重合的结构化输出碰撞；新增 `_poolEvictions` 诊断计数器
- test: entry-slim.test.js +12 case（zero-overhead / 跨 entry 共享 / array 形态透传 / 短结果透传 / mutation 隔离 / mixed 命中 / malformed blocks / mid-slice 边界 / eviction 后 ref 有效性 + 2 internEntryBigFields 集成）；toolResultBuilder-dedup.test.js +3 case（sig mid-slice 防碰撞 + eviction counter）；总计 1568/1568 pass

## 1.6.239 (2026-05-05)

- perf(tool-result-pool): 通用化 Read 专属 intern pool，默认覆盖所有 tool_result（Bash/Grep/Glob/MCP/Task/...）—— phase4 retainer 实证派生层 89.3% hitRate / git diff 69 副本 → 3 unique pool entry / entry-slim.js cat-n 121 → 7 entry，~15-30MB 派生层 dedup；sig 不带 toolName 前缀让 MainAgent 与 SubAgent 同内容字符串共享同一引用，自动覆盖未来新增 tool 类型

---

## 1.6.238 (2026-05-05)

- perf(entry-slim): 全局 intern pool + Read tool_result content-hash dedup（堆 v3 实测从 531MB → 189MB / 节省 65%；Bash 描述 678 份 → 4 份；解决 1.6.237 fullEntry 累积根因）

---

## 1.6.237 (2026-05-05)

- perf(entry-slim): MainAgent body 大字段 slim 扩展到 tools/system/metadata/tool_choice（堆快照实证 884 条 slimmed entry 各保留完整 ~250KB body.tools 是渲染进程内存暴涨主因；预期回收 ~50% 渲染堆 / ~256MB）

---

## 1.6.236 (2026-05-05)

- perf(chatview): viewReqProps 9 处 spread → 显式 prop（消除 messages.map 内对象创建热点）
- refactor(contexts): SettingsProvider class → 函数组件 + useMemo value（消除 contextType 订阅链路虚假重渲）
- refactor(appheader): 抽离 LiveTagPopover + inline style 提常量 + CSS 变量化（hover 血条 popover 性能修复）

---

## 1.6.235 (2026-05-05)

- fix(server/sse): /events 写 backpressure 等待消除监听器累积（MaxListenersExceededWarning）

---

## 1.6.234 (2026-05-05)

- perf(interceptor): SSE 流式累积延迟物化（消除 V8 ConsString 多次 O(n) 拷贝）
- feat(chat): live 模式 compact 时间戳 + view-request 图标按钮
- fix(server/sse): /events 默认窗口 + 全 SSE 写循环 backpressure

---

## perf(entry-slim): 全局 intern pool + Read tool_result content-hash dedup

### 问题

1.6.237 发布后再做 heap snapshot（1.1GB JSON / 531MB self_size），实测发现**预期 256MB 节省并未达到**：Bash 工具描述仅从 884 份降到 678 份（-23%），53KB system prompt 反而从 287 份涨到 317 份。

反向边图实证根因：`createIncrementalSlimmer` 设计上**只 slim 同 session 的"前一条" MainAgent**，每个 session 的"最后一条" fullEntry 永远保留完整 body.tools。再加上 session boundary 检测（`count < prevMsgCount * 0.5 && (prevMsgCount - count) > 4`）在长会话 streaming/delta 场景频繁误触发，单次 heap 累积 678 个 fullEntry，每个独占 ~250KB tools 描述 ≈ 170MB 浪费。**slim 越彻底越接近 678 个 fullEntry，越浪费**。

第二个独立问题：subagent / 父 user message 累积同一 .jsx 文件 87 份完整副本（30MB+），不在 1.6.237 优化范围。

### 方案

不再依赖"按 session 边界 slim"思路，引入**全局 intern pool**：所有 entry（含 fullEntry）的 body.tools / body.system 在进入 state.requests 之前过 `internEntryBigFields(entry)`，按 signature 命中 module-level pool 共享同一份完整数据；slim 与 intern 是两件正交的事，slim 仍按原逻辑降级 messages，但 fullEntry 的 tools/system 不再每条独占。

`src/utils/entry-slim.js` 新增：
- `_toolsPool` / `_systemPool` Map<sig, fullArray>，FIFO 上限 200
- `_toolsSig` 用 `t:` 前缀 + length + 各 tool name + description.length 拼接
- `_systemSig` 用 `a:` / `s:` 前缀 + length + 各 block type + textLength + 前 50 + 中部 50 字符（双段防长文本碰撞）
- `_internOrAdd` 注册时 `Object.freeze` 浅冻结防止 caller mutate 污染
- `internEntryBigFields(entry)` 替换 body.tools / body.system 为 pool ref，dirty 时返回 clone，干净时返回原 entry

`src/AppBase.jsx`：
- `_flushPendingEntries:1091` 在 SSE reconstruct 后立即 intern
- `_batchSlim:140` 每条 entry 先 intern 再 slim；自动覆盖 loadEntries / load_chunk / loadMoreHistory / loadSessionEntries / load_end / batch reload 7 处批量路径

`src/utils/readResultPool.js`（新模块）+ `src/utils/toolResultBuilder.js:139`：
- `internReadResult(s)` 对 ≥256 字符的 Read tool_result 做 content-addressed dedup
- sig = length + 前 64 + 后 64 字符；FIFO 容量 1000
- 抽到独立模块（无外部依赖）规避 toolResultBuilder.js 传递 import（./helpers 无 .js 后缀）的 ESM 解析问题

### 后果

heap v3 实测三方对比（同等长度会话）：

| 指标 | 1.6.236 baseline | 1.6.237 已发布 | 1.6.238 v3 | 净降幅 |
|---|---:|---:|---:|---:|
| JSON 大小 | 782MB | 1.15GB | **450MB** | **−61%** |
| self_size | 436MB | 531MB | **189MB** | **−65% / −342MB** |
| 字符串总量 | 206MB | 206MB | **41MB** | **−81%** |
| Bash 描述份数 | 884 | 678 | **4** | -99.5% |
| 53KB system prompt 份数 | 287 | 317 | **4** | -98.6% |
| Agent 描述份数 | 284 | 28 | **2** | -99.3% |

每工具堆里仅 2–4 份对应 4 种合法 session shape（MainAgent / SubAgent / Plan / Task spawner），不是 leak，是设计预期。反向边图实证 678 个 fullEntry 的 body.tools 全部指向 pool ref，零遗留副本。

实际节省（342MB）超过原估算（210MB）的原因：tools/system 共享后**外层 Object wrapper 与 closure 也跟随下降 60%**——单条 entry 不再独占 tools 数组对象 → 不再独占 tool 项对象 → 不再独占 description 字符串。整个 retainer 链一起塌。

"网络报文模式"（`viewMode === 'raw'`）零功能影响：`DetailPanel.render()` 入口 `getCurrentRequest()` 已对 _slimmed entry 做 restore，restored entry 的 body.tools 是 pool ref（完整）；intern 不破坏 restore 语义。

### 测试

`test/entry-slim.test.js` 新增 8 个 case（含 freeze 行为防御性测试 + 6 种 sig 边界）+ `test/toolResultBuilder-dedup.test.js` 8 个 case 覆盖 internReadResult。共 1549/1549 通过（旧 1533 + 新 16）。

### 已知剩余热点（下一站）

- subagent / teammate messages 中其它工具的 tool_result（Bash / Grep / Glob 输出）尚未走 dedup 池，可扩展 `readResultPool` 为通用 `toolResultPool`
- Anthropic content-block Object wrappers 仍占 ~68MB
- AntD render leak（onJsEllipsis / triggerEdit 等 4794 份）需 react-window 虚拟化才能根除

---

## perf(entry-slim): MainAgent body 大字段 slim 扩展到 tools/system/metadata/tool_choice

### 问题

用户反馈渲染进程内存频繁暴涨。Chrome heap snapshot（782MB JSON / 7.93M nodes / 436.5 MB self_size + 81 MB native ≈ 520 MB 实际堆）实证：

- **字符串占 47.3% / 206.5 MB；94 % 字符串字节是重复**（理论可去重 194.6 MB）
- 0 个 detached DOM 节点、0 个 self_size > 1MB 的数组、最大 Map/Set 仅 23 entries —— 排除监听器泄漏、unbounded cache、ArrayBuffer 等常规嫌疑
- Top 30 self_size 中 **13 项是工具描述与 system prompt 的完整副本**：884 份 Bash 工具描述（每份 20.8 KB） / 884 份 Monitor / 884 份 Read / 798 份 TeamCreate / 287 份 53KB system prompt / 81 份 56KB system prompt …… 单 tools 描述累计 ~70MB、system 累计 ~20MB

边遍历对应：`string("Executes a given bash...")` ← `.description` ← `Object{tool}` ← `[idx]` ← `Array(tools)` ← `.tools` ← `Object{body}` ← `.body` ← request entry。**887 条 request body 同时活在 state.requests 中各自保留完整 tools[]**。

根因是 `src/utils/entry-slim.js` 的 slim 操作只清空 `body.messages = []`，**没动 `body.tools`、`body.system`、`body.metadata`、`body.tool_choice`**。注释里写"消除 480MB 老格式日志膨胀到 1.2GB OOM"，但 v1 实现实际只解决了 messages 维度，剩下的大字段在每条 slimmed entry 里都被原样保留。

### 方案

`slimBodyBigFields(body)` 把 4 个大字段降级为占位 shape 而非粗暴 delete，目标是**保留 read path 所需的最小结构、零调用方改动**：

- `body.tools[]`：每个 tool 仅保留 `{ name }`（`description` ~20KB / `input_schema` 全删）。`isMainAgent` 旧路径 `body.tools.some(t => t.name === 'Edit')`、`isNativeTeammate` 中 `tools.some(t => t.name === 'SendMessage')`、`isPreflightRequest` 的 `tools.length` 全部仍正常工作。
- `body.system[]`：每个 text block 保留前 `SYSTEM_TEXT_KEEP_PREFIX = 2048` 字符与 `cache_control` 等其它字段。覆盖现有的 system text 检测关键词："You are Claude Code"、"You are a Claude agent"、`SUBAGENT_SYSTEM_RE`（command execution specialist|file search specialist|planning specialist|general-purpose agent）、`cc_version=X.Y.Z`，全部命中点都在前 2KB 内。`getSystemText` 拼接、`SUBAGENT_SYSTEM_RE.test` 等正则全部仍正常工作。
- `body.metadata`：仅保留 `user_id`（slim session boundary 检测依赖）、删除 `request_id` 等其它字段。
- `body.tool_choice`：直接 `delete`，无 read path 依赖。

`restoreSlimmedEntry` 对称还原 4 个字段（旧版本已经从 fullEntry.body 取 system，本次扩展到 tools/metadata/tool_choice）。

并发安全维持原模块设计：批量路径 `_batchSlim` 在 entries 传给 React 前 in-place 替换 `prev.body = slimBodyBigFields(prev.body)`，增量路径 `createIncrementalSlimmer` clone 出新 entry 替换 `requests[idx]` 避免 React 渲染中间态污染。

### 后果

- 单条 slimmed MainAgent entry 由 ~300KB（tools desc ~250KB + system ~50KB）降到 ~11KB（tools name only ~1KB + system 前 2KB ~10KB），**节省 ~289KB / 96%**。
- 884 条 slimmed entry × 289KB ≈ **回收 256MB / 渲染堆 ~50%**。
- "网络报文模式"（`viewMode === 'raw'`）零影响：`DetailPanel.render()` 入口 `let request = this.getCurrentRequest()` 已自动 restore（`getCurrentRequest()` 内 `_slimmed ? restoreSlimmedEntry(...) : request`），所有 raw body 展示 / KV-Cache / ContextTab / Claude.md+Skills 检测 / 复制 / diff 全部走 restored 对象。
- 持久化路径与既有"slim 持久化 + 加载时 restore"模式一致：`saveEntries` 写入 slimmed merged，`loadEntries → _batchSlim → restoreSlimmedEntry` 闭环还原；`_fullEntryIndex` 在 in-memory state 始终有效，跨 session 加载也通过 `loadSessionEntries` + `_processEntries`（`isMainAgent` 走 entry 顶层 `mainAgent` 标记 + 保留的 `_messageCount` / `metadata.user_id`）正常工作。
- 隐含假设：restored 的 tools/system/metadata 取自同 session 的 fullEntry 而非该请求自己的原始值。要求"同 session 内 tools/system 在请求间稳定"——堆快照 884 份 Bash 描述完全相同验证假设成立。这不是本次新增假设，旧版 `restoreSlimmedEntry` 已对 system 这样做，本次只是把 tools/metadata/tool_choice 也纳入同一池。

### 测试

`test/entry-slim.test.js` 共 19 case（原 16 + 新 3），覆盖：

- batch / incremental slimmer 的 tools/system/metadata/tool_choice 降级行为
- restoreSlimmedEntry 4 字段对称还原 + cascade `_fullEntryIndex` 路径
- React state 引用安全（incremental 路径 clone 不 mutate 原 entry）
- isMainAgent 检测关键词在 slimmed system text 中保留
- edge cases：`body.system` 是字符串、`body.tools[]` 元素无 name、`body.metadata` 为 null/undefined/无 user_id

---

## perf(chatview): viewReqProps 9 处 spread → 显式 prop

### 问题

Chrome perf trace 实测前端 hover 路径上单次主线程任务 1.7 秒、长任务总占比 38.76%、帧丢失率 75%。CPU profile 叶子热点 `_objectSpread2` 占 871 样本，反查 source-map 落在 antd v5 cssinjs runtime（`@ant-design/cssinjs-utils/es/util/genStyleUtils.js`）+ Babel `@babel/runtime/helpers/esm/objectSpread2.js`。前端代码侧的同源问题集中在 `ChatView.renderSessionMessages` L1168 的 `viewReqProps` 字面量：每条消息每次 ChatView render 都新建一次对象，9 处 `<ChatMessage {...viewReqProps}>` 各调一次 `_objectSpread2` helper，N 条消息每次 render 喂出 N 个临时对象 + 9N 次 spread，叠加 ChatMessage 内部多个 antd 组件的 cssinjs runtime spread，构成 GC scavenger 持续吃 CPU 的根因之一。

### 方案

`viewReqProps` 字面量删除，改为 `const hasViewRequest = reqIdx != null && onViewRequest;`。9 处 `{...viewReqProps}` 改成显式三 prop:

```jsx
requestIndex={hasViewRequest ? reqIdx : undefined}
onViewRequest={hasViewRequest ? onViewRequest : undefined}
isHistoryLog={isHistoryLog}
```

`ChatMessage.shouldComponentUpdate` L142-166 已逐字段比较这三个字段，prop 集合在 SCU 层面与原 spread 行为一字不差。`reqIdx==null` 时 `onViewRequest` 也传 `undefined`（与原 spread 缺字段时 `props.onViewRequest === undefined` 等价）。

### 后果

- 每次 ChatView render 减少 N 个 viewReqProps 字面量对象 + 9N 次 `_objectSpread2` 调用，长会话场景 GC 压力显著下降。
- plan / askUserQuestion 状态走独立 prop 通道（`askAnswerMap` / `planApprovalMap` / `lastPendingPlanId` / `lastPendingAskId` 等），不经 viewReqProps，本改动零影响。

---

## refactor(contexts): SettingsProvider class → 函数组件 + useMemo value

### 问题

`SettingsContext.Provider` 的 value 在 class 组件 `render()` 中每次都新建对象（`{ claudeSettings, preferences, _prefsReady, _claudeSettingsReady, updatePreferences, updateClaudeSettings }`），让 `static contextType = SettingsContext` 的所有 class 子组件（AppBase / AppHeader / ChatMessage）在 SettingsProvider 任何 setState 时都收到新引用，触发 SCU 浅比较代价。长会话里 ChatMessage 实例数高达数百，每次 preferences/claudeSettings patch 都让所有订阅者付一次比较。

### 方案

整文件重写为函数组件:

- `useState((initFn))` lazy 初始化器同步启动 fetch（不放在 useEffect 内，避免 useEffect 异步导致 `_prefsReady` Promise 在 AppBase.componentDidMount 时还未设置 → 拿到兜底空 Promise → 首屏 lang 闪屏）。`setLang` / `setClaudeConfigDir` 全局副作用紧随 fetch 回包，与原 constructor 行为等价。
- `updatePreferences` / `updateClaudeSettings` 用 `useCallback(deps=[])` 包裹。两者内部仅通过 setState 函数式更新 + fetch，无外部闭包依赖，所以 `deps=[]` 是安全的，引用全局稳定，等价原 class field arrow。
- `value` 用 `useMemo` 缓存，仅在 `claudeSettings` / `preferences` / `readyPromises` / 两个 callback 任一变化时重建。在常见的"AppHeader.setState 与 SettingsContext 无关"场景下 value 引用稳定，contextType 订阅者不会因 SettingsProvider 自身重渲触发不必要更新。
- `mountedRef` 替代 `_unmounted`，且**在 useEffect 入口重置 `mountedRef.current = true`**：防止 StrictMode/HMR 下 mount → cleanup(false) → remount 时 ref 对象被复用、`mountedRef.current` 永久卡 false 的退化（这种场景下后续所有 setState 都会被 mountedRef 拦截，state 永不更新）。

### 后果

- 外部 API 完全保留：`SettingsContext` 默认 value 不变 / Provider value shape 一字不变 / `static contextType` 消费方零改动。
- StrictMode 双调用：`useState` 初始化器只跑一次（React 保证），但 fetch 内的 `setLang` 副作用如开启 StrictMode 会跑两次（幂等，无功能影响）。`useEffect` 双调用经 mountedRef cleanup → reset 模式正常处理。

---

## refactor(appheader): 抽离 LiveTagPopover + inline style 缓存 + CSS 变量化

### 问题

`AppHeader.jsx` L1305-1346 的"实时上下文血条 Popover"在 AppHeader 每次 render 时都重建：`overlayInnerStyle={{ background, border, borderRadius, padding }}` 字面量、trigger span 的 `style={{ borderColor, color }}`、fill bar 的 `style={{ width, backgroundColor }}` 各自创建新对象。SSE live 模式下 `contextWindow` 高频 push 让 AppHeader 频繁重渲，这堆 inline 对象每次都新建，叠加 antd Popover 内部 cssinjs runtime 的 `_objectSpread2`，在 hover 路径上构成额外 GC 压力。`onOpenChange` 内还把 setState + `reloadFsSkills()` + `loadMemory()` 链式塞在一起，单次 hover 触发可能 3 次 commit。

### 方案

抽出 `src/components/LiveTagPopover.jsx` 为函数组件 + `React.memo()`:

- `overlayInnerStyle` 提到模块顶层 `const POPOVER_OVERLAY_STYLE`，所有实例共享同一引用。
- trigger span 用 CSS 变量 `style={{ '--ctx-color': ctxColor, '--ctx-percent': '${contextPercent}%' }}` + `useMemo` 缓存 triggerStyle 对象。配套修改 `AppHeader.module.css`：`.liveTag { border-color: var(--ctx-color); color: var(--ctx-color); }` 与 `.liveTagFill { width: var(--ctx-percent, 0); background-color: var(--ctx-color); }`。`.liveTagHistory`（local-log 模式）显式覆盖 border-color/color，与 var() 不冲突。
- `onOpenChange` 提取为 class field method `handleCachePopoverOpenChange`，引用稳定不会让 LiveTagPopover memo 失效。

保守化策略:`_cachePopoverOpen` / `_memory` state 留在 AppHeader 受控传给 LiveTagPopover。原因是 `_cachePopoverOpen` 在 `handleOpenSkillsModal` 里被跨组件 setState 强制关闭、`_memory` 在 workspace 切换（`componentDidUpdate` 内）时被 invalidate，搬到子组件会引入新的跨组件同步面，得不偿失。

### 后果

- AppHeader render 时 LiveTagPopover memo 浅比较：`contextPercent` / `ctxColor` / `projectName` / `isLocalLog` 等稳定值未变时跳过子树重渲。`requests` / `serverCachedContent` 引用每次变（SSE 期间）时仍会重渲，但开销跟原 inline 版本一样（不变差）。
- inline style 字面量从"每次 render 创建几个新对象"降到"模块加载时创建一次 + useMemo 引用稳定"。
- `onOpenChange` 仍在 AppHeader 内执行（保守化，未拆 useEffect），但提取为 class field 后引用稳定。

---

## fix(server/sse): /events 写 backpressure 等待消除监听器累积（MaxListenersExceededWarning）

### 问题

运行时反复看到：

```
MaxListenersExceededWarning: 11 close listeners added to [ServerResponse]
MaxListenersExceededWarning: 11 error listeners added to [ServerResponse]
```

`server.js` `/events` 处理在 `streamRawEntriesAsync` 回调里遇到 backpressure 时会 `await new Promise()` 等 drain，三个事件 `drain` / `close` / `error` 都用 `res.once()` 注册。`once` 只会自动摘除"实际触发的"那一个监听器；剩下两个一直挂在 `res` 上，加上常驻的 `removeFromClients` (`res.on('close')` + `res.on('error')`)，N 次 backpressure 后单事件名监听器数 ≥ 11，触发警告。timeout 路径更糟——三个监听器全部都不摘。

### 方案

新增 `lib/sse-backpressure.js#awaitDrainOrClose(res, timeoutMs)`，把 backpressure 等待收敛到一个 helper：

- 三个事件都用 `res.once()` 注册到同一个 `done` 闭包
- `done` 触发时 `clearTimeout` + `res.off('drain'|'close'|'error', done)` 主动摘掉另外两个未触发的监听器，再 `resolve()`
- timeout 也复用 `done`，路径一致

`server.js` 1013-1021 的内联实现整个被替换为单行 `await awaitDrainOrClose(res, SSE_BACKPRESSURE_TIMEOUT_MS)`。

### 后果

- 一次 backpressure 等待对 `res` 的净监听器增量 = 0（无论从 drain / close / error / timeout 哪条路径出来）
- 行为完全保留：四种 fulfill 来源任一发生即继续下一条写入，timeout 仍是 5s 兜底
- 新增 `test/events-backpressure.test.js#awaitDrainOrClose` 7 条单测，覆盖四种触发路径 + 20 次连续 backpressure + 20 次连续 timeout 不累积监听器 + 常驻 listener 与 helper 共存

---

## perf(interceptor): SSE 流式累积延迟物化（消除 V8 ConsString 多次 O(n) 拷贝）

### 问题

`interceptor.js` 在 SSE 流读取循环里用 `streamedContent += chunk` 把每个 chunk 追加到字符串。V8 在拼接长字符串时会构造 ConsString 树，但 `.length` / `.split` / `.slice` 等读取操作会触发 flatten，把整棵树拷成线性字符串——长会话单流 80+ MB 时这意味着每次 `streamedContent.length`（每个 chunk 都要算 `bigChunk` 阈值）都跑一次 O(n) 拷贝，最终累积成 O(n²)。

### 方案

`streamedChunks: string[]` 累积 + `streamedContentLen` 单独追踪长度；流结束时一次性 `streamedChunks.join('')` 物化为 `fullContent`，下游 `split('\n\n')` / 错误兜底 `slice(0, 1000)` 都用 `fullContent`。`bigChunk` 阈值改用 `streamedContentLen - liveLastFlushBytes`，热路径完全不读字符串。错误路径同步清空 `streamedChunks` 和 `streamedContentLen`。

### 后果

- 长会话单 SSE 流物化次数从 N（每 chunk）降到 1（流结束）；数十 MB 流的 CPU 时间显著下降。
- 行为不变：组装失败兜底仍是前 1000 字符，logging 字段保持原 schema。

## feat(chat): live 模式 compact 时间戳 + view-request 图标按钮

### 问题

实时 CLI / SDK 会话面板里，每条消息头都用 "MM-DD HH:MM:SS" + "查看请求" 文字按钮。一行宽信息密度低、视觉噪音大；同一天的会话根本不需要看到 `MM-DD`。但浏览本地历史日志（跨天回看）时仍需要日期段。

### 方案

- `ChatMessage` 新增 `isHistoryLog` prop。`formatTs` 在 `!showFullToolContent && !isHistoryLog` 时输出紧凑 `HH:MM:SS`，否则保留 `MM-DD HH:MM:SS`。
- `!showFullToolContent` 时把"查看请求"文字按钮替换为 12px SVG 图标（`.viewRequestIcon`），保留 `title` tooltip 与 hover 高亮。`AssistantLabel` 与 `renderViewRequestBtn` 两条路径都改。
- `ChatView` 新增 `_getIsHistoryLog()`（`!cliMode && !sdkMode`），在所有 `ChatMessage` / `TeamModal` 调用点统一注入；`TeamModal` 接收并透传给内部所有 ChatMessage。
- `shouldComponentUpdate` 加入 `isHistoryLog` 比较，prop 变化能触发重渲。

### 后果

- 实时 live 面板时间戳从 14 字符缩到 8 字符；图标按钮释放出"查看请求"4 个字的横向空间，长 label 不再换行。
- 历史日志面板（`ccv` 浏览旧 jsonl）行为完全不变。

## fix(server/sse): /events 默认窗口 + 全 SSE 写循环 backpressure

### 问题

长会话下 desktop bare `/events` 会把整段日志一次性流回浏览器（实测单流 23–86 MB），渲染进程 OOM 触发 Chrome "错误代码 5"——刷新即可继续 work，因为死的是浏览器 tab 而不是 cc-viewer 进程。同时 `lib/log-watcher.js` 的 `sendToClients` / `sendEventToClients` 与轮转处理器裸 `client.write` 都不看返回值，慢客户端撑大 Node 写缓冲、dead client 不出列，Node RSS 反复顶到 2 GB 量级、Socket 句柄长期高于 `sse+wss` 6–24 个。

### 方案

- **`/events` bare 请求**（无 `since`/`limit`/`cc`）默认套 `DEFAULT_EVENTS_LIMIT = 1000`，复用 `streamRawEntriesAsync` 已有的 checkpoint 对齐切片 + `load_start.{hasMore,oldestTs}`，前端"加载更早会话"按钮（`ChatView.jsx`）自动接管。显式 `?limit=0` 保留全量加载（power-user 逃生口）。
- **`lib/log-watcher.js`** `sendToClients` / `sendEventToClients` / 新 `sendChunkToClients` 走统一 `_safeSseWrite`：`destroyed` / `!writable` / `write` throw 立即剔除客户端；`write` 返 false 后超过 5 s 未 drain 也剔除并 `end()`；倒序 `for` 循环规避 splice 遍历问题。
- **轮转处理器** 3 处裸 `clients.forEach(client.write)` 改用 wrapper（`load_start` / `load_chunk` segment / `load_end`）。
- **`streamRawEntriesAsync`** Pass 2 单行 `await onRawEntry(raw)`（向后兼容同步 callback），让 `/events` 初始重放在写缓冲满时 await drain（5 s 超时 / close / error 任一 fulfill）。
- **`/events`** `req.on('close')` 之外增加 `res.on('close'|'error')` 兜底清理，保证幽灵 res 不残留在 `clients` 数组里。

### 后果

- desktop 长会话浏览器 renderer OOM 消除；socket 句柄数贴齐 `sse+wss`，不再持续超出 6–24 个。
- 已知 trade-off：desktop reconnect 后 `state.requests` 仅含最新 1000 条，老条目从内存清出，需手动点"加载更早"补齐——比直接 crash 强；mobile `?since=` 增量路径不受影响；`?limit=0` 仍可拿全量。
- `/api/requests` 多一个 microtask checkpoint per entry（`await onRawEntry` 副作用），实测开销可忽略；其裸 `res.write` 仍是 P1 backlog，下一波再处理。

### 测试

`test/events-backpressure.test.js`（新增）单文件覆盖：
- A 默认窗口：bare `/events` ≤ 1000 + `hasMore=true` + `oldestTs` 非空；`?limit=0` 全量；`?limit=300` 显式；`?since=...` 走 since 路径不被截断；事件顺序断言。
- B SSE 写：mock client write false 5 s 后被剔除；mock client write throw 立即剔除；mock client `destroyed=true` 立即剔除；mock client write false → drain 后 `_sseBackpressureSince` 重置；正常 client 不受影响。

## Unreleased — SettingsContext 重构（消除 `ccv-presets-changed` 双驱动）

### 问题

`/api/claude-settings` 与 `/api/preferences` 在 `AppBase` / `ChatView` / `TerminalPanel` / `AppHeader` / `PresetModal` / `ChatMessage` 各自 fetch；写后再用 `window.dispatchEvent('ccv-presets-changed')` 跨组件广播。结果是同一份状态既走 props/state 又走 window event，子组件双重订阅，session/workspace 切换时 listener 累积、回调互相打架，且没有 cleanup 路径——是潜在的浏览器侧句柄/闭包泄漏来源。

### 方案

用 `React.Context` 集中持有 `claudeSettings` / `preferences` 与 `updatePreferences` / `updateClaudeSettings` 两个 setter。子组件改为接 props（避免与 `TerminalWsContext` 的 `static contextType` 冲突），通过 `componentDidUpdate(prevProps.preferences !== this.props.preferences)` 接力 reload。删除所有 `ccv-presets-changed` 监听与 dispatch。

### 实现

- 新文件 `src/contexts/SettingsContext.jsx`：`SettingsProvider` 在 constructor 同步 fire 两个 fetch、暴露 `_prefsReady` / `_claudeSettingsReady` 给 `AppBase.componentDidMount` 等待；`updatePreferences` / `updateClaudeSettings` 乐观本地写 + POST，setState 引用变化驱动子树。`_unmounted` 守住 unmount 后的 setState。
- `src/main.jsx`：`<SettingsProvider>` 包裹 `<TerminalWsProvider>`。
- `src/App.jsx` / `src/AppBase.jsx`：AppBase `static contextType = SettingsContext`，原本散在 componentDidMount 里的两个 fetch 整体迁走；`_settingsProps()` helper 统一向下分发；`ccv-presets-changed` 全部删除（dispatch + listen 两侧）。AppBase.jsx 净 -25 行。
- `src/Mobile.jsx` / `src/components/AppHeader.jsx` / `src/components/PresetModal.jsx` / `src/components/ChatMessage.jsx`：fetch + window event 全部改为 `updateClaudeSettings(patch)` / `updatePreferences(patch)` 或 `this.context.update*`。
- `src/components/ChatView.jsx` / `src/components/TerminalPanel.jsx`：`_loadPresets` / `_loadPresetShortcuts` 改为读 props 而非 fetch，`componentDidUpdate` 守 `prevProps.preferences !== this.props.preferences` reference 比较，避免无限 loop。原 `addEventListener('ccv-presets-changed', ...)` 与 cleanup 删除。

### 后果

- 9 个前端文件，净 -25 行，少 1 条 window event 频道、少 6+ 处重复 fetch；
- 数据流单一（Provider state → props → componentDidUpdate），不再可能 props 驱动 + event 驱动双触发；
- 解决一类潜在 listener 泄漏（不显式 unmount 时 ccv-presets-changed handler 留在 window）。

## Unreleased — ExitPlanMode V2 input 服务端补全

### 问题

Claude Code 2.1.126 的 `ExitPlanModeV2Tool` 在 API 网线传输时把 `tool_use.input` 字段送成 `{}`。完整 plan 内容由 CC 客户端 `normalizeToolInput` 写入本地 session 转写文件 `<projectsDir>/<encoded-cwd>/<sessionId>.jsonl`。cc-viewer 读的是 HTTP 请求日志 `~/.claude/cc-viewer/cc-viewer/cc-viewer*.jsonl`，所以渲染 ExitPlanMode 卡片时 `ChatMessage.jsx:489-516` 的 5 条兜底链全部命中失败 → 待审批卡片正文为空。

### 方案

服务端在条目推给前端之前，按 `tool_use.id` 从 session 转写补全 `input.plan` / `input.planFilePath`。前端零改动，现有兜底链第 1、2 条会自然命中。

### 实现

- Feature (P0 — 新文件 `lib/session-transcript-reader.js`): `findTranscriptPath(sessionId, projectHint?)` + `lookupToolUseInput(sessionId, toolUseId, projectHint?)`。流式 1MB 分块读 + 行级 `indexOf('"name":"ExitPlanMode"')` + `indexOf(toolUseId)` 双子串预过滤后才 JSON.parse 单行。projectsDir 走 `findcc.getClaudeConfigDir()` 与 `CLAUDE_CONFIG_DIR` 重定向对齐。两层 LRU：路径 LRU(64)（带 mtime 校验，detect transcript 被覆写）+ input LRU(5000)。**仅缓存命中**；miss 路径用 30s TTL 短缓存兜住 race（CC 在 stream 关闭后才 flush 转写）。`MAX_TRANSCRIPT_BYTES=64MB` 防御异常文件。多匹配（worktree 同 sid）时按 `entry.project`（`basename(cwd)` sanitized）反向匹配编码目录尾段，仍多匹配取 mtime 最大者。
- Feature (P0 — 新文件 `lib/enrich-plan-input.js`): `enrichEntry(entry)` 遍历 `entry.response.body.content[]` 与 `entry.body.messages[*].content[]`，对 `name==='ExitPlanMode' && Object.keys(input).length === 0` 的块查 transcript 回填。`enrichRawIfNeeded(raw)` 用 raw 字符串 `indexOf('"name":"ExitPlanMode","input":{}')` 单子串预过滤（实测当前 CC interceptor 用 default `JSON.stringify(body)` 零空格、零换行，恒定字节序），命中才 parse + enrich + stringify。提供 `mainAgent === false` 早返回（sub-agent 不补；其转写在另一目录）。`x-claude-code-session-id` 缺失（旧版 CC）也早返回。In-place mutation by design：与 `lib/delta-reconstructor.js` 共享对象引用，让后续 entry 自动跳过重复查盘。
- Wire-in (P0 — `lib/log-watcher.js`): 实时 SSE watcher 在 `_reconstructor.reconstruct(parsed)` 之后、`sendToClients` 之前同步调 `enrichEntry`。同步开销由 transcript 64MB 上限 + miss 30s TTL + path mtime 多层兜住，最坏 ~150ms；如未来 hit 比例显著上升再考虑 `setImmediate` 拆分。
- Wire-in (P0 — `server.js` 三处 REST/SSE 端点): `/api/stream-log`（历史回放 SSE）、`/api/requests`（全量 dump）、`/api/entries/page`（移动端分页）出口前用 `enrichRawIfNeeded` 透明包装；不命中预过滤的条目按 raw 字符串透传，保留 `lib/log-stream.js` 的"零 parse / stringify"内存哲学。
- Test (P0 — 新文件 `test/session-transcript-reader.test.js` + `test/enrich-plan-input.test.js`): 41 用例。覆盖 worktree projectHint 反向匹配、mtime 失效重扫、跨 1MB chunk 边界、半写入末行 try/catch、miss TTL race-recovery、cross-session 同 toolUseId 不串号、sub-agent mainAgent guard、200 块大文件不 OOM、enrichRawIfNeeded raw 透传契约。

### 设计决策

- **边界放置**：inline egress enrichment 而非 `fs.watch` + 独立 SSE 事件——前端零改动 + tool_use.id 已在 wire 上同步可用；缺点是历史回放每次重扫，由 LRU + 文件大小上限 + miss TTL 兜住。
- **Pre-filter 策略**：单子串精确匹配 `'"name":"ExitPlanMode","input":{}'`（113MB 真实日志 14 次精确命中、零 false negative）。Schema drift 时 `enrichEntry` 内 `Object.keys(input).length === 0` 终判 + stderr 警告，不会误改其它工具或非空 input。
- **In-place mutation**：mutation 透传到所有共享对象引用，让重复 entry 中的同 tool_use 块自动跳过。注释解释依赖 `lib/delta-reconstructor.js` 的对象共享语义。

### 关于评审

实施前后两轮 5 人评审（架构师 / 防御性 / 代码质量 / 性能与安全 / 需求分析师 / 测试覆盖率）。本轮 P0 全采纳：projectsDir 接 `getClaudeConfigDir`、miss 30s TTL、文件改 kebab-case、bounded sync 加注释、history.md 更新；P2 采纳 mainAgent guard、path mtime 校验、64MB 文件大小保护、scanTranscriptFile / pickByMtime helper 抽出 + 死 import 删 + 测试名修正。P3 项（input cache key 加 hint、sessionId 正则、enrichRawIfNeeded 改名）入 backlog。

## 1.6.233 (2026-05-04) — header 血条 popover 抽组件 + iPad/手机 popover 接通 + 手机 chip tooltip 改 Modal + UltraPlan 模板瘦身 + memoryLinkParser 白名单

### header 血条 popover 抽出独立组件 + 三端入口

之前血条 popover 只在 PC AppHeader（hover 触发）。本轮抽出共享组件并接通 iPad / 手机两端，PC 行为不变。

- Refactor (P0 — 新文件 `src/components/CachePopoverContent.jsx` + `src/components/MemoryDetailModal.jsx`): 把 `AppHeader.jsx` 的 `renderCacheContentPopover()` 抽成纯展示函数组件 `<CachePopoverContent />`（接 `requests / serverCachedContent / contextPercent / fsSkills / memory / calibrationModel + onCalibrationModelChange / onOpenMemoryDetail / onOpenSkillsModal` props）；解析缓存（`_lastToolsRef / _lastParsedTools / _lastSkills / _lastChosenForSkills`）改 `useRef` 保持原 class 实例缓存语义；折叠状态用本地 `useState`。`renderMemoryDetailModal()` 抽到 `<MemoryDetailModal />`，AppHeader 与 Mobile 各 mount 一份避免持久记忆条目明细 Modal 在 mobile/iPad 不可达。`AppHeader.jsx` 删除 ~290 行 + 7 个仅模板内用的 import（`extractCachedContent / parseCachedTools / extractLoadedSkills / BUILTIN_SKILL_NAMES / mergeActiveSkills / Alert / renderMarkdown`）；`_lastContextPercent` 从子组件 render-side-effect 上提到父级 IIFE，保持原"只更新有效值"语义。
- Feature (P0 — `src/components/AppHeader.module.css`): `.cacheScrollArea` `max-height: 450px → calc(100vh - 140px)`；加 `-webkit-overflow-scrolling: touch + overscroll-behavior: contain`，让 PC 弹层接近视口高、iOS 抽屉里也用此组件时不弹性穿透。无 `!important`（项目硬性约束）。
- Feature (P0 — `src/Mobile.jsx`): iPad 路径（`isPad`）把血条用 antd `<Popover trigger={['click']} open={...}>` 包住（与 QR popover 同 pattern——iPad 触屏 hover/focus 不可靠，不混 `['click','hover']` 否则鼠标 iPad 会与 click-close 打架），content 是 `<CachePopoverContent />`；手机路径（`!isPad`）把 `mobileCtxTag` 升级为可点击 button（`role="button" / tabIndex / aria-label / onKeyDown` Enter+Space），onClick 切换 `mobileCachePanelVisible` 触发新 `mobileCachePanelOverlay` CSS 抽屉（沿用 `mobileGitDiffOverlay` 同 `transform: translateX(-100%) → 0` 模式 + zoom 0.6 / mobile-ios `scale(0.6)` / pad-mode zoom 1）。新增 `_fsSkills / _memory / _memoryDetail` state + `reloadFsSkills / loadMemory / loadMemoryDetail` 三 fetch 方法 + 三 seq 防 workspace 切换乱包污染（与 AppHeader 复制一份；`componentDidUpdate` projectName 变化时作废 + seq++）；`calibrationModel` 同样从 localStorage 引入，`<CachePopoverContent />` 受控 `onCalibrationModelChange`。`mobileContextPercent` 计算从 IIFE 上提到 render 顶部，避免 IIFE 副作用与下方 overlay 共享。**抽 `_closeAllMobileOverlays()` helper** 返回 10 个 mobile*Visible:false（包含新 `mobileCachePanelVisible`），把 9 处互斥 setState（构造器初始化 + `_handleMobileOpenFile` + 8 处 onClick）从 7-8 键散写改成 `{ ...this._closeAllMobileOverlays(), [thisOne]: ... }`，下次新增 overlay 改一处即可。
- i18n (P1 — `src/i18n.js`): 新增 `ui.openCachePanel`（aria-label）+ `ui.closeCachePanel`（关闭按钮 aria-label），各 18 locale。

### 手机 chip tooltip 偏移修复：改全屏 Modal（PC/iPad 不动）

之前手机抽屉里 MCP / Skill chip 的 hover 描述用 antd Popover，定位经过 `mobileCachePanelInner zoom: 0.6` 的 `getBoundingClientRect` 错位（截图反馈）。

- Fix (P0 — `src/components/CachePopoverContent.jsx`): 引入 `IS_MOBILE_PHONE = isMobile && !isPad`（模块级 const）。`renderMcpChip / renderSkillChip` 在手机分支改成 click 触发 `setChipModal({ title, description })`，组件末尾 mount `<Modal width="92vw" zIndex={1101} destroyOnClose>`——`zIndex 1101 > MemoryDetailModal 1100`，避免两 Modal 同层视觉未定义；Modal 通过 portal 挂到 `document.body` 逃出 zoom 容器，定位回正。PC / iPad 分支保留原 hover Popover（`trigger='hover' + mouseEnterDelay:0.2`）。chip 加 `role="button" / tabIndex / onKeyDown` Enter+Space 键盘可达。

### `parseMemoryLink` 白名单设计 + 黑白名单覆盖加固

将 CachePopoverContent 与 MemoryDetailModal 共用的链接拦截规则统一到 `src/utils/memoryLinkParser.js`，避免双份 paste 漂移。**Discriminated union 返回**（`{ open: name } | { allow: true } | { reject: true }`）让调用方编译期 catch 漏分支。

- Refactor (P0 — 新文件 `src/utils/memoryLinkParser.js` + 双方调用方简化): 16 行 paste 逻辑收到 5 行调用 `parseMemoryLink(href)`。
- Hardening (P0 — 5 路 review 命中 MED 安全 + P1 设计): 改成**白名单**——任何 scheme（不限于黑名单的 `javascript / data / file / vbscript / blob`）一律 reject，`chrome:` / `chrome-extension:` / `tel:` / `sms:` / `intent:` / `about:` / `ws:` / `MAILTO:`（大小写绕过尝试）/ 任意 `x-custom:` 协议都拦；只放行 `#anchor`（allow）和单段 `.md` basename（open）。`toLowerCase()` 前置防大小写绕过。文件头注释解释 discriminated union 选择理由。
- Test (P0 — 新文件 `test/memoryLinkParser.test.js`): 44 用例（happy path 6 + anchor 2 + dangerous schemes 含 mixed case 10 + 任意其它 scheme 13 + path traversal 6 + 非 .md / 空 / malformed 7）。

### UltraPlan codeExpert + researchExpert 模板瘦身

5-人 UltraReview 评估认为 codeExpert 改写从 37 行 → 52 行净优化 +0.4，但收益被字数稀释；按 4 项瘦身建议落地。researchExpert 也加 `AskUserQuestion` Pre-requisite。

- Refactor (P1 — `src/utils/ultraplanTemplates.js`): codeExpert：(1) 删 Step 3 二次 `AskUserQuestion`（与 Pre-requisite 合并），后续步骤 4-7 重编号为 3-6；(2) "spawn multiple review agents" → "spawn 2-3 review agents"（量化）；(3) "adopt P0 and high-priority P1 items" → "adopt P0 items, and selectively adopt P1 items when they are concrete and low-risk; defer P2/P3 to backlog"（操作指令更明确）；(4) UltraReview 启动前加 `git diff --quiet && git diff --cached --quiet` 判空跳过空 review；(5) 子目录 git 查找 prefer `git rev-parse --show-toplevel` fall back to recursive lookup（性能优于盲 find）。researchExpert：加 `Pre-requisite: Use AskUserQuestion to clarify the research scope, target audience, and deliverable format...`。
- Docs sync (P1 — 18 个 `concepts/<lang>/UltraPlan.md` + 2 个 `concepts/<lang>/CustomUltraplanExpert.md`): 每个 locale `<textarea>` 块同步成最新 codeExpert + researchExpert prompt 全文（英文，发到 LLM 的内容不需要本地化），16 个之前缺 Raw Templates 段的 locale 文件从 55 行补齐到 156 行。CustomUltraplanExpert.md 之前只有 en + zh，本轮**派 5 个并行翻译 subagent 按语言家族分批翻译** 16 个缺失 locale（保留 `<system-reminder>` xml 块 + Competitive Analyst 示例 code block 英文不译，技术术语 `TeamCreate / ExitPlanMode / webSearch / AskUserQuestion / [SCOPED INSTRUCTION]` 等保留英文，markdown 结构原位）。

### `presetShortcuts` builtin schema 清理

- Cleanup (P3 — `src/utils/builtinPresets.js`): 删除 `version` 字段。当前消费方（`PresetModal.jsx` / `ChatView.jsx` / `TerminalPanel.jsx`）从未读取 version——i18n key 在 `t()` 渲染时间接生效已经覆盖了"文案变更"自动同步到存量用户。如果未来真要做"server-driven 模板结构升级"（不只改文案），届时再实现 version-based update 机制（backlog）。

### Cross-cutting

- 5-人 `UltraReview` 团队（requirements / defensive / architect / quality / perf-security）跑两轮：第一轮抽组件 + 三端接通后采纳 P1 两条（memoryLinkParser + URI 加固）+ P2 1 条（删 version 死字段）；第二轮 chip Modal + 模板瘦身后再采纳 P1 两条（白名单升级 + zIndex 1100→1101）。
- `npm run build` ✓ + `npm run test` 1464/1464 ✓（+44 个 memoryLinkParser case）。

## 1.6.232 (2026-05-03) — terminal 写缓冲 O(n²) 修复 + 持久记忆 popover + cssVar 回退 / 热路径 Tooltip 原生化

### 性能优化（terminal 写缓冲 / cssVar 回退 / 热路径 Tooltip 原生化 / scrollHeight 缓存）

基于 5 路 reviewer 评估（保留：cssVar / 热路径 Tooltip 替换 / scrollHeight 缓存；否决：Typography ellipsis 整改、消息列表 React.memo 拆分），按 ROI 落 3 项独立可回滚优化。

- Perf (P0 — 新文件 `src/utils/terminalWriteQueue.js` + `src/components/TerminalPanel.jsx` + `src/components/ScratchTerminal.jsx`): xterm 写缓冲改造。trace3 显示 TerminalPanel `_flushWrite` 在 cc-viewer 自己代码中独占 794ms self（GC +56% / 主线程 idle 从 16% 崩到 0.5%）。根因：原 `_writeBuffer = _writeBuffer.slice(CHUNK_SIZE)` 每帧复制整段剩余 buffer，1MB /resume 场景 O(n²)。抽 `TerminalWriteQueue` utility（string[] queue + offset 指针 + 周期压缩），TerminalPanel 与 ScratchTerminal 共享。**节奏与原实现 100% 等价**（每帧 1 chunk ≤32KB，rAF 续约），只把字符串切片从 O(n²) 降到 O(n)。顺带修 3 个既有缺陷：(1) UTF-16 surrogate pair 在 32KB 边界硬切导致 emoji 显示成 �（cut 末位检测高代理优先回退、回退会变 0 时改前进 1 把整对带出）；(2) `terminal.write` 抛异常后 buf 已清的数据丢失（try/catch 内回滚 head/offset 并停续约 rAF 防死循环）；(3) unmount 时最后 16ms 数据丢（`drain()` 同步排空再 dispose）。**5 路独立 reviewer 评审**（行业调研 / 架构 / 风险 / 静态代码审查 / 行为差异）+ **2 轮回归 review**，砍掉了原方案里会引入新 bug 的 callback flow control / single-frame multi-chunk drain / MAX_BYTES_PER_FRAME（这三项会让 /resume 滚动从平滑变跳顿、tab 切回主线程暴吃 200ms）。新增 14 用例单测覆盖 surrogate 边界、回滚、drain、dispose 等所有边界。
- ~~Perf — `src/AppBase.jsx` cssVar:true~~ **已回退**：实测对比 trace 显示是性能**负优化**。开启后 cssinjs 自身耗时 +170%（608ms → 1643ms）、`flattenToken` +1426%（19.9ms → 303.4ms）、`Cache.value` +396%（100.8ms → 500ms）、GC +56%、主线程 idle 从 16% 崩到 0.5%、dropped frames +64%。原因：启用 cssVar 后每个 token 多走一层 `CSSVarRegister.path` + `flattenToken`；本项目 4 处 ConfigProvider + 主题切换 + 大量 antd 组件叠加，cache miss 路径被放大。antd 宣传的 20-35% 收益假设「单 ConfigProvider + 主题不切换」，本仓库不符合。getter 注释已更新警告未来不要再开。
- Perf (P0 — `src/components/TeamSessionPanel.jsx` + `src/components/RequestList.jsx`): 3 处热路径 `<Tooltip>` 替换为原生 `<span title="...">` —— gantt 段钻石（leadSegments 钻石 + agent 行事件钻石，每会话可渲 100+ 个）+ RequestList cache-loss dot（每请求一个）。trace 显示 `antd/es/tooltip/index.js:27` total 756ms，每个 Tooltip wrapper 即使 popup 不显示也跑 useToken/useStyleRegister/useZIndex/useMemo(getPlacements)/useComponentConfig 5 hook，列表 N 倍放大。原生 `title` 渲染零成本（浏览器自带 ~700ms hover 延迟，对探索性提示可接受）。RequestList 多 reason `\n` 改成「; 」分隔（原生 title 不支持跨行）；`tooltipPreLine` CSS 类一并删。冷路径 Tooltip（按钮单点说明、Modal 内 chip 等共 7 处）保留。
- Perf (P1 — `src/components/ChatView.jsx`): 加 `_followTarget` 实例字段缓存 `scrollHeight - clientHeight`。原 `_startSmoothStickyFollow` 的 rAF step 每帧读 3 次 layout（`scrollHeight + clientHeight + scrollTop`），加上前一帧写了 scrollTop 触发 forced reflow，trace 显示 56ms self / `get scrollHeight` 179ms self。改后：step 内仅读 `scrollTop`，target 在 `_startSmoothStickyFollow` 入口（双 rAF 等 layout 完成后）刷新；`_onStickyScroll` 也改用缓存 target（用户滚动不改 scrollHeight，缓存值有效）。新增 ResizeObserver 在容器尺寸变化（window resize / 容器缩放）时刷新 target，`_unbindStickyScroll` 同步释放 observer。流式 chunk 续约时自动重新进 `_startSmoothStickyFollow` → 重新刷 target，缓动逻辑无回退。预期热点 169ms（113+56） → <30ms，1947 次/25.5s 的 layout count 同步下降。

### 项目上下文 popover 新增「持久记忆」区块（解析 `~/.claude/projects/<encoded>/memory/MEMORY.md` 入口 + 链接打开明细）

- Feature (P0 — `server.js`): 新增 `GET /api/project-memory`（带可选 `?file=<basename>.md`）返回当前项目持久记忆。路径编码与 Claude Code 当前规范一致：`cwd.replace(/[/\\]+$/,'').replace(/[^a-zA-Z0-9-]/g,'-')`，落到 `~/.claude/projects/<encoded>/memory/MEMORY.md`。**已知不兼容**：早期 Claude Code 版本写入的目录保留了下划线（如 `-Users-sky--npm-global-lib-node_modules-cc-viewer`），与新规范全转 `-` 不一致；本端点只识别新规范目录，旧目录的 MEMORY 不会被读到（也无 fallback 重试，避免误命中）。安全分层：`?file=` 仅接受单段 basename + `.md` 后缀（拒绝 `/`、`\`、`..`、`.开头`、其它扩展名），`realpath` 收紧到 `realpathSync(memoryDir)+sep` 之内，再过一遍 `isReadAllowed`（`~/.claude/` 已在 allowlist）；512KB 大小上限。入口缺失返回 `{exists:false, dir, indexPath}`，前端拿 dir 做提示。
- Feature (P0 — `src/components/AppHeader.jsx`): popover 在 Skills 区块下方新增「持久记忆」加框区块。state 新增 `_memory: null|false|{...}` 与 `_memoryDetail`，沿用 `_fsSkills` 的 seq + projectName-change 失效模式。`onOpenChange(open=true)` 触发 `loadMemory()` 按需拉取；`renderMarkdown()` 复用 src/utils/markdown.js 的 marked + DOMPurify 管线渲染入口内容。点击事件代理拦截 `<a>`：拒绝任何 URI scheme（`/^[a-z][a-z0-9+.-]*:/i` —— `javascript:` / `data:` / `file:` 全拦），拒绝绝对路径与含路径分隔符 / `..` / 隐藏前缀的相对路径，仅对单段 `.md` basename 触发明细 Modal。Modal 用 `zIndex:1100` 跨过 popover 的 `1030`，`destroyOnClose` 防内容残留。
- Feature (P1 — `src/components/AppHeader.module.css`): 新增 `.memoryMarkdown` 内联渲染样式（段落 6px / 列表 padding-left 20px / 链接走 `--primary-color` + hover underline / code 走 `--bg-surface` 弱化），与 `.memoryStatus` / `.memoryDirHint` 三态文案样式。无 `!important`（项目硬性约束）。
- i18n (P1 — `src/i18n.js`): 新增 5 key × 18 语言 —— `ui.persistentMemory` / `ui.memoryLoading` / `ui.memoryLoadError` / `ui.memoryNotFound` / `ui.memoryEmpty`。
- Test (P1 — `test/api-project-memory.test.js`): 8 用例，`mkdtempSync` 隔离 `CLAUDE_CONFIG_DIR` + `CCV_PROJECT_DIR`，覆盖入口缺失/存在、明细文件读取、`?file=` 含 `/` `\` 非 `.md` 隐藏前缀的 400 拒绝、不存在的 404。

## 1.6.231 (2026-05-02) — AskUserQuestion 双行选项卡片重构 + iPad 全局审批 Modal 接通 + 加载更多历史失败兜底

### AskUserQuestion 选项卡片：双行版式 + 1.8× 大图标 + preview 自适应

- Refactor (P0 — `src/components/AskQuestionForm.jsx` + `src/components/ChatMessage.module.css`): 交互态选项行从单行 `dot + label — desc` 重排为 `dot + flex-column(label, desc)` 双行结构，避免窄屏拥挤；新增 `.askOptionBody / .askOptionLabel / .askOptionDesc` 三类（与已答态 `.optionDesc` 错开类名，dead code 一并删除）。`.askRadioDot` 桌面 23px / 移动 32px / pad-mode 23px，配 `inline-flex + align-items:center + height:17/22px` 行盒锁定与 label 第一行光学居中（解决 1.8× 后图标偏离基线问题）。`.askRadioItem` 加 `border-radius:6px + transition:background 0.12s`，hover 用 `--color-primary-bg-extra-faint`、selected 加 `--color-primary-bg-faint`，两态可叠加不互吃。
- Refactor (P1 — `src/components/ChatMessage.jsx` 已答态选项): 同步重构成 `<.askRadioDot>{checkSvg|○}</span><.askOptionBody><.askOptionLabel>{label}</span>{desc && <.askOptionDesc>{desc}</span>}</span>`；checkSvg 改 `width="1em" height="1em"` 跟 `.askRadioDot` 字号自适应，桌面 23px、移动 32px、pad-mode 23px 三档。`.askOptionItem` 改 `align-items:flex-start; gap:8px; padding:3px 0` 配合双行；`.askOptionSelected .optionDesc` 重命名为 `.askOptionSelected .askOptionDesc`。
- Feature (P1 — 无障碍): 选项 div 加 `role="radio"/"checkbox"` + `aria-checked` + `aria-label="{label}: {description}"` + `tabIndex={0}` + `onKeyDown` 处理 Enter/Space（`preventDefault` 防 Space 滚页）；`.askRadioGroup` 加 `role="radiogroup"`、`.askCheckboxGroup` 加 `role="group"`，符合 WAI-ARIA 自定义控件规范。`.askRadioItem:focus-visible` 主色 box-shadow outline，键盘可达。
- Feature (P1 — preview 重排): JSX 把 `header + question` 从 `optionsContent` 拆出当 `.askMarkdownLayout` 兄弟节点；`.askMarkdownLayout` 加 `min-width:0` + `.askOptionsBody` 包裹 options/otherInput；新增 `@media (max-width: 750px) { flex-direction: column-reverse; }` —— 桌面侧仍是 options-left / preview-right，≤750px 视觉顺序变成 `header → question → preview → options → submit`（DOM 顺序不变，screen reader 仍按 options→preview 念）。预览框加 `box-sizing: border-box` 修右侧 1px 边框 + 10px padding 导致的 `width:100%` 溢出。
- Fix (P1 — "Other" 输入框去蓝): `.askOtherInput :global(.ant-input) { background: var(--bg-elevated); }` 替换原 `var(--color-selection-bg)`（亮色主题下是浅蓝），`:focus / .ant-input-focused` 加主色边框 + `box-shadow: 0 0 0 2px var(--color-primary-bg-light)` 微光晕补偿失去的蓝底辨识度。
- Test: 两轮 UltraReview 团队审（requirements / regression / code-quality），第一轮 code-quality 提单行 label 纵向居中问题已通过行盒高度锁定修复；第二轮 3 视角全过。

### iPad 模式接通全局审批 Modal

- Feature (P0 — `src/Mobile.jsx` import + render wrap): Mobile.jsx 之前完全没用 `<ApprovalModal>` 包裹，iPad 模式下 AskUserQuestion / ExitPlanMode 永远走 inline 卡片，体验与 PC 不一致。新加 `import ApprovalModal from './components/ApprovalModal'`，render 顶部 `<TerminalWsProvider>` 内层包一层 `<ApprovalModal enabled={isPad && approvalPrefs.modalEnabled} ...>`。`enabled` 用 `isPad &&` 保证手机 mobile 永远关（保留 inline 路径），iPad 跟随用户偏好（默认 true，与 PC 一致）。AppBase 已有的 `approvalGlobal / approvalDismissedIds / approvalOtherTabs / approvalPrefs` 状态和 `handleApprovalDismiss / handleApprovalJumpTab` 方法 Mobile 直接继承，零新 state。
- Fix (P0 — `src/Mobile.jsx` ChatView 接 4 个 prop): 仅包 `<ApprovalModal>` 不够 —— Mobile 的 `<ChatView>` 之前只接 `onPendingPermission / onPendingPlanApproval`（inline 路径），没接 `onPendingAsk / onPendingPtyPlan`（modal 路径），导致 `approvalGlobal.ask` 永远 null、`visibleKinds=[]`、modal 永不渲染。新加 `onPendingAsk={this.handleApprovalAsk}` + `onPendingPtyPlan={this.handleApprovalPtyPlan}` + `ownTabId={this.state.ownTabId}` + `projectName={this.state.projectName}`（后两者用来填 modal header 的 chip + 跨 tab IPC 跳转）。`ApprovalPortalContext` 默认值 `{askSlot:null, ptyPlanSlot:null}` 保证手机 mobile 的 inline 路径零回归（ChatMessage Consumer 看到 null slot 直接走 inline）。
- Feature (P1 — `src/Mobile.jsx` 设置面板): mobile 设置抽屉新增 2 个开关，`{isPad && this.state.approvalPrefs && (...)}` 守卫，仅 iPad 显示——`ui.approval.settings.modalEnabled`（弹出全局审批 Modal）+ `ui.approval.settings.soundEnabled`（审批提示音）。复用 `handleApprovalPrefsChange` 走同一份 `/api/preferences` POST + `setApprovalPref` IPC，PC 与 iPad 共享一个状态源。i18n key 已存在（5367/5375），无需新增。

### loadMoreHistory：`before=null` 400 报错 + 失败 toast 兜底

- Fix (P0 — `src/AppBase.jsx:557+ loadMoreHistory()` 入口加 `_oldestTs` 防御 guard): `_hasMoreHistory=true` 但 `_oldestTs=null` 的不一致状态（SSE `load_start` 给 `hasMore: true` 同时 `oldestTs` 缺失/null 时触发）会让点击「加载更早的对话」拼出 `/api/entries/page?before=null&limit=100` —— `encodeURIComponent(null)` 返回字符串 `"null"`，server.js:1076 `new Date('null').getTime()` 得 NaN → 400 Bad Request。`loadMoreHistory()` 里在 `_loadingMore = true` 之前先 `if (!this._oldestTs) { setState({ hasMoreHistory: false }); return; }`，把按钮一次性藏掉避免上层 loader 反复触发同一个坏请求。
- Fix (P0 — 4 处 hasMoreHistory 写入与 oldestTs 联动): `:587 / :594`（loadMoreHistory 成功路径）改 `hasMoreHistory: !!data.hasMore && !!data.oldestTimestamp`；`:801 / :811`（SSE `load_done` 非增量分支）改 `newState.hasMoreHistory = !!this._hasMoreHistory && !!this._oldestTs`，与 `:401 / :410` 已有的稳妥写法对齐 —— `oldestTs` 缺失时一致地把"还有更多"翻成 false。`fetch` 后加 `if (!res.ok) throw new Error('HTTP ${res.status}')`，把 4xx/5xx（业务返回 JSON 但 status 非 2xx）统一翻成异常进 catch。
- Feature (P1 — 失败 toast `src/AppBase.jsx` + `src/i18n.js`): catch 块加 `message.error(t('ui.loadMoreHistoryFailed'))`，给用户明确的失败反馈。i18n 新增 `ui.loadMoreHistoryFailed` key 覆盖项目支持的全部 18 语言（中/英/繁中/韩/日/德/西/法/意/丹/波兰/俄/阿/挪/葡-巴/泰/土/乌克兰）。「点击像没点」的体感（spinner 50-100ms 闪一下、按钮没消失、无错误反馈）现在变成「按钮藏掉」或「toast 失败」二选一，确定可见。

## 1.6.230 (2026-05-02) — MdxEditor 工具栏 18 语言 i18n + Ctrl+S/Cmd+S 保存快捷键

### MdxEditor 工具栏 tooltip 18 语言全覆盖

- Feature (P0 — 新建 `src/i18n/mdxTranslations.js`，修改 `src/components/MdxEditorPanel.jsx`，删除 `src/i18n/mdxZh.js`): MdxEditor (1.6.213 引入) 工具栏 hover tooltip 之前只覆盖中文（`mdxZhTranslation` 仅 zh/zh-TW，其他 16 语言直接走 lib 默认英文 fallback）。把 mdxZh.js 重写为 mdxTranslations.js，结构改为 18 语言并列对象表，其中 zh/zh-TW 完整保留 dialog/menu/toolbar 翻译，ja/ko/de/es/fr/it/da/pl/ru/ar/no/pt-BR/th/tr/uk 等 15 语言新增 toolbar 段（25 个工具栏 key × 15 = ~375 条新翻译，按 GitHub/Notion/GitLab 行业通用译法）。`mdxTranslation(key, defaultValue, interpolations)` 派生函数走三层 fallback 链：全码 (zh-TW) → 首段 (zh) → defaultValue → key 本身；每次调用都 `getLang()`，配合 `<MDXEditor key={lang}>` 强制重挂载保证切语言时 toolbar tooltip 立即生效（lib 内部 `t()` 在 init 时一次性读取，无 subscribe 机制）。代价：切语言时编辑光标 + undo/redo history 丢失（用户切语言频率极低，`initialMarkdown` 回填保证内容不丢，可接受 trade-off）。

### MdxEditor 模式补 Ctrl+S/Cmd+S 保存快捷键

- Fix (P1 — `src/components/FileContentView.jsx`): CodeMirror 模式有 `keymap.of([{ key: 'Mod-s', run: ... }])`（L652-654）但 MdxEditor 富文本模式没有快捷键，按 Ctrl+S 走浏览器原生「另存为」对话框无法保存。加 `useEffect`，仅在 `useMdxEditor === true` 守卫下挂 document keydown 监听，匹配 `(metaKey||ctrlKey) && !shift && !alt && (s||S)` 时 `preventDefault()` + `saveRef.current?.()`。saveRef 已有 `isDirty` 守卫，不脏不发请求。CodeMirror 模式由 `useMdxEditor` 守卫排除，避免双触发。

- Test: 新增 `test/mdx-translations.test.js` 12 条单测（zh/en/ja/pt-BR/zh-TW 命中、未知 lang/key fallback、占位符 `{{shortcut}}` `{{level}}` 替换、既有 zh dialog key 保留、**17 语言核心 toolbar key 覆盖 sanity check** 防 typo / 漏粘贴、interpolate 双花括号优先单花括号兜底）。1393/1393 全绿；build 成功。

- Code Review: 4 视角并行（requirements / i18n quality / side-effect / regression-quality），结论 0 修订建议（唯一 D 级 RTL CSS 项被驳回——MdxEditor lib 自身不支持 RTL toolbar 布局，全局 `direction: rtl` 会翻转整个 UI 而非仅 tooltip，超本次范围）。

## 1.6.229 (2026-05-02) — ExitPlanMode/AskUserQuestion 卡片审批/答完不切状态修复（_sessionItemCache prop 刷新）

### 卡片状态卡 pending：cached React Element 持有过期 prop 引用

- Fix (P0 — `src/components/ChatView.jsx` + 新增 `src/utils/refreshPlanApprovalCache.js` / `src/utils/refreshAskAnswerCache.js`): ExitPlanMode 卡片用户审批后 / AskUserQuestion 答完后，UI 上卡片仍显示「等待审批」/「pending 表单」+ 三按钮 + 蓝虚线框，即使后续 assistant 已经在跑工具。根因：`_sessionItemCache` 失效条件只看 `msgsLen`，FULL HIT / INCREMENTAL 路径直接复用旧 React Element 数组，React reconciler 看到相同元素引用就跳过 diff，ChatMessage SCU 根本不被调用，元素创建时冻结的旧 `planApprovalMap` / `askAnswerMap` 引用永远不刷新。修复用两个对称 helper 仅 patch 持有 ExitPlanMode/AskUserQuestion tool_use 的 assistant element 的对应 prop（cloneElement，引用全等时零分配快路径），加 `_getMergedPlanApprovalMap(messages, keyPrefix)` / `_getMergedAskAnswerMap(messages, keyPrefix, localAsk)` 两个 per-keyPrefix 派生方法（main `s${si}` vs sub-agent `tm${si}`），保证 FULL HIT 与 cache miss 用同一引用做 prop diff。AskUserQuestion 还把 `localAskAnswers`（乐观更新）作为额外失效信号，用户答完到 server ack 之间 UI 不闪回 pending。被动修一个老 bug：旧 `_mergedAskAnswerMap` 当 localAsk 空时直接复用 `cached.askAnswerMap` raw 引用，新答案落盘后下游 SCU 检测不到变化 → 改为永远 spread 创建新引用。
- Fix (P1 — `ChatView.jsx:1481` LR 预判用 mergedAskAnswerMap 替代 raw cache): LR 是否持有 ask 交互权的预判块旧版直接读 `_toolCache.askAnswerMap`（不含 localAsk），用户快速答题、ack 还没到时预判会误认 LR 持有 ask，导致 messages-side 与 LR 同时 isInteractive，双 portal 进 ApprovalModal askSlot。改为读外层派生的 mergedAskAnswerMap（含 localAsk），预判与 L1675 实际判定同源。
- Fix (P2 — `ChatView.jsx:1383-1399` byKey 字典清理): 新加的 `_mergedPlanApprovalMapByKey` / `_mergedAskAnswerMapByKey` 等 7 个 by-keyPrefix 字典与 `_sessionItemCache` 同周期失效，但旧 `s${si}` keyPrefix 在 session 数收缩时永不删除。在 `_sessionItemCache.length` 同步逻辑后加显式清理（按 `idx >= mainAgentSessions.length` 删除）。tm${si} (sub-agent) 短周期 render 不在此处理。
- 这是 1.6.224 V2 文件型 plan + 1.6.226 lastPendingPlanId 算法重写的正交补全（V2 plan 让 `cached.planApprovalMap` 原地 mutate 引用稳定，但上游 ChatView `_sessionItemCache` 没跟上 prop 引用刷新），不涉及反向修改。
- Test: 新增 `test/refresh-plan-approval-cache.test.js` + `test/refresh-ask-answer-cache.test.js` 各 7 条用例（零分配快路径 / 无持有者保留原数组 / 单+多持有者 cloneElement / 非 assistant 排除 / 空数组 / 异常 element），1381/1381 全绿；build 成功。

## 1.6.228 (2026-05-02) — LAN 移动端访问 403 修复 + QR Popover 一点就关修复 + lastPendingPlanId 算法重写

### lastPendingPlanId 算法:历史 plan/ask 永远 pending 误弹

- Fix (P0 — `src/components/ChatView.jsx:991-1029`): 旧算法扫全量 messages,任何 `planApprovalMap[id]` undefined 或 status='pending' 的 ExitPlanMode 都视为 lastPendingPlanId。但 ExitPlanMode V2 / plan-mode 工具不写常规 tool_result 文本(后端用 system 注入接管),`planApprovalMap[id]` 永远 undefined → 历史里任何旧 plan 都无限弹 modal,刷新刷新都跳出来,用户根本没法跳过。改为反向扫到最后一条非空 assistant message,只在该 message 内查 ExitPlanMode/AskUserQuestion——plan/ask 一旦被处理,Claude 才能继续 turn,所以"对话能继续"等同于"先前的 plan/ask 必已被处理"。historyAskIds 收集仍需全量扫(给 Last Response 去重用),独立第一遍处理。同步 lastPendingAskId 也用同样语义。

### LAN 移动端访问 403 host-not-allowed

- Fix (P0 — `server.js:313-336` DNS rebinding 守护): 1.6.227 引入的 Host header 默认 allowlist `localhost,127.0.0.1,::1,[::1]` 把所有 LAN IP 都拦了。手机扫码访问 `http://192.168.x.x:7008?token=...` → 403 host-not-allowed。要求用户手动设 `CCV_ALLOWED_HOSTS` 环境变量与 cc-viewer "手机扫码编程" 核心场景冲突。改默认 allowlist 为 `[loopback四件套] ∪ getAllLocalIps()`(server.js 已有 helper,line 268-277);CCV_ALLOWED_HOSTS 显式设(包括 '*' 关闭防护)时仍完全沿用用户值,与 1.6.227 行为一致,向后兼容。token 仍是必需(server.js:300-310 ACCESS_TOKEN gate);DNS rebinding 攻击者需精确知道用户 LAN IP 才能利用,门槛降低但不增新攻击面;Vite/Cursor 同行也默认放开 LAN。

### QR Popover 一点就关:移动端 hover/focus trigger 不可靠

- Fix (P1 — `src/components/AppHeader.jsx:1531-1573` 二维码 Popover): trigger 原为 `['hover', 'focus']`。桌面 hover OK 但移动端 tap → focus → 立即又触发外部 click 关闭,扫码用户根本来不及对焦。改 `trigger={['click']}` + 受控 `open` state(`qrPopoverOpen`),popover content 最外层 div 加 `onClick={e => e.stopPropagation()}` 防内部点击(QR canvas/Input/Copy 图标)冒泡到外层 click 触发 onOpenChange(false)。桌面端单击打开/再单击或外部空白处关闭,与 hover 的 UX 差异低(QR 不是高频操作),但移动端稳定可扫。
- Fix (P1 — `src/components/CountryFlag.jsx:18-72` 国旗 Popover): UltraReview 发现同款 hover/focus trigger bug——footer 国旗 popover 在移动端 tap 即关,看不到 region/city/ISP/IP 信息。同款修法:`trigger={['click']}` + 受控 `popoverOpen` state + content `stopPropagation`。

## 1.6.227 (2026-05-01) — 单 ws 合并 ask 提交回归修复 + 统一文件访问策略 + DNS rebinding 守护

### 单 ws 合并 wsOpen 条件过严回归

- Fix (P0 — `src/App.jsx:305` / `src/Mobile.jsx:349` wsOpen 条件): 合并前 ChatView 的 `_inputWs` 始终连 ws,合并后 wsOpen 一度绑到 `cliMode || terminalVisible`。在 mobile 隐藏终端 / web-only 浏览 / terminalVisible toggle 切换间隙等场景下 Provider 不连 ws,hook bridge `_submitViaHookBridge` (行 2785) 与 PTY fallback `_submitViaSequentialQueue` (行 2702) 都拿到 `ctx.isOpen()=false`,后者触发 `_abortAskSubmitWithRollback('ws-not-open')` → "请求未送达,请重试" toast,消息根本没进 ws。改回退到「非本地日志 + 非 SDK 模式都连」,与合并前 _inputWs 永远连的语义对齐。
- Fix (P1 — `src/components/ChatView.jsx:2702-2745` `_submitViaSequentialQueue` send 守护): readyState 检查 (2704) 与实际 send (旧 2737) 之间存在 ws.onclose 触发的 race 窗口,旧代码不校验 `ctx.send()` 返回值且先挂 handler 再发,失败时孤儿 handler 等满 15s `_finishCurrentAskAnswer` 误标"已答"。改为先 send、send 返回 false 同步走 `_abortAskSubmitWithRollback('ws-send-failed')`,与 ws-not-open 同回滚路径,UX 一致;成功才挂 handler 避免孤儿。
- Fix (P1 — `src/components/ChatView.jsx:2575` 死代码 `this.connectInputWs()`): 方案 D 重构后该方法已删 (仅注释 line 68 提及),调用点遗留。一旦 PTY fallback 走到 `!ws || readyState !== OPEN` 分支即抛 `TypeError: this.connectInputWs is not a function`,无 try/catch 兜底崩 React handler。删该行,Provider `props.open=true` 时自管 2s 退避重连,`_waitForWsAndSubmit` 轮询到 OPEN 自然继续。
- Known issue (本次不修): `sdkMode` 下 wsOpen 仍为 false,但 server `sdk-ask-answer` 实际走 `/ws/terminal` (server.js:3533),SDK ask-submit 静默 no-op (ChatView.jsx:2510-2516 else 分支)。pre-existing latent bug,后续单独追查。
- Test: 新增 `test/single-ws-submit.test.js` 5 个 case (ws closed / send failed / send ok+matched done / wrong-seq done 不消费 / pty-prompt-invalid),inline-logic 抽取策略不引 ChatView/JSX/i18n 依赖。

### 统一文件访问策略:放开项目外文件读取 + DNS rebinding 守护

- Feature (P0 — 新增 `lib/file-access-policy.js`): 项目外文件(如 Read/Edit/Write 工具结果中的绝对路径 `/Users/x/another-project/foo.py`、`~/.claude/plans/*.md`、上传图片等)以前一律 400 `Invalid path`。引入统一 `isReadAllowed(absPath) → {ok, real?, reason?, allowedRoots?}`:① **Allowlist roots**(CCV_PROJECT_DIR、`~/.claude/`、tmpdir+`/tmp`/cc-viewer-uploads、`~/.claude/cc-viewer/`、注册的 workspaces、启动 cwd 快照),`realpath` 后 startsWith 比对;② **Denylist 后备**(`~/.ssh/`/`.aws/`/`.gnupg/`/`.docker/`/`.kube/`/`.netrc`/`.config/{gh,git,google-chrome}/`、`/etc/`、`/private/etc/`、Library/Keychains 等;文件名 `id_rsa`/`*.pem`/`*.key`/`.env`(放行 `.example`)/`credentials`/`*.tfstate` 等);③ **`~/.claude/` 子拦** `.credentials.json`/`settings.json`/`settings.local.json`(含 OAuth token,无项目内豁免);④ **项目内豁免**:CCV_PROJECT_DIR 内的 sensitive 文件名照常允许(`tests/fixtures/cert.pem` 等合法 fixture);⑤ 返回 `real` 路径,调用方用 real 读 → 杜绝 TOCTOU。
- Feature (P0 — `server.js` 三个端点委托 policy): `/api/plan-file` 保留 .md/2MB/null-byte/绝对路径 自身约束,realpath+allowlist 委托 policy(测试断言全部继续 pass);`/api/file-content` GET/POST 收敛 `editorSession=true` 后门,绝对路径全部走 policy;`/api/file-raw` 删除硬编码 uploadPrefix/persistPrefix 豁免(已纳入 allowlist),保留 MIME 校验/CSP/size。错误响应统一 `{error, reason, allowedRoots?}`,UI 据 reason 展示具体原因。
- Feature (P1 — `server.js:300-336` DNS rebinding Host 守护): 仅靠 token+loopback 不够(参考 CVE-2025-66414/66416 MCP DNS rebinding 类),浏览器恶意页面可借 DNS rebinding 把请求假冒成 localhost 抵达本地 ws/HTTP。新增一行 `Host` header 校验:默认 allowlist `localhost,127.0.0.1,::1,[::1]`,LAN 用户用 `CCV_ALLOWED_HOSTS=192.168.1.10,localhost` env 添加,`*` 显式关闭(用户自担风险)。静态资源与 OPTIONS 预检免校验。
- Refactor (P1 — `workspace-registry.js`): register/remove 后 lazy import `lib/file-access-policy.js#bumpWorkspacesVersion` 失效缓存,policy 的 allowlist roots 计算只发生在首次访问 + workspace 变更。避免循环依赖。
- UX (`src/components/FileContentView.jsx:559` / `src/components/ImageViewer.jsx:50`): 失败响应 `j.reason` 走新 i18n key `ui.fileLoadError.reason.<reason>`(zh/en/zh-TW/ko/ja/de/es/fr/it/da/pl/ru/ar/no/pt-BR/th/tr/uk 18 语言全译),用户能看到具体原因(`outside-allowlist` / `sensitive-prefix` / `sensitive-filename` / `sensitive-claude-config` / `realpath-failed` / `null-byte` / `invalid`)而非"Failed to load"。ImageViewer HEAD 失败时再发一次 GET 拿 reason JSON 显示。
- Test: 新增 `test/file-access-policy.test.js` 16 个 case(allowlist 命中 / 项目内豁免 / `~/.claude/` 子拦 / symlink denylist / outside / null-byte / invalid input / realpath-failed / TOCTOU 合同);保留并验证 `test/plan-file-api.test.js` 全部继续 pass。`npm run test` 1366 全绿。
- Known issue (本次不修): `~/.claude/projects/*.jsonl` 仍可读(用户日志,可能含敏感对话),设计上视为"用户自查内容"。如未来需要拦,可加 `~/.claude/projects/` 或 `*.jsonl` 子拦。

## 1.6.226 (2026-05-01) — 偏好开关响应修复 + 通知偏好 IPC 接通 + 单 ws 合并(方案 D)+ input-sequential 跨发送方 race 修复

### 修偏好面板三个 Switch 点击无响应

- Bug (`src/components/AppHeader.jsx:118-159` 白名单式 SCU): "弹出全局审批 Modal / 审批提示音 / 仅窗口失焦时通知" 三个 Switch 点击后 UI 不切换。根因是 `shouldComponentUpdate` 是手动维护的 props 白名单(覆盖 27 个字段),但 `approvalPrefs` 等 4 个 props **不在里面**——父级 setState → AppHeader 收到新 props → SCU 返回 false → 跳过渲染 → Switch checked 卡住。对比白名单内的 `resumeAutoChoice` (行 141)、`autoApproveSeconds` (行 143) 都正常工作。
- Fix: 白名单追加 4 行引用比较(approvalPrefs / approvalGlobal / approvalDismissedIds / approvalOwnPending);上方加 3 行注释提醒"render() 里读到的每个 props 必须在此列出"防止后续踩坑。这 4 个 state 的所有 setter 已用 immutable update 模式(`{...prev, ...patch}` / `new Set()`),引用比较稳定。
- 顺带修复同源 bug:`approvalGlobal/DismissedIds/OwnPending` 这三项在 bell badge / 跨 tab approval 路径上也会受 SCU 拦截而延迟更新——本次一并修复。

### `仅窗口失焦时通知` 偏好接通 electron 通知逻辑(原 P2 未实现项)

- 现状:`approvalPrefs.notifyOnlyWhenHidden` UI 开关存在但后端 `electron/main.js:211` 的 `maybeNotify()` 硬编码 `if (mainWindow.isFocused()) return`,**完全没读这个 pref**——用户关掉开关期望"窗口聚焦时也通知",实际行为不变。
- IPC 接通:`electron/main.js` 加全局 `_notifyOnlyWhenHidden`(默认 true,启动时同步从 `preferences.json` 读初值,消除 hydrate race window),加 `set-approval-pref` IPC handler(挂 `event.sender.isDestroyed()` 防御),`maybeNotify` 行 211 改为 `if (_notifyOnlyWhenHidden && ... isFocused()) return;`。
- Renderer → main 同步:`electron/tab-content-preload.js` 暴露 `tabBridge.setApprovalPref(prefs)`;`src/AppBase.jsx` 在 `handleApprovalPrefsChange`(用户切换)和 hydrate (`/api/preferences` 拉取)两处都调 `window.tabBridge?.setApprovalPref?.(next)` 推给 main。错误处理用 `console.warn` 而非吞错。
- Electron-only 显示:`仅窗口失焦时通知` Switch 包了 `typeof window !== 'undefined' && window.tabBridge` 守卫,纯 web/浏览器模式下不渲染该开关(因为它依赖 OS Notification + 窗口焦点判断,web 路径不存在)。

### 方案 D:把两条 `/ws/terminal` 长连接合并为单条(架构优化)

- 现状:DevTools Network 看到 chat view + cliMode=true 时两条 `/ws/terminal` 同时存活。第 1 条由 `ChatView._inputWs`(`connectInputWs()`)创建,主要消费 hook/SDK 类消息 + 发输入;第 2 条由 `TerminalPanel.this.ws`(`connectWebSocket()`)创建,消费 PTY data 渲染 xterm。服务端 `terminalWss` 把所有消息广播给两条 ws → `state/exit` 等元事件**双倍传输**。
- 架构:新建 `src/components/TerminalWsContext.jsx`(~150 行) — Provider 持单条 ws,内部封装 2s 重连 + handler 派发,暴露 `{ send, isOpen, addMessageHandler, addStateListener }`。`src/App.jsx` 和 `src/Mobile.jsx` 各包一次 Provider,`open` prop 由 `(cliMode || terminalVisible) && !sdkMode && !isLocalLog` 派生(main.jsx 互斥渲染保证两处不会同时实例化)。
- 兼容 stub:为避免改 75 处旧 send/readyState 调用,ChatView/TerminalPanel 内加 `_inputWs/this.ws` getter,返回 `{ readyState, send }` 轻量 stub 映射到 context API。这样所有 `this._inputWs.send(JSON.stringify(...))` 和 `this._inputWs.readyState === WebSocket.OPEN` 完全不动。
- Provider 自管 lifecycle:`componentDidUpdate` 根据 `open` prop 切换 connect/disconnect;onclose 后若 `open` 仍为 true 则 2s 后重连;handler 注册返回 unsub 函数,组件 unmount 时清理。
- server.js:回滚之前 P0 修复中的 `?role=` 过滤(单 ws 不需要 role 区分),保留 `activeWs` 抢占(跨设备 PC+Mobile 仍需要仲裁 resize)。
- ChatView/TerminalPanel `componentDidMount` 注册 `addMessageHandler` + `addStateListener`,卸载时 unsub。原 `connectInputWs/connectWebSocket/onclose 重连` 全部删除。`onopen` 替代:TerminalPanel 通过 `addStateListener('open')` 调 sendResize;首次 mount 若 ws 已 OPEN 则直接 sendResize 兜底。

### 修 `ChatView.jsx:2730` `ws.addEventListener` 不兼容 stub(实施过程中发现)

- 旧代码 `_submitViaSequentialQueue` 用 `ws.addEventListener('message', onMessage)` 注册临时 handler 等 `input-sequential-done`。stub 不暴露 `addEventListener`,直接调用会抛 TypeError。
- 改为 `ctx.addMessageHandler` 一次性注册 + 注销函数。同时把发送方式改为 `ctx.send(obj)`,不再走 stub。

### 修 `input-sequential-done` 跨发送方 race(side-effect 评审 ❌ 真问题)

- 现状:server.js 的 `ws.send(JSON.stringify({ type: 'input-sequential-done', ok }))` 是 unicast 给发送方 ws。合并 ws 后 ChatView(ask 提交)和 TerminalPanel(preset / `/clear-context` / UltraPlan)都通过同一 ws 发 `input-sequential` 请求 → server 不知道是谁发的,client 端无法区分自己的 done。ChatView 临时 handler 注册期间若 TerminalPanel 也发了一次,ChatView 会被 TerminalPanel 触发的 done 误判提前完成。
- Fix:client 发送时生成 unique seq(`cv-${Date.now()}-${Math.random().toString(36).slice(2,8)}`),server 透传到 done 回复(`if (seq !== undefined) reply.seq = seq;`),ChatView 临时 handler 严格按 `msg.seq === seq` 匹配。TerminalPanel 不传 seq(它不监听 done),server 也不回 seq,自然不影响 ChatView 匹配。15s setTimeout 兜底 unsub 不变。

### B' 修复:ChatView 重新接收 `data` 类型(深度 CR 暴露的隐性数据流断裂)

- 用户在 CR 阶段提示"两个接口之间是否还存在差异需要分开状态处理"。grep 后发现 `_appendPtyData(rawData) → _stripAnsi → _ptyBuffer → _detectPrompt() → setState(ptyPrompt)` 整条链上,`state.ptyPrompt` 被 5 处下游消费(`ChatView.jsx:969 / 1648 / 2143 / 2193 / 2711` — renderDangerApproval / SubAgent 兜底权限面板路由 / handlePlanFeedbackSubmit isDanger 检查 / `_submitViaSequentialQueue` 非 danger 类型自检)。
- 方案 D 第一版误把 `data` 分支当性能优化删除 → `_ptyBuffer` 永远为空 → `_detectPrompt` 解析不出 prompt → 所有 5 处下游静默失效。
- Fix(B'):在 `_onTerminalWsMessage` 加回 `if (msg.type === 'data') { this._appendPtyData(msg.data); }`,接受 ChatView 仍跑 `_stripAnsi/_detectPrompt` 的 CPU 开销(原本想砍的"性能收益"假设错了),保留方案 D 真正的收益:**网络架构合并**(同设备 1 条 ws 而非 2 条)、Provider 集中管理 lifecycle、`activeWs` 在合并 ws 上抑制频繁切换。
- 注释加详细说明为何不能省 `data` 分支,防止后续同样误判。

### server.js input-sequential-done 错误日志(P1 编码质量)

- 原 `try { ws.send(...) } catch {}` 吞错无诊断。
- 改 `catch (e) { console.warn('[server] input-sequential-done send failed:', e?.message || e); }` 便于 debug。

### 4 轮多视角 CR 全过 + 深度数据流复审

- 轮 1(IPC 接通):requirement / side-effect / regression / code-quality 4 视角并行,采纳 IPC catch console.warn + 来源校验 `event.sender.isDestroyed()` + main.js 启动同步读 prefs 消除 race window 三项 P1。
- 轮 2(方案 D 整体):requirement / side-effect-regression 两视角,❌ 真问题 1 个(input-sequential-done seq race)已修复。
- 轮 3(累计 9 文件 CR):4 视角全过,识别 1 个误判(regression-reviewer 的 seq 泄漏 + exit 格式化矛盾),发现 ChatView `_ptyBuffer` 死代码假设(实为隐性依赖),触发 B' 修复。
- 轮 4(深度数据流复审):dataflow-hunter / stub-compat-auditor / lifecycle-auditor / cross-component-state-auditor 4 视角,无新断裂。dataflow-hunter 标的 1 个 CRITICAL + 3 个 MEDIUM 经独立复核**全是误判**(spawnShell 状态广播是 pre-existing 行为非方案 D 引入;ChatView 不依赖 'state' 消息;同条 ws 时 activeWs 不会切换 — reviewer 误以为合并后还有跨发送方 ws 仲裁)。

- Test / Build: `npm run test` 1345/1345 全绿;`npm run build` ✓。

## 1.6.225 (2026-05-01) — Homebrew 分发渠道 + updater 检测 brew 安装跳过 npm 自更新

### 新增 Homebrew tap 分发，根治 nvm 用户切 Node 版本后 ccv "消失"问题

- Architecture (问题溯源): 现行 npm 全局安装在 nvm 环境下结构性脆弱——nvm 给每个 Node 版本独立 `lib/node_modules`，`nvm use <other>` 后 PATH 切到新版本 bin 目录，原 ccv 文件还在但**不在 PATH 上**。即便重装也只解当前版本，且 zsh hash 缓存、`process.execPath` 漂移、node-pty 跨 ABI、影子安装等 5 类失败叠加；shell 抛 `command not found` 时 ccv 根本来不及自检（诊断盲区）。Homebrew 装到 `<prefix>/Cellar/cc-viewer/` 完全脱离 nvm 的版本目录，wrapper 强绑 brew node 也绕开了 ABI 漂移。
- Feature (`lib/updater.js` 新增 `detectHomebrewInstall(dirOverride, realpathImpl)` 导出): 通过 realpath 解析 `/Cellar/cc-viewer/<version>/` 的标准 brew 布局，返回 brew prefix（`/opt/homebrew` / `/usr/local` / linuxbrew 自定义）。dirOverride/realpathImpl 双注入参数让单测完全绕开磁盘。校验 Cellar 后必须紧跟版本目录，避免误匹配用户路径中含 "Cellar" 字段的极端情况。
- Feature (`lib/updater.js` `checkAndUpdate` 新增 `brew_managed` 状态): 检测到 brew 安装时，在跨大版本检查之后、busy 检查之前短路 spawn 路径，改打印 `update.brewManaged` i18n 提示（"运行 brew upgrade cc-viewer"），返回 `{ status: 'brew_managed', currentVersion, remoteVersion, brewPrefix }`。**关键**：避免 npm install -g 写到 brew Cellar 之外的位置，导致 brew 与 npm 双安装并存（`brew uninstall` 后残留、`which -a ccv` 多份、版本号互相打架，与之前讨论过的"影子安装"是同一类故障）。`brewPrefix` 选项用 `hasOwnProperty` 判定让测试可以显式传 `null` 强制走 npm 路径。i18n key `update.brewManaged` 全 18 语言齐全。大版本提示分支（`major_available`）保持原行为不动，brew 用户看到提示后会自然走 brew upgrade。
- Architecture (`homebrew/Formula/cc-viewer.rb` 参考 formula): tap repo `weiesky/homebrew-cc-viewer` 用的标准 formula。`depends_on "node"`，`std_npm_install_args(libexec)` 处理 npm 安装。**关键**：不用 `bin.install_symlink` 让 npm 默认 shim（`#!/usr/bin/env node` 跟着 PATH 解析 node，nvm 切版本时拿到 nvm 的 node 而非 brew node，导致 node-pty native binding ABI 失配）；改自写 sh wrapper 显式调 `Formula["node"].opt_bin/node`，让 ccv 永远跑在安装时编译的 Node ABI 上。代价：brew node 大版本升级时（v22→v23）需 `brew reinstall cc-viewer` 重 build node-pty，由 brew 自动 revision bump 处理。test 块校验 `ccv -h` 与 `ccv --version` 退出码 0。
- Feature (`.github/workflows/bump-homebrew.yml` 自动 bump tap repo): 监听本 repo `release: published` 事件（由 release.yml 在 tag 推送后创建 GitHub Release 时触发），按版本号轮询 npm registry（最长 5min 等 CDN 传播），下载 tarball 算 sha256，跨 repo checkout `weiesky/homebrew-cc-viewer`，用 Python 严格 regex 替换 formula 的 url 与 sha256（不动 install/test 块），通过 `peter-evans/create-pull-request` 开 PR。manual `workflow_dispatch` 输入也支持，方便补救/dry-run。版本号严格 semver patch 校验防注入。需要在本 repo Settings 加 `HOMEBREW_TAP_TOKEN` secret（fine-grained PAT 或 GitHub App，作用域 `Contents: Read+Write` + `PRs: Read+Write` on tap repo）。
- Docs (`homebrew/README.md`): 维护者一次性配置说明（建 tap repo / copy formula / 算首次 sha256 / 配 secret）+ 末端用户 install/upgrade 命令 + wrapper 设计 rationale。
- Docs (`README.md` 主文 + `docs/README.{ar,da,de,es,fr,it,ja,ko,no,pl,pt-BR,ru,th,tr,uk,zh,zh-TW}.md` 全 18 语言): 在 `npm install` 章节后追加 "Install via Homebrew" 子章节，解释 nvm 痛点 + brew 三行命令 + 自更新会自动识别。各语言独立翻译，关键术语（Homebrew、tap、nvm）保留英文。
- Tests (`test/updater.test.js` 新增 16 个 case): `detectHomebrewInstall` 12 个（Apple Silicon / Intel / linuxbrew / npm-global / nvm / system /usr/local / Cellar 但非 cc-viewer / 缺版本子目录 / dev clone 含 Cellar/cc-viewer/lib 路径 / Time Machine backup 非 version 段 / symlink 跟随 / realpath 抛出 fallback）；`checkAndUpdate — brew_managed` 4 个（brew 同大版本不 spawn / brew 大版本仍走 major_available / brew 无升级仍 latest / brewPrefix=null 显式走 npm 路径）。47/47 全过。
- 4 视角 UltraReview 采纳要点（requirements / side-effect / regression / correctness 并行评审）：
  - **P1 修订（4 项）**：① side-effect 命中 `server.js:3769` SSE banner 不广播 `brew_managed`，brew 用户在 Electron / GUI 模式下看不到提示，仅 stderr 一行——把 `brew_managed` 加入条件，payload 增加 `source` 字段供前端区分；② regression 命中 `lib/updater.js:142` `hasOwnProperty` 让 `{ brewPrefix: undefined }` 误被当显式传值，改用 `!== undefined`，防止未来 caller 用 spread+override 模式误绕过自动检测；③ correctness 命中 `detectHomebrewInstall` regex `[^/]+/` 太松，dev clone 在 `/Users/x/projects/Cellar/cc-viewer/lib/...` 工作时会被误判为 brew 安装而跳过自更新——收紧为 `\d[\w.\-+]*/` 要求版本号样式（数字开头），顺带覆盖 Time Machine backups 误命中场景；④ side-effect 命中 `.github/workflows/bump-homebrew.yml` `${{ inputs.version }}` 在 semver 校验前已被注入到 shell 行（标准 GitHub Actions injection antipattern）——把所有用户/外部输入改用 `env:` 块隔离（INPUT_VERSION / RELEASE_TAG / EVENT_NAME / VER / URL / SHA），shell 通过环境变量引用而非表达式插值。
  - **P3 顺手**：formula 注释 `std_npm_args` → `std_npm_install_args`（与代码实际调用一致）。
  - **未采纳**：P2 wrapper sh script quoting（brew 自身拒绝带空格的 prefix，理论问题）；P3 env-disabled brew users 无升级提示（与 `disabled` 状态语义一致，刻意行为）；P3 cache 共享在 brew/npm 双安装场景（最坏 4h 延迟，无数据破坏）；P2 `peter-evans/create-pull-request@v6` 升 v7（v6 仍维护中）；P2 macOS HFS+ 大小写不敏感（brew 始终用 `Cellar` 大写，理论风险）。
- Test / Build: `npm run test` 1345/1345 全绿；`npm run build` ✓。

### 第二轮 4 视角 UltraReview（独立复核）采纳 P1 + P3 注释

- **P1 修订（多视角一致命中）**: side-effect-auditor + regression-hunter 同时指出 `lib/updater.js` 中 `major_available` 分支早于 `brewPrefix` 检查——brew 用户跨大版本会被 i18n `update.majorAvailable` 文案（"npm i -g cc-viewer@latest"）引导跑 npm，**触发想杜绝的双渠道污染**。把 `brewPrefix` 短路前移到 major 检查之前，brew 用户跨大版本统一走 `brew_managed`（`brew upgrade cc-viewer` 跨大版本同样能用，文案不需特化）。同步翻转 `test/updater.test.js` 中 `major bump on brew install` case：原断言 `major_available`（旧顺序），改为断言 `brew_managed` + `spawnCalled === false`，反向锁定 brew 优先级。47/47 全过。
- **P3 注释 × 2**: ① `detectHomebrewInstall` regex 上方加 head 守卫文档——cc-viewer formula 当前无 `head do` block，但若未来加，需把 regex 放宽为 `/^(?:\d[\w.\-+]*|HEAD-[\w.\-+]+)\//`，否则 HEAD 用户被静默路由到 npm 分支；② `saveCheckTime()` 上方说明 4h 节流故意覆盖 brew_managed banner 频率，避免刷屏（stderr 是侧通道）。
- **未采纳**：① P2 删除 `server.js` SSE payload 的 `source: result.status` 字段——确认前端 `src/AppBase.jsx:694-700` 仅读 `data.version` 不分流，技术上是 dead code，但后续如要让 banner 按 source 切 i18n key（"npm i -g..." vs "brew upgrade..."）就用得上，留着不破坏任何功能；② P2 brew_managed 用更短 cache 提速 banner——4h 节流即原意；③ P3 Cellar 大小写假设/Windows 路径正规化/formula assert_match 文档化——理论风险或已自证，No-op。
- Test / Build: `npm run test` 全绿；`npm run build` ✓。

## 1.6.224 (2026-04-30) — 全局审批 Modal + ExitPlanMode V2 文件型 plan + LR/messages 双卡去重 + 5 视角 Code Review P0/P1 修订

### 5 视角 Code Review 后采纳 P0+P1 修订：bell 持久重开 / plan-file LAN token / null-byte 防御 / ownPending 信息流

- Architecture (UltraReview 团队 5 视角 Code Review 后采纳 4 项最直接的功能闭环 + 安全缺口): requirements-checker / side-effect-auditor / regression-hunter / code-quality-auditor / integration-verifier 并行评估当前 git diff（ApprovalModal 全局 UI + ExitPlanMode V2 plan + LR/messages 双卡去重三个 feature 1229 行插入）。team-lead 复核报告剔除两条误报（"SDK ask portal 违反 inline-only"、"CDU pendingPtyPlan 死循环"——前者 ApprovalModal:44-45 注释明确只声明 Permission 与 SDK ExitPlanMode inline-only，SDK ask 走 modal 是设计意图；后者 `else if (curPtyPlan)` 守卫已正确，setState(null) 后 curPtyPlan=null 不再进入），剩余按 P0/P1/P2/P3 分级，本轮采纳 P0 + P1 共 4 项。
- Fix (P0 — `src/AppBase.jsx` `onApprovalBroadcast` 不消费 `payload.ownPending`): 之前 handler 仅写 `ownTabId` / `approvalOtherTabs`，丢弃 main 进程聚合的 `ownPending: { ask, ptyPlan }`。新增 `state.approvalOwnPending: { ask: 0, ptyPlan: 0 }` 仅取计数（不重写 `approvalGlobal`——其内含的 questions / handlers 闭包无法跨 IPC 序列化，权威源仍是 ChatView 的 pendingAsk / pendingPtyPlan，WS 重连服务端会重放）。给下游 bell badge 用，不破坏现有数据流。
- Fix (P1 — `src/components/AppHeader.jsx` 持久 bell 重开按钮): 原诉求明确要求"通过持久 chip 重新唤起" minimised modal，但 `handleApprovalReopen`（AppBase:1437）虽已实现却没接入 AppHeader——用户 ESC/点遮罩后无任何手动唤起入口。新增 `<button className={styles.approvalBell}>` 在 headerRightRow 首位渲染（仅当 `dismissedActive > 0` 或 `localEmpty + ownPending > 0` 时显示），点击调 `onApprovalReopen()` 清 `approvalDismissedIds`，ApprovalModal `visibleKinds` 重新命中重弹。`dismissedActive` 取 ag.{kind}.{kind}.id 与 dismissedIds Set 交集，`orphanCount` 处理 WS 丢状态边缘（local approvalGlobal 空但 main 端 ownPending 非空时给 informational badge）。bell 用 `var(--color-warning)` 黄色 + 红色 badge 角标；CSS 与现有 `.qrcodeIcon` 同手法（30px 尺寸、focus-visible outline）。i18n `ui.approval.bell.reopen` / `ui.approval.bell.orphan` 18 语言齐全。
- Fix (P1 — `src/components/ChatView.jsx:364` /api/plan-file fetch 走 `apiUrl()` wrapper): 之前 `fetch(\`/api/plan-file?path=\${...}\`)` 直接拼路径，缺 token 注入。LAN 模式下 server.js:300-310 的 ACCESS_TOKEN gate 会把请求 403 拦下。改为 `fetch(apiUrl(\`/api/plan-file?path=\${...}\`))`，与同文件 line 298 / 301 / 306 等其他 /api/* 调用对齐（apiUrl 已 imported 在 line 32）。
- Fix (P1 — `server.js:/api/plan-file` null-byte 注入显式拒绝): `parsedUrl.searchParams.get('path')` 会将 `%00` 解码为 `\x00`，`path.resolve('\x00...')` 在 Linux 不抛 → 仅靠后续 `startsWith` 副作用兜底。在 `if (!raw)` 之后立即加 `if (raw.indexOf('\\x00') !== -1) return 400 'invalid path (null byte)'`，杜绝隐蔽路径。`test/plan-file-api.test.js` 同步加 case，1328 → 1329 全过。
- 未本轮采纳的项目（待用户后续指示）：P1 broadcastWsMessage `ask-hook-resolved` 双触发幂等 / Mobile `suppressInlineApprovalPanels` 不完整 / `_resolvedPlanIds` lpid A→null→A 守卫；P2 ToolApprovalPanel SDK 接 planFileContents / notifyOnlyWhenHidden 透传 main / notifiedKeys 上限 / planFileContents 失败重试 / promptClassifier 误判反例 / _isFlashing 多窗口 / broadcastApproval debounce / hook bridge ws 失败 abort / historyAskIds 单次构建复用；P3 AudioContext close / textarea 暂态 / preload cleanup / 测试覆盖补全 / 注释行号清理。
- Test / Build: `npm run test` 1329/1329 全绿；`npm run build` ✓。

### Last Response 与 messages-side 双卡去重：multi-agent-room 场景下 ApprovalModal 不再 portal 错那张空白卡

- Fix (multi-agent-room 中 ApprovalModal 显示空白 AskQuestionForm，但 chat 内联 Last Response 同时间戳处又有完整问卷): 用户报告并附两张截图——image-1777537803993.png 显示 chat 区**同时间戳**两张并列卡片：上方 messages-side 一张「需要回答」蓝色虚线交互式表单（**正文为空，仅"提交"按钮**），下方 `Last Response` 分隔条下同款表单但**正文完整**（标题"采纳方向" + 4 个 radio 选项）；image-1777537758183.png 显示全局审批 Modal 把上方那张**空白**表单 portal 进来，用户无法在 Modal 里看到问题与选项、无法回答。
- Architecture (`src/components/ChatView.jsx` 在 `mainAgentSessions.forEach` 内新增「LR 是否将持有交互权」预判): 现有去重逻辑只单向（如果 messages 已含 toolId，LR 不再渲染该 ask；line 1493–1502, 1512, 1558），**反向缺失**——当 LR 即将渲染一个 pending ask（或 ExitPlanMode），messages 端**仍然**会让对应卡片 `isInteractive=true` 双重渲染表单，两份 AskQuestionForm 都对 ApprovalPortalContext 做 portal 决策，Modal 收到双 portal、显示其中一张（恰好是空白那张）。预判块在 sessionPlanApprovalMap 之后、cache 命中分支之前计算 `lrWillOwnAsk` / `lrWillOwnPlan`，与 line 1483–1530 LR 实际判定**完全同源**（hasInteractiveBlock / hasSuggestionMode / shouldHide / cliMode 守卫）。
- Architecture (`React.cloneElement` 剥夺 messages-side 交互权): 预判命中后，遍历 `msgs` 把 `lastPendingAskId === lastPendingAskId` / `lastPendingPlanId === lastPendingPlanId` 的 ChatMessage 元素用 `cloneElement(..., { lastPendingAskId: null })` / `lastPendingPlanId: null` 重建，让其降级成静态展示（已答 / 已审批样式），保证唯一交互点是 LR `<ChatMessage key="resp-asst">`。同时清空 `_sessionItemCache[si].lastPendingAskId` / `lastPendingPlanId` 防止下游 buildLpid / 增量 cache 误用。手法与现有 line 1395–1428 的"streaming 同 toolId 多 message owner-idx 迁移"模式一致。
- Architecture (lrContent 过滤补 ExitPlanMode 历史去重): line 1557–1559 的 `lrContent` 之前对 `b.name === 'ExitPlanMode'` **无条件包含**，与 AskUserQuestion 的 `historyAskIds.has(b.id)` 去重不对等——同 toolId 在 messages + LR 的 ExitPlanMode 会重复渲染。改为 `(b.name === 'ExitPlanMode' && !(lrHistoryPlanIds && lrHistoryPlanIds.has(b.id)))`，与 AskUserQuestion 一向去重对等。
- 关键守卫 (review 修订采纳): ① `lrWillOwnPlan` 加 `cliMode` 守卫——ChatMessage:472 `isInteractive = isPending && this.props.cliMode && tu.id === lastPendingPlanId`，非 cliMode 下剥夺 messages 端会导致两边都不可交互，必须只在 cliMode 时剥夺；② `_shouldHide` 显式短路（与 line 1489 同源）——LR 整体被隐藏时无重复风险，不进剥夺；③ `_hasInteractiveBlock` 短路——LR 内无 AskUserQuestion / ExitPlanMode 时直接跳过预判，省去重复扫描 session.messages。
- Tests (`test/lr-messages-dedup.test.js`，9 个 case): 覆盖 ① LR 不同 toolId 的 ask 持权剥夺；② 同 toolId 走 historyAskIds 去重不持权；③ 已应答 ask 不持权；④ pending ExitPlanMode + cliMode 持权；⑤ pending ExitPlanMode + 非 cliMode **不**持权（关键 review 守卫）；⑥ 同 toolId ExitPlanMode lrContent 过滤掉（修复点）；⑦ 无 interactive 时不剥夺；⑧ shouldHide 时不剥夺；⑨ 非最后 session 跳过预判。1319 → 1328 全过。
- UltraReview 团队评审采纳要点：① side-effect P1 — cloneElement in-place 修改 `msgs` 数组会污染 `_sessionItemCache[si].items`（因 `items: msgs` 共享引用），下一轮 LR 不持权时 messages-side 永远恢复不了 interactive。改为 `msgs.map` 派生新数组，`cache.items` 保持原始 raw 状态。② correctness P2 — 预判内 `this._mergedAskAnswerMap` 在 cache 命中分支下 stale（renderSessionMessages 不调用 → mergedAskAnswerMap 缓存条件未变 → 旧值），改为直接从 `getToolResultCache(session.messages).askAnswerMap` 内联取（与 LR 实际判定 line 1515 同源；transient mis-display 一帧内可接受）。requirements 100% 实现度，3 个守卫到位。
- Test / Build: `npm run test` 1328/1328 全绿；`npm run build` ✓。

### 适配 Claude Code 2.x ExitPlanMode V2 文件型 plan：multi-agent-room 等场景的「计划审批」Modal 不再空白

- Fix (用户截图 "multi-agent-room" 中「计划审批」Modal 仅显示三个按钮、无 plan 正文): 用户反馈"经常看到计划审批的时候只有审批，没有计划"。深挖 jsonl 真实数据：所有近期 ExitPlanMode tool_use 的 `input` 中已直接携带 `plan` (1.5k–27k 字符) + `planFilePath` 两字段——这是 Claude Code 2.x 的 `ExitPlanModeV2Tool` 行为，CC 内部 `normalizeToolInput()` 从磁盘 `~/.claude/plans/{slug}.md` 注入并直接序列化进 JSONL，**不再依赖前置 Write/Edit 工具**。但 cc-viewer 渲染层只追踪 Write/Edit 到 `.claude/plans/`、解析 `## Approved Plan:` tool_result 区块、扫描 ExitPlanMode 之前的 text blocks——**完全不读 `inp.plan` / `inp.planFilePath`**。multi-agent-room 等无 Write 前置的场景下三级 fallback 全空 → 截图所见空白。
- Architecture (`src/utils/toolResultBuilder.js` 新增 V2 抓取 + 守卫式重置): ① `createEmptyToolState()` 增字段 `latestPlanFilePath: null`；② tool_use 分支识别 `ExitPlanMode` 后，`input.plan` 非空时覆写 `state.latestPlanContent`，`input.planFilePath` 非空时记入 `state.latestPlanFilePath`；③ tool_result 路径完成后将原本无脑的 `state.latestPlanContent = null` 改为守卫式——仅当 V1 路径（无 V2 内联 plan 且无 latestPlanFilePath）才清；周期末统一重置 latestPlanFilePath 防跨周期串扰。
- Architecture (`src/components/ChatMessage.jsx` 扩展 plan 正文 5 级优先级链): pending 分支：① `inp.plan`（V2 注入，最高优先）→ ② `inp.planFilePath` 异步缓存 → ③ `latestPlanContent` → ④ 同 response Write → ⑤ 前序 text 块。已批准分支：`approval.planContent` 缺失时回退 `inp.plan` / 异步缓存兜底（防 V2 tool_result 不含 `## Approved Plan:` 区块的极端情况）。
- Architecture (`src/components/ChatView.jsx` 异步读盘协调): 新增 `state.planFileContents: { [planFilePath]: content }`、`_planFileFetches: Set` 去重、`_unmounted` 守卫。componentDidUpdate 加 `prevProps.messages !== this.props.messages` 门槛，仅引用变化时遍历扫描所有 ExitPlanMode tool_use 的 `planFilePath`，按需 `fetch('/api/plan-file?path=...')` 拉取磁盘内容入 cache。三处 `<ChatMessage ... latestPlanContent=... />` 调用点（line 1109/1116/1577 区域）同时透传 `planFileContents`。
- Architecture (`src/components/ToolApprovalPanel.jsx` 修复 SDK 路径): SDK ExitPlanMode 弹层之前走 default 分支 → `JSON.stringify(toolInput).slice(0,500)` 把整个 plan 当 JSON 字符串截到 500 字（更糟糕的展示）。新增显式 `case 'ExitPlanMode'`：优先 `toolInput.plan` 正文，回退 `(plan @ planFilePath)` 引用占位，再回退 description。Mobile.jsx 复用 ToolApprovalPanel，同步受惠。
- Architecture (`server.js` 新增 `/api/plan-file` 只读端点): 严格白名单——仅允许读 `~/.claude/plans/` 下 `.md` 文件，`fs.realpathSync` 双向校验防符号链接逃逸（即使 plansDir 内放符号链接指向 `/etc/passwd` 也拒绝），Windows 路径分隔符 + 大小写不敏感比对，`fs.statSync` 先验体积 ≤ 2MB 防 OOM，自动继承 server.js:300-310 的 ACCESS_TOKEN 校验。
- Tests: `test/plan-v2-extract.test.js` 6 个 case（input.plan 抓取 / V1 路径不被覆盖 / V2 覆盖前序 Write / 审批后无条件重置 / V1 正常清空 / 字符串 input fallback）；`test/plan-file-api.test.js` 8 个 case（缺 path / 非 .md / 相对路径拒绝 / 路径越界 / 文件存在 / 文件不存在 / 符号链接逃逸 / 体积超限）。共新增 14 个 case。
- UltraReview 团队评审采纳要点：① side-effect P2 — `latestPlanContent` 守卫式清理简化为审批完成无条件清，已审批卡片由 ChatMessage 的 `inp.plan` 兜底链承担（去掉 V2 inline 守卫分支，逻辑更简单且无跨周期串扰风险）；② correctness P3 — `/api/plan-file` 端点增加「拒绝相对路径」防御层（前端 SDK 永远发绝对 planFilePath，相对路径直接 400）。requirements 复核 100% 实现度，所有 6 个正确性维度通过。
- Test / Build: `npm run test` 1319/1319 全绿；`npm run build` ✓。

## 1.6.223 (2026-04-29) — sessionMerge 内容感知合并：根治 Plan Mode 上下文压缩窗口下 ExitPlanMode plan 内容丢失 + UltraReview P2 采纳

- Fix (对话视图：某些 ExitPlanMode 卡片只显示审批按钮、没有 plan 内容): 用户报告 09:45:57 这条 ExitPlanMode 没展示 plan 详情。深挖 jsonl 真实数据后定位**双层根因**——根因不在 ChatMessage 渲染层，而在 `src/utils/sessionMerge.js` 的 `mergeMainAgentSessions` 对 Plan Mode 上下文压缩场景误判：① CLI 在 ExitPlanMode 审批前后会以 [latest assistant, latest tool_result] 两条 sliding window 连续发请求（不再传累积历史），相邻两个 entry 的 `body.messages` 长度相同但内容完全不同；原代码在 `newLen===currentLen` 分支盲目"不动 messages（认为是 response-only 流式更新）"，**整段 [ExitPlanMode tool_use, tool_result] 被丢弃** → `buildToolResultMap` 的 `parsePlanApproval` 没机会跑 → `planApprovalMap[id]` 默认 pending → ChatMessage line 499 approved 分支不命中、3 级 fallback 全空 → 只剩审批按钮。② 同分支 `newLen<currentLen` 在 CLI 把累积历史压缩成"只发末尾 N 条作 context"时，盲目 checkpoint 重建把累积几百条历史抹掉。
- Architecture (新增 `messageFingerprint(msg)` helper + 重写两个分支): 用 `tool_use.id` / `tool_result.tool_use_id`（Anthropic API 强保证唯一）作内容主键，text / thinking 取前 64 字符兜底，**不做 deep-equal**（成本低、足以撑起 sessionMerge 判定路径）。`newLen===currentLen` 改造为内容感知：末尾 fp 相同 → 同 entry 流式更新，保持 messages 引用稳定（原行为）；末尾 fp 不同 → CLI 上下文重置后的新对话片段，先做 prefix overlap 检测（防御性，CLI 偶发可能发送"前 K 条与末尾重叠 + 后 newLen-K 条新增"的窗口），再 push `newMessages[overlap..]`，根治丢失。`newLen<currentLen` 改造为子集判定：newMessages 是 lastSession.messages 末尾连续子集 → 保留累积历史（CLI 压缩窗口）；不匹配 → 走原 checkpoint 重建（/compact 等真 case 行为不变）。**真正的 /clear 在 line 37 `isPostClearCheckpoint` 提前命中走新 session 分支，不会进新逻辑**。
- Fix (UltraReview P2 — `newLen===currentLen` append 缺前缀去重): side-effect-reviewer + correctness-reviewer 同时命中。push 整段 newMessages 在 CLI 偶发"前缀重叠"窗口下会重复消息。修复：用 fp 比对找最长前缀重叠 K（maxOv = min(newLen-1, currentLen)，末尾 fp 已确定不同，至少 push 1 条），只 push `newMessages[K..]`。Append 防御层补齐。
- Tests: `test/incremental-merge.test.js` 新增 5 个 case：① newLen===currentLen 内容不同时 append 整段；② newLen===currentLen 内容相同时引用稳定（流式回归）；③ newLen===currentLen prefix overlap 时只 push 不重叠部分；④ newLen<currentLen 是末尾子集时保留历史；⑤ newLen<currentLen 真 /compact 时重建。1298 → 1303 全过。
- 4-teammate UltraReview 团队评审（requirements / side-effect / regression / correctness）+ 采纳 P2: requirements 100% 实现度（5 决策 + 7 项技术清单全过、回滚干净）；side-effect 命中 P2（append 过激缺前缀去重）+ P1（WeakMap 缓存语义变化但 `appendToolResultMap` 兼容、无需改）+ P3（**核验后误读**：jsonl 由 CLI 写、cc-viewer 只读，所谓"session 文件膨胀"不存在）；regression 五大路径（incremental push / response-only / /clear / /compact / streaming）零回归；correctness 命中 P2（prefix overlap 同上）+ P1（建议 export `messageFingerprint`，**不采纳**：YAGNI）+ P2（子集判定依赖 CLI"末尾"契约，**核验后判低风险不采纳**：CLI 不可能跳过末尾对话步骤）。team-lead 综合后采纳 P2 prefix overlap，落地 ~10 行 + 1 测试 case。
- Fix (回滚上一轮未采纳的 ChatMessage.jsx / .module.css / src/i18n.js 临时补丁): 上一轮在错误前提下加的 `inp.plan` fallback、`.planContentEmpty` 占位文案、`ui.planEmptyContent` 18 语言 i18n key 全部 `git checkout HEAD --` 撤销。根因修了之后渲染层不需要任何改动，3 级现有 fallback（latestPlanContent → 同 message Write → 前置 text 块）+ approved 分支（`approval.status === 'approved' && approval.planContent`）配合 `parsePlanApproval` 已能正确渲染。
- Test / Build: `npm run test` 1303/1303 全绿；`npm run build` ✓。

## 1.6.222 (2026-04-28) — assistant 消息时间戳旁显示 [X.XK] 上下文 token 总量 + UltraReview P1/P2 采纳

- Feature (对话视图：开启"完整展示所有内容"开关后，每条 assistant 消息时间戳旁显示 `[X.XK]` 浅灰色小标记，内容是该条消息对应 API 请求的 `cache_read_input_tokens + cache_creation_input_tokens` 之和，K 单位): 用户场景是快速识别每轮请求的上下文规模、定位上下文增长来源、辅助判断 cache 命中。覆盖 4 个 assistant 渲染入口（主干 `renderAssistantMessage`、SubAgent `renderSubAgentChatMessage` 内联头部、Last Response、Teammate fallback）。鼠标悬停显示 tooltip "上下文大小：X.XK tokens（cache_read + cache_creation）"，覆盖 18 种语言。0 / streaming 中 / usage 未到也显示 "0K"（用户决策），不隐藏。仅当 `showFullToolContent` 开关为 true 时显示。
- Architecture (`ChatView._reqScanCache.requestCacheTokenMap: Map<reqIdx, number>`): 在已有 `tsToIndex` 增量扫描循环里 O(n) 一次性预计算每个 request 的 cache token 总和（response.body.usage 到达时 set；缺失时 delete 旧值避免 stale）。三处 reset 点（ctor / componentDidUpdate session 变更 / requests 变更）同步重置；与 `tsToIndex` 同生命周期，无独立 GC 路径。下游 `renderSessionMessages` 函数签名追加 `requestCacheTokenMap` 参数，3 个调用点（buildAllItems 增量、buildAllItems 全量、`_buildTeammateFallbackItems`）已对齐。SubAgent / Last Response 在 ChatView 同级独立查表后传入。
- CSS (`ChatMessage.module.css` 新增 `.cacheContextText`): `font-size:10px; color: var(--text-gray-light, #b0b0b0); flex-shrink:0; opacity:0.75; font-variant-numeric: tabular-nums`。在 `.timeText` 同容器里加 `flex-shrink:0` 防换行；`tabular-nums` 让多条消息纵向数字宽度对齐。**严守 CLAUDE.md：无 `!important`**。
- Fix (UltraReview P1 — user 消息也通过 `viewReqProps` 接到 `cacheTotalTokens`，导致 streaming 期间 SCU 浅比较虚假触发 user 消息重渲): side-effect-reviewer 命中。最初实现把 `cacheTotalTokens` 放进 `viewReqProps` 然后 spread 到所有 `<ChatMessage>`（含 user），SCU 已对 `cacheTotalTokens` 比较 → user 消息每次 cache 值变化（streaming 完成 0→真值）都会重渲虽然 `renderUserMessage` 不读它。修复：把 `cacheTotalTokens` 从 `viewReqProps` 抽出，**只在主干两处 `<ChatMessage role="assistant">` 单独传 prop**；`viewReqProps` 恢复成原始 `{ requestIndex, onViewRequest } | EMPTY_OBJ`。
- Fix (UltraReview P2 — `formatCacheK` 缺 NaN/非数字防御): correctness-reviewer 命中。当前数据流 `(usage.x || 0) + (usage.y || 0)` 已保证是 number，但极端情况（API 字段类型异常）下 `formatCacheK(NaN)` 会输出 "NaNK"。函数顶部加 `if (!Number.isFinite(n)) return ''`。
- Architecture (UltraReview 团队评审 — 4 个 reviewer 视角并行): requirements-reviewer 100% 实现度（5 决策 + 7 项技术清单全过）；side-effect-reviewer 命中 P1（user 消息虚假重渲）+ P2（viewReqProps 引用稳定性，pre-existing 模式不引入新风险，降级 P3）；regression-reviewer 命中 TeamSessionPanel `<ChatMessage>` 4 处不传 `cacheTotalTokens`（**核验后降级 P3**：TeamModal 函数签名根本不接收 `showFullToolContent`，是 pre-existing 限制，不算本次回归）；correctness-reviewer P1 "SCU 漏 `showFullToolContent`" **核验后判定误报**（line 123 已有比较）+ P2 NaN 防御 + P3 命名风格（合理无需改）。team-lead 综合后采纳 P1+P2，6 行改动落地；P3 项（TeamModal badge 扩展、viewReqProps 缓存、命名）后续再说。
- ChatMessage SCU 字段补 `cacheTotalTokens` 比较: streaming 完成时 cache 值会从 0 → 真值变化但 `requestIndex` 不变，原 SCU 不含此字段会让真值更新被 memo bail-out 拦截（reviewer 一开始建议"无需加"，但实际数据流证明必须加）。
- i18n (`src/i18n.js` 新增 `ui.cacheContextTooltip`): 18 种语言（zh/en/zh-TW/ko/ja/de/es/fr/it/da/pl/ru/ar/no/pt-BR/th/tr/uk）齐全，使用 `{{value}}` 占位符。**仅在前端 `src/i18n.js` 加，根目录 `i18n.js` 服务端不需要**（CLAUDE.md 双 i18n 规则）。
- Test / Build: `npm run test` 1298/1298 全绿；`npm run build` ✓。

## 1.6.221 (2026-04-28) — 主/小 terminal 双双引入 .terminalHost / .scratchHost 包装层根治 xterm 渲染溢出

- Fix (主 terminal `.terminalContainer` xterm 渲染高度与可见区差几像素 — 临界 height 下 xterm-screen 接触 toolbar 边线): 1.6.220 已经把 `.terminalContainer` 改 content-box + flex `min-height:0` 链路，但 fitAddon 用 `parseInt(getComputedStyle(parent).height)` 的几像素余数 (cellHeight × rows ≠ content area 整数倍) 在 resize 抖动里仍会让 xterm-screen 物理上贴到 `.terminalContainer` content-box 底，焦点 inset box-shadow 4px 出血带不足以兜住。**改造为 wrapper-host 双层结构**：① JSX 在 `.terminalContainer` 内多套一层 `<div ref={containerRef} className={styles.terminalHost} />`，xterm `terminal.open()` 接的是新内层；② CSS `.terminalContainer` 加 `display: flex; flex-direction: column`，新增 `.terminalHost { flex:1; min-height:0; margin-bottom:4px; overflow:hidden }`。fitAddon 通过 `getComputedStyle(terminal.element.parentElement).height` 读到的就是 `.terminalHost` 的高度 (margin 不计入自身 height)，比 `.terminalContainer` 内容区天然少 4px —— xterm rows × cellHeight 永远 ≤ 这个保守值，cellHeight 余数 + ResizeObserver 间隙抖动都被 4px margin buffer 兜住，xterm-screen 物理上不可能接触下方 toolbar 边线。所有 `containerRef.current.querySelector('.xterm-*')` 调用 (focus / cursor / viewport / scrollbar 等) 因 xterm 仍是 containerRef 直系后代，descendant selector 全部生效，无回归。
- Fix (scratch (小) terminal `.scratchInner` 同款 wrapper-host 改造): 之前依赖 `border:4px transparent + box-sizing:content-box` 让 fitAddon 自动减掉 border 像素带；但 antd v5 的 reset 通过 `:where(.css-...).ant-layout` 等 0-specificity 规则给所有元素注入 `box-sizing: border-box`，覆盖项目代码默认值，导致 fitAddon 的 `parseInt(getComputedStyle().height)` 在某些主题/Layout 上下文里读到的是 border-box 高度 (含 padding+border)，xterm rows 多算 1~2 行 → xterm-screen 504×195 类的视觉溢出 (用户实测多次反馈)。同款 wrapper-host 修法：① ScratchTerminal.jsx render 多套一层 `<div ref={containerRef} className={styles.scratchHost} />`；② CSS `.scratchInner` 加 `display: flex; flex-direction: column`，移除 `padding:8px`，新增 `.scratchHost { flex:1; min-height:0; margin-bottom:4px; overflow:hidden }`。`.scratchHost` 自身无 padding/border，box-sizing 在它身上无效果，fitAddon 读到的就是真实可见高度 -4px buffer，**绕开 antd `:where()` 注入的全局 box-sizing 影响**。focus 出血带仍由外层 `.scratchInner` 的 `border:4px transparent` 承担 (focused 时 `.scratchPanesFocused .scratchPane.scratchPaneActive .scratchInner` 切主题色)，链路不变。
- Hygiene (主/小 terminal 文件级与 CSS 块级归属注释): 排查过程中多次混淆"主 terminal"和"scratch (小) terminal"，给两侧都加了显式归属标记防再次踩坑：① `TerminalPanel.jsx` 文件头 + render() 主 xterm 块上方注 "主 terminal (Claude Code TUI 渲染区)" 并提示 scratch 在 ScratchTerminal.jsx；② `ScratchTerminal.jsx` 文件头 + render() 注 "scratch (小) terminal" 并提示主 terminal 在 TerminalPanel.jsx；③ CSS `.terminalContainer` / `.terminalHost` 块上方加 "归属 TerminalPanel.jsx" + 反向类名提示，`.scratchInner` / `.scratchHost` 同款标注。下次按 grep `.terminalHost` / `.scratchHost` 即可立即定位是哪一组结构，不再误改。
- Test / Build: `npm run test` 1298/1298 全绿；`npm run build` ✓。

## 1.6.220 (2026-04-28) — Electron tab 栏 60px 圆角矩形 + 打包黑屏修复 + 主 TerminalPanel 高度溢出/focus 边线根治

- Feature (Electron tab 栏高度 36→60px + 圆角矩形 tab): 用户反馈 36px tab 栏与下方"当前项目"胶囊视觉权重不匹配。`electron/main.js` 的 `TAB_BAR_HEIGHT` 常量 36→60，`updateLayout()` 通过 `setBounds` 自动给 `tabBarView` / `workspaceView` / 各 `tab.view` 重新分配；新增 `trafficLightPosition: { x: 16, y: 22 }` 让 macOS 红黄绿按钮在 60px 高度下垂直接近居中。`electron/tab-bar.html` 同步：body 60px、`.tab-container` 加 `gap: 4px; padding: 8px 0`、`.tab` 改为 `height: 44px; border-radius: 12px` 并移除 `border-right` 分隔线、`.tab.active` 用 `box-shadow: inset 0 0 0 2px var(--accent)` + 背景色双重视觉指示替代原 `::after` 底部 2px accent 线（圆角矩形 + 底线视觉冲突），`transition` 加 `box-shadow 0.1s` 防 active 切换闪烁。
- Fix (Electron .app 打包后主 TerminalPanel 黑屏 — terminal 没有正常启动 claude code): `ps` 验证 claude 进程能正常起来（PID Ss+ 在 PTY 中等待输入），但前端 xterm 全程黑屏。从 `[CC Viewer] Failed to setup terminal WebSocket: Cannot find module '.../app/scratch-pty-manager.js' imported from .../app/server.js` 定位真因 —— `electron-builder.yml` 的 `files` 列表漏了 `scratch-pty-manager.js`（package.json `files` 里有，但 electron-builder 配置另起一份未同步）。server.js 启动时 import scratch-pty-manager 失败 → wss.on('upgrade') 路由没注册 → 前端 ws connect 失败 → xterm 全程黑屏。修复：electron-builder.yml `files` 追加 `scratch-pty-manager.js` 与 `plugins/**/*`（plugins 源目录目前为空，但保留同步避免下次新增 hook 又漏）。**这是双 manifest 文件失同步的典型，下一轮 P3 建议补 CI 校验。**
- Fix (worker 启动时序竞争 — claude TUI 初帧丢失): 原 `tab-worker.js` 顺序：`startViewer() → send 'ready' → main.js loadURL → React 加载 ws connect → spawnClaude`。临界场景下 ws connect 时 claude 还没 spawn 完，server.js:3279 的 `getOutputBuffer()` 返回空，`onPtyData` listener 注册后 claude 才输出 alternate-screen 序列；listener 收到的数据流缺少初始 alternate-screen 切换序列（\x1b[?1049h 等），xterm 渲染状态不一致。改成 `spawnClaude → 等首条 PTY 数据 / 600ms 超时 → send 'ready'`，让 BrowserView 加载页面前 outputBuffer 已含完整 TUI；ws connect 时第一段 `data` 消息直接送完整 alternate-screen。新增 `CLAUDE_STARTUP_TIMEOUT_MS = 600` 常量（claude TUI 启动通常 200-400ms 出首帧，600ms 留余量）。
- Fix (worker spawnClaude 失败仍 send ready 的回归 bug — Code Review P0): catch 块原本在 send 'pty-error' 后**继续执行末尾的 send 'ready'**，前端激活一个无 PTY 的 tab → 看似可用但黑屏。catch 末尾加 `return`，让 main.js 的 30s timeout 自动标 tab error 状态，用户看到明确 "error" 而非沉默黑屏。
- Fix (server.js wss 兜底重绘 — 前端 ws 首次 resize 与 PTY 默认 size 相同时 noop 不发 SIGWINCH 致 claude 不重绘): claude 是 alternate-screen TUI，重绘依赖 SIGWINCH。前端 fitAddon 算出的 cols/rows 若与 PTY 当前 size 完全相同，`pty.resize` 内部 noop 不触发 SIGWINCH → claude 不重绘 → 前端拿不到 TUI 内容。`wss.on('connection')` 在 `state.running` 时设 `_needRedrawBootstrap = true` 标记，本 ws 收到首次 resize 消息时（由 fitAddon 触发的真实尺寸到达），通过 `process.kill(getClaudePid(), 'SIGWINCH')` 给 claude 进程发一次 SIGWINCH 信号让其重绘整屏 —— **首版误用 `(rows+1)→(rows)` 抖动 resize 触发 SIGWINCH，claude 接两次 resize 各重绘一次产生 50-100ms 闪烁；改成单次 `process.kill` 后无尺寸抖动、单次重绘干净** (Code Review P1#3 采纳)。
- Fix (主 TerminalPanel 在特定窗口高度下溢出 / focus 边线被遮 — web/Electron 双端共有): 用户报告"特定高度上 terminal 高度溢出，盖住 focus 的边线"。经多 agent 调研（FitAddon 源码、xterm GitHub issues #1283/#5298/#1136、项目代码 trace）定位**双层根因**：① fitAddon 用 `parseInt(getComputedStyle(parent).height)` 读容器高度，`box-sizing: border-box` 模式下该值含 padding，fitAddon 内部减的是 xterm.element 自己的 padding(=0)，结果**多算了 padding/cellHeight 行**，临界 height 下 `rows × cellHeight > content area` 触发 xterm 子元素溢出（业界共识：fitAddon 父容器必须 content-box）；② `.terminalContainer` 用 `outline + outline-offset:-4px` 画 focus 边框，outline 属于元素自身装饰，stacking 顺序在 children 之下，xterm 内部 absolute 子元素（`.xterm-decoration-container`、`.xterm-helpers`）能盖住 outline。修复：`.terminalContainer` 移除 `box-sizing: border-box`（默认 content-box，fitAddon 计算正确），`outline` 整体改用 `box-shadow: inset 0 0 0 4px ...`（box-shadow stacking 高于 children 不会被遮）；light 主题加 `0 0 6px rgba(217, 119, 87, 0.08)` 外发光保持 dark/light 视觉对称。同时给 flex 链中所有列方向中间容器加 `min-height: 0`（`.terminalPanelWrap`/`.terminalPanel`/`.terminalContainer`），并给 wrap 加 `overflow: hidden` 兜底裁切，阻断 xterm rows×cellHeight 撑大祖先链；toolbar 加 `position: relative; z-index: 1` 兜底防 absolute 子元素从 overflow:hidden 边界跳出。
- Fix (Electron worker stdio 改为可选 — Code Review P0#2): 上一版为定位黑屏问题把 `fork(tab-worker.js)` 的 stdio 从 `inherit` 改成 `pipe` 并写到 `~/.claude/cc-viewer/electron-debug-{ts}-tab{N}.log`，让 Finder 启动的 .app 也能留 worker 输出。但生产用户没有调试需求，每开 tab 都写日志文件会无谓占盘；改为**默认 inherit**（与原版行为一致、零 IO 开销），仅 `process.env.CCV_DEBUG_WORKER_LOGS === '1'` 时切到 pipe + 写日志，日志路径同时尊重 `CCV_LOG_DIR` 环境变量。新增 `LOG_RETENTION_MS = 7 * 24 * 3600 * 1000` 常量；mkdir/cleanup 失败有 `console.error` 留痕（非静默吞）。
- 5-teammate Code Review 团队评审（requirements / regression / code-quality / architecture / css-ui）+ 采纳 P0/P1: requirements 6/6 需求 100% 覆盖；regression 5 通过 + 1 P0（spawnClaude 失败仍发 ready）+ 1 light 主题真机验证建议；code-quality 7 项无关键缺陷 + 3 项改进（日志同步阻塞、常量化、SIGWINCH helper）；architecture P0 stdio 生产化 / P1 SIGWINCH 单次 / P3 manifest 同步；css-ui 8/8 通过 + 1 项 traffic-light y=24 微调建议。落地 P0+P1 全部（spawnClaude catch return、stdio CCV_DEBUG_WORKER_LOGS 开关、SIGWINCH 单次 process.kill、常量化）；P2/P3 项（traffic-light y=24、tab-bar.html CSS 变量、electron-builder.yml ↔ package.json files CI 校验）按用户要求先不纠结，留作后续。
- Test / Build: `npm run test` 1298/1298 全绿；`npm run build` ✓；`npm run electron:build` 产 `CC Viewer-1.6.220-arm64.dmg` 131M、`-arm64-mac.zip` 128M（macOS ad-hoc 签名，无 Apple 公证环境跳过）。

## 1.6.219 (2026-04-28) — scratch 终端上线（多 tab + pty 隔离 + 拖拽 + focus border 结构化预留）

- Feature (终端工具栏右侧按钮换语义): 原"齿轮 → 预置快捷方式管理"入口被替换为"终端图标 → 切换临时终端面板"。预置快捷方式管理流程**未删除**，仍可由 `TerminalPanel.jsx:1227` 的 `customShortcuts` 与 `ChatInputBar.jsx:271` 移动端 plus menu 触达；本次只是把齿轮入口让位给更高频的 npm scripts / 临时 shell 需求。按钮带 `aria-pressed` + `.toolbarBtnActive`（实色 `var(--color-primary)` 背景）激活态。
- Feature (scratch 终端面板): 点击新按钮在主终端区域下方展开一块独立终端，初始 200px、用户可拖（CSS 原生 `resize: vertical`，无 JS mousemove handler）；高度去抖写 `localStorage:cc-viewer-scratch-height`（clamp 100~600），开关状态写 `localStorage:cc-viewer-scratch-open`，刷新可恢复。仅桌面/iPad（`(!isMobile || isPad)`）渲染，移动端不暴露。
- Feature (scratch pty 后端隔离): 新建 `scratch-pty-manager.js` 单例（与主 pty 完全隔离），spawn `process.env.SHELL || /bin/sh`，cwd 模块加载时即捕获 `STARTUP_CWD`（避开后续 chdir / Electron 下 `/` 边界），剥离 `CCV_*` 环境变量避免污染。新 WS 端点 `/ws/terminal-scratch`：在 `setupTerminalWebSocket` 现有 upgrade 链路里**就地**新增分支（不挂第二个 listener，避免与现有 `else: socket.destroy()` 互踩）；只承载 `input/resize/data/exit`，不接 hook/SDK/preset 等业务路径。
- Feature (kill 时机对齐主 pty): toggle 关闭面板**不 kill scratch pty**；`/api/workspaces/stop` 通过 `Promise.all` 并联调 `killPty()` + `killScratch()` 同时释放。这让用户在面板里跑 `npm run build` 中途收起面板再展开能继续看进度，与主 pty 跨刷新存活的体感一致。
- Feature (ScratchTerminal 组件): 新建 `src/components/ScratchTerminal.jsx`，瘦身版 xterm 包装（FitAddon + WebLinks + Unicode11，**不开 WebGL**——避免开关动画期 0 尺寸触发 contextLoss）；自带 ResizeObserver+`fit()`+`sendResize`，2s 重连，`_closing` 标志防止 unmount 后重连；复用 `TerminalPanel` 导出的 `darkTerminalTheme`/`lightTerminalTheme`。
- CSS (TerminalPanel.module.css): 新增 `.toolbarBtnActive`（含 `:hover` 兜底，无 `!important`）、`.scratchWrap`（`flex-shrink:0; min-height:100; max-height:600; height:200; resize:vertical; overflow:hidden`）+ light/dark 主题背景、`.scratchInner`（flex:1, min-height:0 让内层 xterm 能压缩）。
- i18n (`src/i18n.js`): 新增 `ui.terminal.scratchTerminalOpen` / `ui.terminal.scratchTerminalClose` 18 语言（按钮 title + aria-label，根据 `scratchOpen` 切换）。仅前端 i18n.js 加，server-side `i18n.js` 不需要。
- Test (`test/scratch-pty-manager.test.js`): 9 条新单测覆盖空状态查询、空操作不抛、监听器注册/解注；遵循 `pty-manager.test.js` 既有风格。`npm run test` 1294/1294 全绿。
- Build hygiene: `package.json#files` 加 `scratch-pty-manager.js`，确保 `npm publish` 时打包；`npm run build` 通过。
- UltraReview 三角度并行评审 + 采纳: req-verifier 全 10 条 R1~R10 标 MET、regression-reviewer 6 PASS / 2 CONCERN（pendingFileStrip ordering UX nit + 循环 import）、impl-reviewer 0 MAJOR / 3 MINOR。落地了 P0 类修复：① `spawnScratch` 加 in-flight Promise 缓存防并发双开 pty；② 抽出 `src/components/terminalThemes.js` 共享主题常量，破除 TerminalPanel↔ScratchTerminal 的循环 import；③ scratch shell 环境额外 `delete env.ANTHROPIC_BASE_URL` 并 `CLAUDE_CODE_DISABLE_MOUSE ??= '1'`，防止用户在 scratch 里手敲 `claude` 时被劫持去 cc-viewer 本地代理；④ ScratchTerminal `onmessage` exit/toast 分支的 `terminal.write` 包 try/catch，防 xterm dispose 与同步 ws 消息之间的窗口期写抛错。用户后续追加要求：scratch 面板从「主终端 `.terminalContainer` 之后」挪到「`.terminalToolbar` 之后」（工具栏下方而非上方），让"齿轮按钮 → 工具栏 → scratch 面板"视觉层级更直观；这同时化解了 regression-reviewer 提出的 pendingFileStrip 顺序 nit。`.scratchWrap` 原 `border-top` 在新位置下变为与工具栏的分隔线，CSS 无需改动。
- 用户再次追加要求：scratch 面板高度需要可拖拽调整（直观方向：从顶部往上拽变高）。原方案的 CSS 原生 `resize: vertical` 把手在右下角、与"面板紧贴底部"位置冲突。改造为手写拖拽条：① 工具栏与 scratch 之间插入 `.scratchResizer`（4px 高、`cursor: row-resize`、hover/dragging 变 `--color-primary-bg-light`、`touch-action: none`）；② 用 **Pointer Events + setPointerCapture** 替代 document-level mousedown/move/up，自动覆盖 mouseup 飞出窗口、iPad 触摸通过同一套 pointer API；③ 拖拽期间通过 ref 直写 `el.style.height`（不放 JSX inline style，防 theme MutationObserver / preset-changed 等无关 setState 中途把高度 snap 回去），mouseup 时一次性 setState + localStorage 提交；④ `isDraggingScratch` 显式 state 控制 `.scratchResizerDragging` 类（`:active` 在 document 级 drag 中不可靠）；⑤ `componentWillUnmount` 检测 `_scratchDragging` 兜底恢复 `body.style.cursor/userSelect`；⑥ 移除原 `_attachScratchObserver`/`_detachScratchObserver`/`_scratchHeightWriteTimer` 整套 ResizeObserver 链路，由 `_applyScratchHeight()` 在 mount/scratchOpen 翻 true 时直写一次初始高度。Plan agent 提出的 6 项 FIX 全部采纳。新增 i18n key `ui.terminal.scratchResizer` 18 语言（aria-label）。`npm run test` 1294/1294 + `npm run build` ✓。
- UltraReview 三 agent 二轮评审 + 采纳: req-verifier 9/9 MET、impl-reviewer 10 PASS / 4 MINOR、regression-reviewer 7 PASS / 2 CONCERN。落地两处修复：① 去掉 `componentDidUpdate` 里 `Promise.resolve().then(_applyScratchHeight)` 的 microtask 包裹，直接同步调用——componentDidUpdate 本身就在 React commit 后、浏览器 paint 前触发，微任务反而把 style.height 写延后到 100→stored 闪烁那一帧；② `componentDidUpdate` 加分支：若 `scratchOpen` 翻 false 且 `_scratchDragging===true`（外部代码/未来 hotkey 在拖拽中关闭面板），同步恢复 `body.style.cursor/userSelect` 并清掉拖拽标志，防止 resizer 卸载导致 pointerup 永远不触达、body 样式残留。a11y 键盘激活与 4px 触摸目标 (WCAG 2.5.5 AAA) 因 out-of-scope 接受不修。
- 用户后续追加要求：focus 边框需要按主终端 / scratch 终端**分开显示** —— 哪个 xterm 被点中只圈哪个白色 xterm 区域；之前是外层 `.terminalPanel` 一个大框包住整个面板（含工具栏、scratch 区、虚拟键盘），与 "白色 xterm 区域" 视觉范围错位。改造：① 删除 `.terminalPanel` 的 `border` + `transition` + `terminalPanelFocused` 规则与配套 `terminalFocusIn`/`terminalFocusInLight` 关键帧 + `:global([data-theme="light"])` 覆写；② 把 4px focus 边框迁移到 `.terminalContainer`（主白色 xterm 区域）与 `.scratchWrap`（scratch 白色 xterm 区域）各自，加 `box-sizing: border-box` 让边框抵消原 `.terminalPanel` 外边框的空间消耗（主终端 xterm 内容区零偏移）；③ 用 `transition: border-color` 替代关键帧动画，避免 mount-animate 副作用；④ 主终端用现有 `state.terminalFocused` + 新 `.terminalContainerFocused` 类；⑤ scratch 端 `ScratchTerminal` 新增 `onFocusChange` callback prop，组件 `componentDidMount` 给 `terminal.textarea` 挂 focus/blur 监听上报父组件，`componentWillUnmount` 解绑并 fire `onFocusChange?.(false)` 清父 state（防 toggle 关闭后边框残留）；⑥ 父组件 `TerminalPanel` 加 `state.scratchFocused` + `.scratchWrapFocused` 类。Plan reviewer 14 项 PASS / 0 FIX，唯一 CLARIFY：`scratchHeight` 在 border-box 下含 4px×2 边框，xterm 内容区比 border-box 化前少 8px，fitAddon 自动 refit 解决。`.terminalPanel` 与 `.terminalPanelWrap` 父链均无 `overflow: hidden`，box-shadow 不被裁。`npm run test` 1294/1294 + `npm run build` ✓。
- 用户后续追加要求：`.scratchResizer` 横向拖拽条样式需与项目里其他可拖拽分隔线（如 `.vResizer`）保持一致。原版本是 4px `var(--border-primary)` 实心带、hover `var(--color-primary-bg-light)`；与项目主流 `.vResizer` 模式（5px + `var(--bg-elevated)` 底 + 两侧 1px `var(--border-primary)` + hover `var(--border-secondary)`）不一致。改为 vResizer 的横向镜像：`height: 5px; background: var(--bg-elevated); border-top: 1px solid var(--border-primary); border-bottom: 1px solid var(--border-primary); transition: background 0.15s;` + hover/dragging 都用 `var(--border-secondary)`。视觉总厚度从 4px 变成 5+1+1=7px（容忍）。`.scratchResizer` 也是项目第一条横向分隔线，作为模式样板供后续复用。`npm run build` ✓。
- 用户后续追加要求：scratch 终端区域加左侧多 shell tab 栏，初始化为 1 个 tab + 一个 [+]，提升终端模块的并发能力。这是单例 → 多实例的大改造：① **`scratch-pty-manager.js` 全面重构**：模块级 `scratchPty/outputBuffer/dataListeners/...` 替换为 `Map<id, State>`，所有导出函数（`spawnScratch/writeScratch/resizeScratch/killScratch/onScratchData/onScratchExit/getScratchState/getScratchOutputBuffer/getScratchPid`）加 `id` 参数；`flushBatch(s)` 参数化；listener 迭代用 `[...listeners]` snapshot 防中途解注册跳号；`_spawnInflight` 也变为 `Map<id, Promise>` 防同 id 并发双开；新增 `killAllScratch()` 与 `getScratchActiveCount()`；`getOrInit` + `maybeReap` 在监听器注销且无 pty 时清空记录避免懒注册场景的 Map 长尾膨胀。② **`server.js` WS 路由按 id 分派**：`/ws/terminal-scratch?id=xxx` 在 upgrade 阶段校验 `SCRATCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/`，校验失败或缺 id 直接 `socket.destroy()`，避免 Map 被注入空键 / 超长 / 特殊字符；硬上限 `MAX_SCRATCH_PTYS = 16`（已存在 id 重连不计入新增配额）；`req.ccvScratchId` 透传到 connection handler；新增 `'kill'` 消息类型供前端关闭 tab 时主动 kill pty + 释放配额；`/api/workspaces/stop` 由 `killScratch()` 改为 `killAllScratch()`。③ **`ScratchTerminal.jsx`** 接 `id` prop，WS URL 拼 `?id=...`；公开 `refit()` / `focus()` / `requestKill()` 三个公共方法供父组件控制；`refit()` 解决 display:none → block 不触发 ResizeObserver 的问题（需要显式 `fitAddon.fit() + sendResize()`）。④ **`TerminalPanel.jsx`** 加 `state.scratchTabs: Array<{id}>` + `state.activeScratchTabId`；`localStorage` 新增 `cc-viewer-scratch-tabs` / `cc-viewer-scratch-active-tab` 两个键，老的 `scratch-open` / `scratch-height` 保留；`SCRATCH_TAB_MAX = 8` 前端上限（disable + 按钮，server 16 留余量）；`genScratchTabId()` 用 `crypto.randomUUID()` 拼 `t-` 前缀（与 server 校验正则兼容）；`handleScratchTabClick` setState callback 中先 `refit()` 再 `focus()`（防 fit 在 0-row 终端上失败）；`handleScratchTabAdd` 等下一帧 mount 后 refit/focus 新 tab；`handleScratchTabClose` 关 active tab 时取**右邻居 fallback 左邻居**（VS Code/iTerm 模式），最后一个 tab 的 × 隐藏（最少保 1）；同名 shell 用索引 `1/2/3` 后缀区分；`handleScratchTabFocusChange(id, focused)` 过滤非 active tab 的 focus 事件防切换抖动。⑤ **CSS** `.scratchWrap` 改 `flex-direction: row`；新增 `.scratchTabs`（140px 侧栏）/`.scratchTab`/`.scratchTabActive`/`.scratchTabIcon`/`.scratchTabLabel`/`.scratchTabClose`（hover 和 active 时 opacity:1）/`.scratchTabAdd`（虚线边框，disabled 时 opacity:0.4）/`.scratchPanes`/`.scratchPane`/`.scratchPaneActive`（display:flex 切换）。⑥ **i18n** 新增 `ui.terminal.scratchTabAdd` / `ui.terminal.scratchTabClose` 18 语言。⑦ 测试：`test/scratch-pty-manager.test.js` 全面更新为 id-based API，13 条测试包括跨 id 隔离与 spawnScratch 缺 id 拒绝；`npm run test` 1298/1298 全绿（+4 新测）。`npm run build` ✓。
- 用户后续微调：scratch tab 侧栏宽度 140px → 120px → 100px → 95px。tab 标签 fallback 占位从 "shell" 改为 "zsh"（macOS 默认；老 server 不发 shellBasename 时也显示对）；新 server 的 WS state 消息送达后真实 basename（bash/fish 等）仍会覆盖占位。`npm run build` ✓。
- 用户报两个 bug：① 第一个 scratch tab 跑了 `ccv -c --d` 起 7010 端口服务后，新 tab 似乎"复制"了这个服务的环境上下文。② focus 时 xterm 内容把底部 outline 压住甚至溢出。修复：① **env 泄漏**：cli.js 在 cc-viewer 主进程上 set 了一批 CCV_* 协调变量（`CCV_CLI_MODE / CCV_PROJECT_DIR / CCV_PROXY_PORT / CCV_SDK_MODE / CCV_WORKSPACE_MODE / CCV_BYPASS_PERMISSIONS / CCV_USER_NAME / CCV_USER_AVATAR` 等），原 strip 列表只覆盖了 7 个老变量，新增的全漏掉。改为**前缀扫描**：`for (const k of Object.keys(env)) { if (k.startsWith('CCV_') || k.startsWith('CCVIEWER_')) delete env[k]; }` + 单独删 `ANTHROPIC_BASE_URL`，未来新增 CCV_* 自动覆盖，scratch 里跑 ccv 不再反向劫持父级服务。② **底部 outline 被压**：`.scratchInner` 原 `padding: 4px 8px`，与父级 `.scratchPanes` 的 `outline-offset: -4px` 在底部 4px 同像素带；fitAddon 不感知 outline，xterm 算出的内容铺满到那个 4px 让 outline 视觉被覆盖。改为 `padding: 8px`（上下也 8px），让 xterm 内容到外缘有 8px 距离 > outline 占的 4px，留出干净过渡带；fitAddon 自动 refit 少 1 行。`npm run test` 1298/1298 + `npm run build` ✓。
- 用户后续提出更干净的方案：focus 边框不要圈整个 scratchWrap（含灰色 tab 栏），只圈 scratchPanes（白色 xterm 区域）—— 语义上"focus = 你正在打字的 xterm"也更对，灰色 tab 栏作为控制面不参与 focus 视觉。改造：删除 `.scratchWrap` 的 `outline / outline-offset / transition` 与 `.scratchWrapFocused`/light 覆写；同款 outline-based focus 视觉（`outline: 4px solid transparent; outline-offset: -4px; transition: outline-color, box-shadow`）迁移到 `.scratchPanes`，加 `.scratchPanesFocused` + `:global([data-theme="light"])` 覆写；JSX 中 className 条件从 scratchWrap 转移到 scratchPanes。已知 caveat：scratchPanes 的 box-shadow 外发光在右/上/下三边会被 scratchWrap 的 `overflow: hidden` 裁掉，左侧发光会叠到灰色 tab 栏上。outline 是主指示器，box-shadow 仅装饰增强，light 主题本来就 box-shadow:none，dark 主题损失略微全方位发光 — 接受。`npm run test` 1298/1298 + `npm run build` ✓。
- 用户先前一轮：focus 4px 透明边框在不聚焦状态会暴露 `.terminalPanel` 的灰色背景，形成 3 条可见灰边（上/左/下），让 tab 栏看着像被往里推一截、有点突兀。原来用 `box-sizing: border-box + border: 4px solid transparent` 的方案保留了 4px 布局占位空间——不管聚不聚焦都占着。改造为 `outline: 4px solid transparent + outline-offset: -4px`：① outline 不进入布局流，元素布局尺寸不再被 4px 吞噬；② 负 offset 让 outline 从元素外边线往内偏 4px，画在元素**内部最外圈 4px**，聚焦时与原 border 视觉等价；③ 不聚焦时 outline 透明 + 不占空间，灰边消失、tab 栏完全贴边。`transition: border-color` 同步改为 `transition: outline-color`（webSearch 验证 outline-color 在 Chromium/WebKit/FF 都支持过渡）。同步应用到 `.terminalContainer`（主终端 xterm 白底）和 `.scratchWrap`（scratch 整块），保持主终端 / scratch 视觉一致。box-shadow 保持外发光不变。已知 caveat：W3C interop 议题 #8786 — 负 outline-offset 在 Firefox 上若子元素溢出会渲染异常；本项目主要在 Chromium / WebKit 上跑且 .terminalContainer / .scratchWrap 的 overflow:hidden 限制了子溢出，风险低。`npm run test` 1298/1298 + `npm run build` ✓。
- 5-teammate Code Review 团队评审 + 采纳 P0/P1 反馈: req-verifier 9/9 MET、backend-reviewer 0 MAJOR、frontend-reviewer 0 MAJOR、regression-reviewer 14 PASS、quality-reviewer 0 MAJOR。落地 3 处修复：① **后端配额计数 bug**（backend MINOR #4）：原 `MAX_SCRATCH_PTYS=16` cap 检查的是 `_scratchActiveIds.size`（活跃 WS 连接数），不是后端 `ptys` Map 大小（实际 pty 数）。触发场景：用户开 16 tab → 直接关浏览器（不发 kill）→ `_scratchActiveIds` 清空但 `ptys` 仍存 16 个活 pty → 清 localStorage 后重开 → 16 个新 id 又能进来 → 服务端实际 32 个 pty，长期不上限。修法：scratch-pty-manager.js 新增 `getScratchPtyCount()` / `hasScratchPty(id)` 导出，server.js cap 改为 `!hasScratchPty(scratchId) && getScratchPtyCount() >= MAX_SCRATCH_PTYS`，已有 id 走重连路径不计入新增配额；同时移除冗余的 `_scratchActiveIds` Set（killScratch 内部 ptys.delete 自动释放配额）。② **iPad × 不可见**（frontend MINOR #7）：`.scratchTabClose { opacity: 0 }` 仅 `:hover` 或 `.scratchTabActive` 时显示，触摸设备无 hover 事件 → 非 active tab 的 × 永远不可见。新增 `@media (hover: none) { .scratchTabClose { opacity: 1 } }` 兜底。③ **过时注释**（quality MINOR #1）：TerminalPanel.jsx:65-66 注释说 "在拿到之前用 'shell' 作为占位"，但实际代码占位是 'zsh'，对齐为 "在拿到之前用 'zsh' 作为占位（macOS 默认 shell；新 server 到达 state 后会按真实 basename 覆盖）"。其余 P2 项（mock-pty 集成测试、抽 2000ms/80ms 常量、history.md 测试数表述、80×24 隐藏 tab 切换 1 帧 reflow、focus border 包灰色 tab 栏的不对称、arrow-key 标签导航）经评估属可接受范围，留作后续。`npm run test` 1298/1298 + `npm run build` ✓。
- UltraReview 三 agent 评审采纳: req-verifier 11/12 MET（R9 shell label hard-coded "shell" → NOT MET），impl-reviewer 1 MAJOR + 1 MINOR，regression-reviewer 14 PASS / 1 CONCERN。落地修复：① **R9 / MAJOR shell label**：后端 `scratch-pty-manager.js` 新增 `getScratchShellBasename()`（`path.basename(process.env.SHELL || '/bin/sh')`）；server.js WS 'state' 消息携带 `shellBasename`；ScratchTerminal 增加 `'state'` 消息解析 → 通过新增的 `onShellInfo` prop 上报；TerminalPanel 加 `state.scratchShellBasename`，首条 state 到达时 setState（所有 tab 共享一个 $SHELL，只取首到值），tab 标签 base 由 `'shell'` 改为 `state.scratchShellBasename || 'shell'`，在 zsh 用户处显示为 "zsh" / "zsh 2" / "zsh 3"。② **MINOR spawn 失败状态**：在 `spawnScratch` 上方加注释说明降级链路 —— 失败时 s 留在 Map 但通过 listener cleanup + maybeReap 兜底回收；用户体感为空终端，下次 input 再试。③ **regression CONCERN #5 实际不成立**：reviewer 担心 `handleRequest` 用 `url` 精确匹配会被 `?id=x` 绕过，但 server.js:255 处 `const url = parsedUrl.pathname` 已经剥掉 query，无问题，无需改。`npm run test` 1298/1298 ✓ + `npm run build` ✓。
- 用户报 focus border 修复后顶/底仍然被吃白：硬刷过、padding 已改 8px 也没用。DevTools 实测 `div.xterm-screen` 是 509×180 直接铺到 `.scratchPanes` 边缘 —— `outline + outline-offset:-4px` 是 paint-only，xterm canvas/screen 的背景填充会盖掉 outline 的 4px 像素带（左/右 outline 残留可见，因为 xterm-screen 在水平方向不画背景；顶/底被盖白）。**根治方案**：把 4px focus 视觉**从 `.scratchPanes` 的 outline 迁移到 `.scratchInner` 的 border**。① `.scratchInner` 永远挂 `border: 4px solid transparent`（box model 硬预留 4px 像素带），focused 时由 `.scratchPanesFocused .scratchPane.scratchPaneActive .scratchInner` 选择器把 border-color 切到主题色。② 因为 border 是 box model 一部分，xterm fitAddon 读 `.scratchInner` 的 content-box 高度时**自动减掉** border + padding，xterm canvas 物理上不可能再画进 focus 像素带——彻底治本，不依赖 paint-band 假设。③ 总 inset 从 8px 提到 12px (4px border + 8px padding)，亚像素抗锯齿也不会贴到 border。④ `.scratchPanes` 撤掉 outline / outline-color / outline-offset / `transition: outline-color`，仅保留 box-shadow glow（dark 主题，light 主题原本就是 box-shadow:none）。⑤ 自检过程中误把 light 主题 border-color 从原 `rgba(217, 119, 87, 0.15)` 拉到 0.5（"补偿 border solid 视觉更重"），用户实测过深 —— 同样 4px 宽度的 outline 与 border 在相同 alpha 下视觉等价，不需要补偿，回滚到 0.15 维持原 outline 时代视觉。`npm run test` 1298/1298 ✓ + `npm run build` ✓。
- 顺手并入 3 处与 scratch 无关的零碎修改：① `AppBase.jsx` 默认 `expandThinking: true → false`，新会话默认收起 thinking 块（用户偏好）；② `FileContentView.module.css` `.markdownPreview` 背景从 `--bg-base-alt` 换到 `--bg-container`，主题变量更准；③ `MdxEditorPanel.module.css` `_diffSourceToggleWrapper` 选择器收窄到 `_toolbarRoot` 子树并补 `border: 0`，防止全局命中扩散到其他场景的同名 class。

## 1.6.218 (2026-04-27) — 工具栏快捷按钮 paste 块紧贴 \r 拆分修复（窗口失焦也能立即提交）

- Fix (清空上下文 / 预设 / UltraPlan 在 cc-viewer 窗口失焦时停在 [Pasted text] 状态需再按 Enter): 原因：bracket paste 包裹和 `\r` 在同一次 PTY write 里到达，Claude CLI 的 Ink/React TUI 需要至少一帧渲染才能完成 paste→normal 状态切换，紧贴的 `\r` 在 paste 状态机未稳定时被吞或并入 paste 内容。窗口失焦时浏览器对 hidden/occluded tab 的 RAF 节流可能放大这个 race，让"看起来跟焦点相关"的体感更明显。前端→后端→PTY 全链路是 `ws.send` → `ptyProcess.write`，**实际跟 macOS 窗口焦点完全无关**。做法：`src/utils/ptyChunkBuilder.js` 新增 `buildBracketPasteSubmitChunks(content)` + `BRACKET_PASTE_SUBMIT_SETTLE_MS = 250` 常量，把 paste 块和 `\r` 拆成两 chunk；`TerminalPanel.jsx` 三处 callsite（`handlePresetSend` / `handleClearContext` / `handleUltraplanSend`）改走 `input-sequential` 通道；`pty-manager.js` 的 `writeToPtySequential` 把 `endsWith('\x1b[201~')` 检测加进 `isToggleOrSubmit` 同级，命中走 `settleMs`（而非硬编码 80ms），让后端在 paste 块写完后等 250ms 给 Ink 一帧渲染缓冲再写 `\r`。前端不能用 `setTimeout` 拆——Chrome 后台 tab 的 timer 节流到秒级；后端 Node 进程不受浏览器节流影响。`_handlePaste` 系统剪贴板路径不动（长 paste 显示 `[Pasted text]` 占位由用户决定何时 Enter 是预期 UX）。
- Test (writeToPtySequential 延迟规则两个新单测): 正向——`['\x1b[200~/clear\x1b[201~', '\r']` 配 `settleMs:250` 时 paste-end → `\r` 间隔 ≥200ms；负向回归——`['a', 'b']` 配 `settleMs:500` 时间隔仍 <300ms（验证 inquirer 路径走 80ms 硬编码不被误命中，余量给慢 CI 的 setTimeout 抖动）。
- Note (handleClearContext 乐观重置时机不变，但实际 /clear 落地慢 ~330ms): `props.onClearContextOptimistic?.()` 仍在 `ws.send` 之后同步调用，AppBase 的 `contextBarOptimistic` 立即把 Header 血条降到 `OPTIMISTIC_CLEAR_PERCENT`；新路径 PTY 真实写完 `\r` 比旧路径慢约 80+250=330ms，期间 SSE 推 context_window 也相应延迟。AppBase 既有 30s 兜底定时器（feat 1.6.214）覆盖此场景，无需额外修复，仅记录避免后续误判。
- Known issue (input-sequential-done 与 ChatView listener 潜在竞态): server.js 完成 input-sequential 后会发 `{type:'input-sequential-done'}`，ChatView `_submitViaSequentialQueue` 监听这个消息处理 inquirer 回执。**实际经审查：ChatView 用 `_inputWs` 独立 socket，TerminalPanel 用 `this.ws`，server 只 send 回触发的那个 ws 不广播——架构上天然隔离**。仅当未来某天 ChatView 在同一 ws 内发起两次并发提交才会重现，目前不存在。给消息加 sender/messageId 字段超出本次 bug fix 范围，后续迭代再加。
- Test / Build: `npm run test` 全绿；`npm run build` 通过。

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

