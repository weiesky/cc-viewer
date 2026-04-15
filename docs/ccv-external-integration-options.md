# CCV 外部集成架构选项（归档讨论）

本文档记录了"ccv × lia 日志集成"设计过程中考虑过但**暂不实施**的两条路径。当前（2026-04-15）选定路径 3（无 MetadataPanel，主功能优先）开始实施。本文档作为后续讨论"体验优化"阶段的参考。

## 背景

- ccv 是通用的 CC 会话日志可视化工具，自身有 proxy 拦截 + 本地 JSONL 存储能力
- lia 是 Rust 工作流平台，希望把自己的 session / work-item 元数据接入 ccv 供研究使用
- 用户硬约束："ccv 保持独立"——ccv 代码里零 lia 特定逻辑，lia 负责自适配
- 协议设计：`docs/ccv-external-sessions-protocol.md`（目录 + JSON schema），ccv proxy 作为协议写入器、ccv 读端按协议扫目录 live tail

## 问题焦点

为了"展示 session 的业务上下文"（WI 标题、claim mail、注入的 skills 等），需要一个**元数据面板（MetadataPanel）**。这个面板不属于"打开日志"的主路径，而是额外显示 `session.json` 里 meta 数组的 key-value 信息。

把它放在哪里触及"是否动 ccv 核心代码"的边界。

## 路径 1：纯新增 + feature-gated（当前未选）

**做法**：在 ccv 仓库里直接加 `src/components/MetadataPanel.jsx`，在 `src/App.jsx` 顶层加 feature-gated 条件渲染（`CCV_EXTERNAL_ROOTS` 为空时不渲染）。

**承诺**：
- 不修改任何现有文件的现有逻辑
- env 为空时，新代码所有路径都 dead code
- 回滚时，删新文件 + 还原 App.jsx 的 30 行，ccv 行为与之前版本 1:1 一致

**反对意见**：
- 这些文件仍然住在 ccv 仓库里
- 以"feature-gated"为由往核心仓库加代码，容易形成长期积累——ccv 不只会有 lia 要集成，未来还会有 n 个集成方，都按这个模式进仓库就乱了

**结论**：被用户否决。本轮不走。

## 路径 2：ccv 加 UI 插件系统，External Sessions 做成独立 npm 包（当前未选）

**做法**：
1. 先改 ccv 主干：扩展 `lib/plugin-loader.js`，让插件能注册 `{ tab, rootComponent, i18n, theme }`。设计 React 组件注入 / 状态桥接 / 主题对齐机制
2. 发布 `cc-viewer-external-sessions` 独立 npm 包
3. 用户 `npm install -g cc-viewer-external-sessions`，ccv 启动时 plugin-loader 自动装载，注入 Sessions tab + MetadataPanel
4. ccv 仓库里**永远没有** Sessions tab / ScopeBrowser / SessionList / MetadataPanel 的代码

**代价**：
- UI 插件系统本身是大工作：React 组件生命周期协作、SSE 事件订阅桥接、i18n/主题/preferences 共享、类型契约稳定化
- 第一次做成本翻倍（要先做插件系统，再做插件）
- 收益是：**长期主干防污染**——之后所有第三方集成（不止 lia）都走同一条路，ccv 核心再也不会被集成方污染

**反对意见**：
- 目前只有 lia 一个集成方，过度设计
- 插件系统的契约稳定化本身是很大的话题，要等到有多个实际插件后才能锁定 API

**结论**：暂缓。本轮不走，但**未来如果出现第 2 个 / 第 3 个外部集成方**，应该优先升级到这条路，而不是继续往主干堆 feature-gated 代码。

## 路径 3：当前选定——先做主功能，不做 MetadataPanel

**做法**：
- 实现协议的 proxy 写入端 + ccv 读端 + ScopeBrowser + SessionList
- `session.json` 的 `meta` 字段**继续在协议里保留**（它是协议的一部分，lia 会照写）
- 但 ccv UI 暂时**不渲染** meta 细节
- 业务信息通过 session 列表条目的 title / subtitle / role tag / tooltip 做轻量暴露
- 不引入新组件专门展示元数据

**好处**：
- UI 改动最小（两个新组件 ScopeBrowser/SessionList + 一个 feature-gated tab）
- 协议形态不变——未来走路径 1 或路径 2 时，只要把 MetadataPanel 加上即可，lia 侧不用改
- 主功能（多 session 浏览、live tail、counsel/worker 可见）一次到位

**遗留**：
- 用户研究 session 时看不到 WI 标题、claim mail、skills 等富上下文
- 只能通过 session 列表的简短 label 推断，信息密度低

**什么时候升级**：
- 如果"主功能"稳定后用户确认需要看 meta 细节 → 选路径 1 or 2
- 如果出现第 2 个外部集成方 → 直接跳路径 2
- 如果用户可以接受"通过其他工具看 meta 细节"（如 `lia wi show`）→ 永久维持路径 3

## 决策表

| 维度 | 路径 1 | 路径 2 | 路径 3（选中）|
|---|---|---|---|
| ccv 核心变动量 | 小（新增+feature gate）| 大（UI 插件系统）| 最小（两个新组件+新 tab）|
| 集成方代码落在哪 | ccv 仓库 | 独立 npm 包 | ccv 仓库 |
| UI 信息密度 | 高（有 MetadataPanel）| 高 | 中（只在列表里暴露）|
| 未来添加第 N 个集成方成本 | 继续堆 ccv 仓库（累积污染）| 各自独立 npm 包（干净）| 不适用（暂不支持多集成方富 UI）|
| 前置成本 | 低 | 高（先建插件系统）| 最低 |
| 用户本轮决定 | 否 | 否 | **是** |

## 记录人

ccv × lia 集成讨论，2026-04-15。
