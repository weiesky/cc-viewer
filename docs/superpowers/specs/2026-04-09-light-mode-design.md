# Light Mode Design Spec

## Overview

Add light mode (浅色模式) to cc-viewer. The project already has theme toggle UI and persistence — this spec covers implementing the actual light theme visuals and switching logic.

## Design Decisions

- **Color style**: Cool Blue-Gray (冷灰蓝), similar to GitHub Light
- **CSS approach**: CSS custom properties (variables) with `[data-theme]` selector
- **System preference**: Auto-detect on first visit via `prefers-color-scheme`, user manual choice overrides
- **Transition**: Smooth `0.3s` transitions on `background-color`, `color`, `border-color`
- **Settings UI**: Keep existing "深色 / 浅色" two-option dropdown (no "follow system" option)

## Color Token Map

| CSS Variable | Dark | Light | Usage |
|---|---|---|---|
| `--bg-primary` | `#0d0d0d` | `#f8f9fb` | Page/body background |
| `--bg-secondary` | `#111` | `#f0f2f6` | Sidebar, panels, cards |
| `--bg-elevated` | `#1e1e1e` | `#ffffff` | Modals, dropdowns, elevated surfaces |
| `--bg-code` | `#0d1117` | `#eef0f4` | Code blocks, pre elements |
| `--bg-inline-code` | `#14141F` | `#e8eaf0` | Inline code background |
| `--bg-hover` | `#2a2a2a` | `#e8eaef` | Hover states |
| `--bg-active` | `#303030` | `#dcdfe8` | Active/selected states |
| `--bg-chat-bubble` | `linear-gradient(to top, #222, #303030)` | `linear-gradient(to top, #eef0f4, #f8f9fb)` | Chat message bubbles |
| `--bg-chat-bubble-hover` | `linear-gradient(to top, #303030, #3a3a3a)` | `linear-gradient(to top, #e4e6ec, #eef0f4)` | Chat bubble hover |
| `--bg-table` | `#000` | `#f0f2f6` | Table body background |
| `--bg-table-header` | `#1e1e1e` | `#e8eaef` | Table header background |
| `--bg-assistant` | `#f0f4ff` (existing) | `#edf2ff` | Assistant message highlight |
| `--text-primary` | `#e5e5e5` | `#1a1a2e` | Main text |
| `--text-heading` | `#fff` | `#111827` | Headings |
| `--text-secondary` | `#aaa` | `#5a5d72` | Secondary text |
| `--text-muted` | `#555` | `#8b8fa3` | Muted/disabled text |
| `--text-link` | `#60a5fa` | `#1668dc` | Links |
| `--text-inline-code` | `#aeafff` | `#5b5fc7` | Inline code text |
| `--border-primary` | `#2a2a2a` | `#d8dce5` | Primary borders |
| `--border-secondary` | `#444` | `#c5c9d6` | Stronger borders |
| `--border-subtle` | `#303030` | `#e0e3ea` | Subtle dividers |
| `--border-chat` | `#666` | `#c5c9d6` | Chat bubble borders |
| `--color-primary` | `#1668dc` | `#1668dc` | Primary accent (unchanged) |
| `--color-primary-hover` | `#3b82f6` | `#4088e8` | Primary hover |
| `--selection-bg` | `#264f78` | `#b3d4fc` | Text selection |
| `--scrollbar-thumb` | `#3a3a3a` | `#c5c9d6` | Scrollbar thumb |
| `--scrollbar-track` | `#0d0d0d` | `#f0f2f6` | Scrollbar track |
| `--scrollbar-thumb-hover` | `#555` | `#a0a5b5` | Scrollbar hover |
| `--tooltip-bg` | `#0d0d0d` | `#1a1a2e` | Tooltip background |
| `--popover-arrow` | `#303030` | `#d8dce5` | Popover arrow |
| `--blockquote-color` | `#999` | `#5a5d72` | Blockquote text |
| `--modal-bg` | `#1e1e1e` | `#ffffff` | Modal background |
| `--modal-title` | `#e5e5e5` | `#1a1a2e` | Modal title text |
| `--modal-text` | `#aaa` | `#5a5d72` | Modal body text |
| `--btn-default-bg` | `transparent` | `#ffffff` | Default button bg |
| `--btn-default-border` | `#444` | `#c5c9d6` | Default button border |
| `--btn-default-text` | `#ccc` | `#5a5d72` | Default button text |
| `--btn-default-hover-bg` | `#2a2a2a` | `#f0f2f6` | Default button hover bg |
| `--btn-default-hover-border` | `#666` | `#a0a5b5` | Default button hover border |
| `--btn-default-hover-text` | `#fff` | `#1a1a2e` | Default button hover text |

### Syntax Highlighting (Light)

| Class | Dark | Light |
|---|---|---|
| `.hl-keyword` | `#f87171` | `#c42b2b` |
| `.hl-string` / `.hl-number` | `#7dd3fc` | `#0969da` |
| `.hl-comment` | `#888` | `#6a737d` |
| `.hl-linenum` | `#555` | `#a0a5b5` |
| `.code-highlight` | `#e5e5e5` | `#1a1a2e` |

## Ant Design Theme Config

```javascript
get lightThemeConfig() {
  return {
    algorithm: theme.defaultAlgorithm,
    token: {
      colorPrimary: '#1668dc',
      colorBgContainer: '#ffffff',
      colorBgLayout: '#f8f9fb',
      colorBgElevated: '#ffffff',
      colorBorder: '#d8dce5',
      controlOutline: 'transparent',
      controlOutlineWidth: 0,
    },
  };
}
```

## Implementation Scope

### 1. CSS Variable System (`src/global.css`)

- Define all CSS variables under `[data-theme="dark"]` and `[data-theme="light"]`
- Default to dark (for backwards compatibility)
- Add global transition rule: `*, *::before, *::after { transition: background-color 0.3s, color 0.3s, border-color 0.3s; }`

### 2. Replace Hardcoded Colors (31 CSS files)

All `.module.css` files and `global.css` — replace hardcoded hex colors with `var(--token-name)` references. Files:

- `src/global.css`
- `src/App.module.css`
- `src/components/AppHeader.module.css`
- `src/components/ChatMessage.module.css`
- `src/components/ChatView.module.css`
- `src/components/ChatInputBar.module.css`
- `src/components/ConceptHelp.module.css`
- `src/components/ContextTab.module.css`
- `src/components/DetailPanel.module.css`
- `src/components/DiffView.module.css`
- `src/components/DiffMiniMap.module.css`
- `src/components/FileContentView.module.css`
- `src/components/FileExplorer.module.css`
- `src/components/FullFileDiffView.module.css`
- `src/components/GitChanges.module.css`
- `src/components/GitDiffView.module.css`
- `src/components/ImageLightbox.module.css`
- `src/components/ImageViewer.module.css`
- `src/components/JsonViewer.module.css`
- `src/components/MobileGitDiff.module.css`
- `src/components/MobileStats.module.css`
- `src/components/PanelResizer.module.css`
- `src/components/RequestList.module.css`
- `src/components/RoleFilterBar.module.css`
- `src/components/SnapLineOverlay.module.css`
- `src/components/TeamSessionPanel.module.css`
- `src/components/TerminalPanel.module.css`
- `src/components/ToolApprovalPanel.module.css`
- `src/components/ToolResultView.module.css`
- `src/components/WorkspaceList.module.css`
- `src/components/OpenFolderIcon.module.css`

### 3. JavaScript Changes

**`src/AppBase.jsx`:**
- Add `lightThemeConfig` getter
- Add `get currentThemeConfig()` that returns dark or light config based on `this.state.themeColor`
- On mount: if no saved `themeColor` preference, detect system preference via `matchMedia`
- On `handleThemeColorChange`: set `document.documentElement.dataset.theme` to match
- Set `data-theme` on `<html>` element during initialization

**`src/App.jsx`:**
- Change `<ConfigProvider theme={this.darkThemeConfig}>` to `<ConfigProvider theme={this.currentThemeConfig}>`

**`src/Mobile.jsx`:**
- Same ConfigProvider change as App.jsx

### 4. Third-party Component Theming

- **CodeMirror**: Switch between dark/light extensions based on theme
- **Xterm.js**: Update terminal theme colors based on theme
- **Mermaid**: Switch `mermaid.initialize({ theme: 'dark' | 'default' })`
- **highlight.js**: Syntax colors handled via CSS variables (no JS change needed)

### 5. Non-goals

- No "follow system" option in settings UI (auto-detect is first-visit only)
- No per-session theme override
- No additional theme variants beyond dark/light
