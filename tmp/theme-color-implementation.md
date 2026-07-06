# 主题色实现指南

## 1. 当前基础设施（已完成）

### 全局配置

- **state**: `AppBase.jsx` 中 `themeColor: 'dark'`（默认值）
- **持久化**: 通过 `/api/preferences` POST 保存到 `preferences.json`，页面加载时自动恢复
- **UI 入口**: 偏好设置 Drawer 底部的 Select 下拉框（桌面端 `AppHeader.jsx` + 移动端 `Mobile.jsx`）
- **i18n**: `ui.themeColor` / `ui.themeColor.dark`（标准黑）/ `ui.themeColor.light`（标准白），18 种语言

### 数据流

```
AppBase.state.themeColor
  ├── App.jsx → props → AppHeader.jsx（偏好设置下拉框）
  ├── Mobile.jsx（移动端设置面板）
  └── AppBase.darkThemeConfig getter（待改造）
```

---

## 2. 第三方控件白色主题兼容性

| 控件 | 用途 | 改动量 | 具体操作 |
|------|------|--------|----------|
| **Ant Design (antd)** | Button, Modal, Table, Drawer, Select, Switch, Tag, Dropdown, Popover, Collapse, Tabs, Input, Radio, Spin, etc. | 小 | `theme.darkAlgorithm` → `theme.defaultAlgorithm`，清理 `global.css` 中 `.ant-*` 暗色覆盖 |
| **@xterm/xterm** | 终端面板 (TerminalPanel) | 小 | 初始化时传入 light theme 对象：`{ background: '#fff', foreground: '#333', cursor: '#333', ...ANSI 16色 }` |
| **@uiw/react-codemirror** | 文件内容编辑器 (FileContentView) | 中 | 当前自定义暗色 `HighlightStyle`，需创建对应 light 版本 |
| **highlight.js** | Diff 语法高亮 (FullFileDiffView) | 中 | 当前无显式 CSS 主题，依赖自定义暗色样式；需引入 light 主题或自定义 light CSS |
| **react-json-view-lite** | JSON 查看器 (JsonViewer) | 一行 | `import { darkStyles }` → 条件选择 `darkStyles` / `lightStyles` |
| **react-virtuoso** | 虚拟滚动 (ChatView) | 无 | 纯布局控件，不涉及颜色 |
| **qrcode.react** | 二维码 (AppHeader) | 无 | 可配置前景/背景色，默认黑白即可 |
| **diff** | 文本 diff 计算 | 无 | 纯逻辑库 |

---

## 3. 自有 CSS 硬编码颜色清单

### 3.1 暗色调色板（当前使用）

```
背景层次:   #000 → #0a0a0a → #0d0d0d → #111 → #141414 → #1a1a1a → #1e1e1e → #222 → #262626 → #2a2a2a → #303030
边框/分割:  #2a2a2a, #303030, #3a3a3a, #424242, #444
文字层次:   #e5e5e5（主文字）→ #ccc → #aaa → #999 → #888 → #666 → #555（最弱）
```

### 3.2 语义色

```
主色（蓝）:   #1668dc, #3b82f6, #60a5fa, #4a9eff, #7dd3fc
成功（绿）:   #2ea043, #22c55e, #4ade80, #52c41a, #65a30d, #73c991
错误（红）:   #dc2626, #ef4444, #f87171, #ff6b6b, #cb171e
警告（橙）:   #f59e0b, #fbbf24, #d97706, #ca8a04
系统（紫）:   #a78bfa, #8b5cf6, #c4b5fd, #6b21a8
```

### 3.3 需改造的文件（按优先级）

**核心文件（影响全局）**:
| 文件 | 行数 | 说明 |
|------|------|------|
| `src/global.css` | ~182 | Ant Design 组件暗色覆盖、全局滚动条、markdown 样式 |
| `src/App.module.css` | ~775 | 主布局、拖拽、加载遮罩 |
| `src/AppBase.jsx:darkThemeConfig` | ~15 | Ant Design ConfigProvider 主题配置 |

**组件 CSS Modules（31 个文件）**:
| 文件 | 硬编码色数(估) | 关键颜色 |
|------|---------------|----------|
| `AppHeader.module.css` | 58+ | #2a2a2a, #3a3a3a, #111, #303030, #e5e5e5, #ccc, #888 |
| `ChatMessage.module.css` | 50+ | #1668dc, #111, #14141F, #e5e5e5, #303030（消息气泡） |
| `ChatView.module.css` | 10+ | #1e1e1e, #303030（容器背景） |
| `ChatInputBar.module.css` | 10+ | #1e1e1e, #303030, #555（输入框） |
| `GitDiffView.module.css` | 15+ | #0d0d0d, #111, #2a2a2a, #888, #ccc |
| `DiffView.module.css` | 10+ | #14141F, #2a2a3e, #a78bfa |
| `FullFileDiffView.module.css` | 15+ | #0d0d0d, #111, #2a2a2a, #73c991 |
| `FileExplorer.module.css` | 10+ | #111, #2a2a2a, #888, #ccc |
| `FileContentView.module.css` | 10+ | #0d0d0d, #1a3a1a, #4ade80, #2a5a3a |
| `DetailPanel.module.css` | 10+ | #1e1e1e, #303030, #888, #e5e5e5 |
| `ToolApprovalPanel.module.css` | 10+ | 审批 UI 颜色 |
| `TerminalPanel.module.css` | 8+ | 终端配色 |
| `TeamSessionPanel.module.css` | 10+ | #52c41a, #faad14 状态色 |
| 其余 18 个 module.css | 各 5-15 | 各组件局部颜色 |

**JSX 内联样式（约 20+ 处）**:
| 文件 | 说明 |
|------|------|
| `FileExplorer.jsx` | `EXT_COLORS` 文件扩展名颜色映射、Input inline style |
| `AppHeader.jsx` | 按钮 inline style |
| `ChatMessage.jsx` | 头像背景色 `modelInfo.color \|\| '#6b21a8'` |
| `ConceptHelp.jsx` | 内嵌 ConfigProvider 暗色主题 |

**SVG 资源**:
| 文件 | 说明 |
|------|------|
| `src/img/default-avatar.svg` | 硬编码填充色 #231815, #E83A3A, #FFFFFF |
| `src/img/default-model-avatar.svg` | 模型头像 |
| `FileExplorer.jsx` 文件夹图标 | `fill="#c09553"` |

---

## 4. 推荐实施路径

### Phase 1: CSS 变量体系

在 `global.css` 顶部定义 CSS 变量，通过 `[data-theme="dark"]` / `[data-theme="light"]` 切换：

```css
:root, [data-theme="dark"] {
  --bg-base: #0a0a0a;
  --bg-container: #111;
  --bg-elevated: #1e1e1e;
  --bg-surface: #2a2a2a;
  --border-primary: #2a2a2a;
  --border-secondary: #303030;
  --text-primary: #e5e5e5;
  --text-secondary: #ccc;
  --text-tertiary: #888;
  --text-muted: #555;
  /* ...语义色保持不变... */
}

[data-theme="light"] {
  --bg-base: #f5f5f5;
  --bg-container: #ffffff;
  --bg-elevated: #ffffff;
  --bg-surface: #f0f0f0;
  --border-primary: #d9d9d9;
  --border-secondary: #e8e8e8;
  --text-primary: #1f1f1f;
  --text-secondary: #333;
  --text-tertiary: #666;
  --text-muted: #999;
}
```

### Phase 2: Ant Design 主题切换

改造 `AppBase.jsx` 的 `darkThemeConfig` getter：

```jsx
get themeConfig() {
  if (this.state.themeColor === 'light') {
    return {
      algorithm: theme.defaultAlgorithm,
      token: {
        colorPrimary: '#1668dc',
        colorBgContainer: '#ffffff',
        colorBgLayout: '#f5f5f5',
        colorBgElevated: '#ffffff',
        colorBorder: '#d9d9d9',
      },
    };
  }
  return {
    algorithm: theme.darkAlgorithm,
    token: { /* 现有暗色配置 */ },
  };
}
```

同时在 `<body>` 或根元素设置 `data-theme` 属性：
```jsx
document.documentElement.setAttribute('data-theme', this.state.themeColor === 'light' ? 'light' : 'dark');
```

### Phase 3: 逐文件替换硬编码色

按优先级逐个文件将 `#111` → `var(--bg-container)`、`#e5e5e5` → `var(--text-primary)` 等。

建议的变量映射（最常用的 15 个）：

| 硬编码值 | CSS 变量 | 语义 |
|----------|----------|------|
| #0a0a0a | --bg-base | 最底层背景 |
| #111 | --bg-container | 容器/卡片背景 |
| #1e1e1e | --bg-elevated | 弹出层/悬浮背景 |
| #2a2a2a | --bg-surface / --border-primary | 表面/主边框 |
| #303030 | --border-secondary | 次级边框/分割线 |
| #3a3a3a | --border-hover | 悬停态边框 |
| #e5e5e5 | --text-primary | 主文字 |
| #ccc | --text-secondary | 次级文字 |
| #aaa | --text-tertiary-light | 辅助文字(浅) |
| #999 | --text-tertiary | 辅助文字 |
| #888 | --text-muted-light | 弱文字(浅) |
| #666 | --text-muted | 弱文字 |
| #555 | --text-disabled | 禁用态文字 |
| #1668dc | --color-primary | 主色/蓝 |
| #14141F | --bg-code | 代码块背景 |

### Phase 4: 第三方控件适配

按第 2 节的表格逐个处理。

### Phase 5: SVG / 图片适配

- SVG 填充色改为 `currentColor` 或通过 CSS 变量控制
- 考虑为暗底 SVG 提供 light 变体

---

## 5. 注意事项

- `global.css` 中的 `.ant-*` 覆盖样式需特别注意，它们会覆盖 Ant Design 的主题算法输出
- CodeMirror 和 xterm 有各自的主题 API，不能直接用 CSS 变量，需要在 JS 层面切换
- Diff 视图的增/删行颜色（绿/红）在浅色主题下需要降低饱和度，否则过于刺眼
- 终端（xterm）在浅色主题下需要完整的 ANSI 16 色映射
- `react-json-view-lite` 的 `lightStyles` 是单独导出的，需条件 import 或动态选择
