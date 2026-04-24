# Phase 999.1: 可视化模式底部面板 Tab 化 + 折叠功能 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-24
**Phase:** 999.1 - 可视化模式底部面板 Tab 化 + 折叠功能
**Areas discussed:** 折叠形态, Tab 内容分区, iframe 高度与 resizer, Tab 组件选型

---

## 折叠形态

| Option | Description | Selected |
|--------|-------------|----------|
| 状态信息横条 | 显示运行状态和当前活跃 Tab 名 | |
| 极简横条 | 只显示一条线加展开按钮 | |
| Tab 标签横条 | 折叠后仅保留 tab 标签行可见 | ✓ |

**User's choice:** Tab 标签横条（32px 高）

| Option | Description | Selected |
|--------|-------------|----------|
| 点 tab 切换/折叠 | 点已激活 tab 折叠，点其他 tab 展开并切换 | ✓ |
| 展开按钮独立 | 专用折叠/展开按钮，不和 tab 点击耦合 | |

**User's choice:** 点 tab 切换/折叠

**横条高度:** 32px

---

## Tab 内容分区

| Option | Description | Selected |
|--------|-------------|----------|
| 独立成「元素信息」Tab | 与项目启动器并列为 tab | ✓ |
| 保留在页面固定位置 | 不加入 tab 体系 | |

**User's choice:** 独立成元素信息 Tab

| Option | Description | Selected |
|--------|-------------|----------|
| 自动切换 | 选中元素时自动展开并切换到元素信息 Tab | ✓ |
| 不自动跳转 | 保持用户最后所在 Tab | |

**User's choice:** 自动切换

---

## iframe 高度与 resizer

| Option | Description | Selected |
|--------|-------------|----------|
| flex 自适应 | iframe flex:1 自动撑满剩余空间，无动画 | ✓ |
| CSS transition 动画 | 面板平滑滑入滑出 | |

**User's choice:** flex 自适应（无动画）

| Option | Description | Selected |
|--------|-------------|----------|
| 保留 resizer | 保留拖动调整面板高度 | ✓ |
| 移除拖动调整 | 固定默认高度 220px | |

**User's choice:** 保留 resizer

---

## Tab 组件选型

| Option | Description | Selected |
|--------|-------------|----------|
| 自定义轻量 tab bar | CSS Modules + 简单 onClick，参考 SideMenu 模式 | ✓ |
| Ant Design Tabs | 复用 Antd 风格，但折叠行为需额外包装 | |

**User's choice:** 自定义轻量 tab bar

| Option | Description | Selected |
|--------|-------------|----------|
| 保持挂载 | 所有 Tab 内容始终挂载，CSS 切换显隐 | ✓ |
| 销毁重建 | 切换时销毁上一 Tab | |

**User's choice:** 保持挂载

---

## Claude's Discretion

- Tab 标签 icon 风格
- Tab 横条背景色/边框细节
- 折叠状态是否持久化到 App state

## Deferred Ideas

- 后续追加更多 Tab（Pipeline 等）
- ProjectLauncher 内部 collapsed 摘要行是否保留
