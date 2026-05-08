# Changelog

## Unreleased

- fix(sessionMerge): 反向锚点对齐替换正向 prefix-overlap，根治流式 mainAgent "复制"翻车
  - 旧 `src/utils/sessionMerge.js` 三分支按 `newLen vs currentLen` 各走各的：① `newLen===curLen` tail-fp 异时走 1.6.245 的"正向 prefix-overlap"，O(K²) 线性递减找最大匹配 K；text/thinking 取 `slice(0,64)` 单条 fp 易碰撞（共有 `<system-reminder>...` / `<command-name>/...` 头部），算法挑最大 K 优先选错 → 真新增的尾部消息被切掉、流式过程实际丢消息。② `newLen>curLen` 盲推 `newMsgs[curLen..]`，假设严格前缀扩展；CLI Plan Mode 后偶发 "K 条与末尾重叠 + 后段新增" 但 newLen>curLen 的窗口会被当作新内容再 push 一遍 → 同对话出现两次相同消息，即用户报的"复制翻车"。③ `newLen<curLen` 仅尾部全等才保留，少一条不同就重建，长 session 偶尔被一条 race 拍没。
  - 新算法：以 `newMessages[0]` 为锚点，从 `lastSession.messages` 末尾 `curLen-1` 反向扫，配合多块连续 fp 等价校验决定 append / no-op / rebuild。三分支收口到一个 `findReverseAnchor` 主路径，仅在 anchor 未命中且 `newLen<curLen` 时走 /compact rebuild、`newLen===curLen` 走整段 append（Plan Mode 2-msg 全替换窗口）、`newLen>curLen` 回退到旧"严格前缀扩展"语义保兼容。fp 加固：text / thinking / string content 从 `slice(0,64)` → `length + first32 + last32` 三元组，单条碰撞概率压到忽略量级；tool_use / tool_result 保留 API 强保证唯一的 id 主键不变。
  - 流式热路径零分配：anchor.overlapLen===newLen 时不进 push 循环、不动 `messages` 引用，下游 `appendToolResultMap` WeakMap 缓存继续命中。复杂度：单候选 O(L)，最坏 O(curLen·newLen) 与旧 O(K²) 同阶；典型 K<200 可忽略。
  - 测试：`test/incremental-merge.test.js` 追加 `describe('reverse anchor regression')` 6 case 锁死翻车场景：① text-only 共 64-char 头部不再误判；② newLen>curLen 带 K-msg 末尾重叠不再 K 条复制；③ 严格前缀扩展引用稳定；④ suffix-subset 引用稳定；⑤ 空 fp 防御；⑥ 反向扫多候选选最右。`incremental-merge / streaming-state / lr-messages-dedup / markdown-stream / delta-e2e / delta-reconstructor / entry-slim / session-manager / clearCheckpoint / extract-team-sessions / stream-assembler` 11 组 206/206 全过；`npm run build` ✓。

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

