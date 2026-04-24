# Phase 999.1: 可视化模式底部面板 Tab 化 + 折叠功能 - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

将 visual 模式中 `visualOperationArea`（当前固定高度底部面板）改造为：
1. 自定义轻量 Tab 面板（第一个 Tab：项目启动器；第二个 Tab：元素信息）
2. 支持折叠为底部 tab 标签横条（32px 高，保留所有 tab 标签可见）
3. iframe（`visualPreviewArea`）通过 flex 布局自动响应面板高度变化
4. 保留现有拖动 resizer

</domain>

<decisions>
## Implementation Decisions

### D-01: 折叠形态
折叠后保留 Tab 标签横条（32px 高），所有 tab 标签保持可见，面板内容区隐藏（height: 0 或 display: none）。

### D-02: 折叠触发方式
点击当前已激活的 tab 标签触发折叠；点击任意 tab 标签展开并切换到对应 tab。逻辑：
- 已展开 + 点击当前 tab → 折叠
- 已折叠 + 点击任意 tab → 展开并激活该 tab
- 已展开 + 点击非当前 tab → 切换 tab（不折叠）

### D-03: 折叠横条高度
32px，与现有 `launcherSummary`（height: 28px）风格一致，略增至 32px 以容纳 tab 标签。

### D-04: Tab 内容分区
两个 Tab：
- **项目启动器**（原 `ProjectLauncher`）— 默认激活
- **元素信息**（原 `ElementInfo`）— 选中元素时自动切换到此 Tab

`ProjectLauncher` 的 `collapsed` / `onToggleCollapse` 逻辑由底部面板 Tab 系统接管，不再由 `ProjectLauncher` 内部处理折叠（仍保留组件内现有 collapsed 摘要行用于向后兼容，或可移除）。

### D-05: 选中元素自动切换 Tab
当 `selectedElement` 从 null 变为非 null 时，底部面板自动：
1. 若当前为折叠态 → 展开
2. 激活「元素信息」Tab

### D-06: iframe 高度行为
`visualPreviewArea` 保持 `flex: 1`，`visualOperationArea` 改为由面板展开/折叠状态决定高度：
- 展开时：`height: visualOperationHeight`（保持可拖动调整）
- 折叠时：`height: 32px`（仅 tab 标签横条）

不引入 CSS transition 动画（保持性能优先）。

### D-07: Resizer 保留
保留 `visualHResizer` 拖动调整面板高度，折叠时隐藏 resizer（折叠态无需调整高度）。

### D-08: Tab 组件方案
自定义轻量 tab bar，不使用 Ant Design Tabs。参考 `SideMenu` 的实现模式（CSS Modules + 简单 onClick 状态）。Tab 内容始终保持挂载，通过 CSS `display: none / block` 切换可见性（避免状态丢失）。

### Claude's Discretion
- Tab 标签的具体 icon：可参考 `SideMenu` 中已有 icon 风格（Ant Design Icons），也可纯文字
- Tab 标签横条的背景色/边框样式：与现有 `visualOperationArea` 顶部边框保持一致即可
- 折叠状态是否持久化到 App state：可以，类似现有 `launcherCollapsed`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 现有布局实现
- `src/App.jsx` §496–548 — visual 模式布局，包含 `visualOperationArea`、`visualHResizer`、`launcherCollapsed` 状态
- `src/components/VisualEditor/ProjectLauncher.jsx` — 已有 collapsed/onToggleCollapse prop 接口
- `src/components/VisualEditor/styles.module.css` — 所有 launcher、launcherSummary 样式，及现有 CSS 变量体系

### 参考实现
- `src/components/VisualEditor/SideMenu.jsx` — 自定义轻量 tab bar 的参考模式
- `src/components/VisualEditor/ElementInfo.jsx` — 待迁入新 Tab 的组件

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ProjectLauncher`：已有 `collapsed` + `onToggleCollapse` props，可沿用或移除（由外层 tab 系统接管折叠）
- `ElementInfo`：纯展示组件，直接移入新 Tab
- `visualOperationHeight` state（App）：驱动面板高度，继续沿用
- `launcherCollapsed` state（App）：可扩展为 `bottomPanelCollapsed` + `activeBottomTab`

### Established Patterns
- App class 管理所有 visual 模式状态（`launcherCollapsed`, `visualOperationHeight`, `visualMenuKey`）
- CSS Modules + CSS 变量（`var(--bg-container)`、`var(--border-primary)` 等）
- 拖动 resizer 逻辑位于 `handleVerticalResizeStart`

### Integration Points
- `App.jsx` §496–548：主要改造区域，替换 `visualOperationArea` 的内容为新 Tab 面板
- `App state`：新增 `activeBottomTab: 'launcher' | 'element'`，将 `launcherCollapsed` 扩展为 `bottomPanelCollapsed`
- `selectedElement` 变化逻辑（已在 App）：需新增副作用切换 Tab

</code_context>

<specifics>
## Specific Ideas

- Tab 标签行为：「点已激活 tab → 折叠；点非激活 tab → 切换；折叠时点任意 tab → 展开」— 类似 VS Code / JetBrains 底部面板
- 折叠态 tab 标签横条设计参考：`| 项目启动器 | 元素信息 |     [↓]`（用户确认的预览格式）

</specifics>

<deferred>
## Deferred Ideas

- 后续可追加更多 Tab（Pipeline 场景录入等）— 架构已为此预留
- ProjectLauncher 内部的 collapsed 摘要行 UI 是否完全移除：留到执行阶段决定，不影响主体方案

</deferred>

---

*Phase: 999.1-visual-mode-bottom-panel-tabs-collapsible*
*Context gathered: 2026-04-24*
