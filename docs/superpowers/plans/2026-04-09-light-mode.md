# Light Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully functional light mode (Cool Blue-Gray) with CSS custom properties, smooth transitions, and system preference auto-detection.

**Architecture:** Define all theme colors as CSS variables on `[data-theme]` selectors in `global.css`. Replace hardcoded hex colors across 31 CSS files with `var()` references. Add `lightThemeConfig` for Ant Design, update third-party libs (CodeMirror, Xterm, Mermaid, highlight.js) to support both themes. Toggle via `document.documentElement.dataset.theme`.

**Tech Stack:** React 18 (class components), Ant Design 5, CSS Modules, CodeMirror 6, Xterm.js, Mermaid, highlight.js

---

## Task 1: Define CSS Variable System in global.css

**Files:**
- Modify: `src/global.css:1-6` (add variable definitions at top)

- [ ] **Step 1: Add CSS variable definitions at the top of global.css**

Insert before the existing `body` rule at line 1:

```css
/* ═══ Theme Variables ═══ */
[data-theme="dark"] {
  --bg-primary: #0d0d0d;
  --bg-secondary: #111;
  --bg-elevated: #1e1e1e;
  --bg-code: #0d1117;
  --bg-inline-code: #14141F;
  --bg-hover: #2a2a2a;
  --bg-active: #303030;
  --bg-table-header: #1e1e1e;
  --bg-table-body: #000;
  --bg-chat-bubble: linear-gradient(to top, #222, #303030);
  --bg-chat-bubble-hover: linear-gradient(to top, #303030, #3a3a3a);
  --bg-input: #1e1e1e;
  --bg-panel: #141414;
  --bg-minimap: #0f0f0f;
  --bg-selected: #532f00;
  --bg-active-item: #1a2332;
  --bg-overlay: #000000bf;
  --bg-overlay-dark: #000000e0;
  --bg-tooltip: #0d0d0d;

  --text-primary: #e5e5e5;
  --text-heading: #fff;
  --text-secondary: #aaa;
  --text-muted: #888;
  --text-dim: #555;
  --text-link: #60a5fa;
  --text-inline-code: #aeafff;
  --text-code: #e5e5e5;
  --text-code-secondary: #e0e0e0;
  --text-label: #a0a0a0;
  --text-on-dark: #ccc;

  --border-primary: #2a2a2a;
  --border-secondary: #444;
  --border-subtle: #303030;
  --border-input: #424242;
  --border-strong: #666;
  --border-dropdown: #3a3a3a;

  --color-primary: #1668dc;
  --color-primary-light: #3b82f6;
  --color-accent: #4a9eff;
  --selection-bg: #264f78;
  --scrollbar-thumb: #3a3a3a;
  --scrollbar-track: #0d0d0d;
  --scrollbar-thumb-hover: #555;
  --popover-arrow: #303030;

  /* Syntax highlighting */
  --hl-keyword: #f87171;
  --hl-string: #7dd3fc;
  --hl-comment: #888;
  --hl-linenum: #555;
  --hl-code: #e5e5e5;

  /* Diff colors */
  --diff-add-bg: #22c55e1d;
  --diff-add-text: #4ade80;
  --diff-del-bg: #ef44441d;
  --diff-del-text: #fca5a5;

  /* Status colors (shared, but some need light adjustment) */
  --file-path-color: #a78bfa;
  --file-path-hover: #c4b5fd;
  --diff-badge: #e2c08d;

  /* Button defaults */
  --btn-default-bg: transparent;
  --btn-default-border: #444;
  --btn-default-text: #ccc;
  --btn-default-hover-bg: #2a2a2a;
  --btn-default-hover-border: #666;
  --btn-default-hover-text: #fff;

  /* White-alpha tints (for overlays on dark bg) */
  --tint-subtle: #ffffff0a;
  --tint-light: #ffffff1a;
  --tint-medium: #ffffff80;
}

[data-theme="light"] {
  --bg-primary: #f8f9fb;
  --bg-secondary: #f0f2f6;
  --bg-elevated: #ffffff;
  --bg-code: #eef0f4;
  --bg-inline-code: #e8eaf0;
  --bg-hover: #e8eaef;
  --bg-active: #dcdfe8;
  --bg-table-header: #e8eaef;
  --bg-table-body: #f0f2f6;
  --bg-chat-bubble: linear-gradient(to top, #eef0f4, #f8f9fb);
  --bg-chat-bubble-hover: linear-gradient(to top, #e4e6ec, #eef0f4);
  --bg-input: #ffffff;
  --bg-panel: #f0f2f6;
  --bg-minimap: #eef0f4;
  --bg-selected: #fff3cd;
  --bg-active-item: #e8f0fe;
  --bg-overlay: #00000040;
  --bg-overlay-dark: #00000060;
  --bg-tooltip: #1a1a2e;

  --text-primary: #1a1a2e;
  --text-heading: #111827;
  --text-secondary: #5a5d72;
  --text-muted: #8b8fa3;
  --text-dim: #a0a5b5;
  --text-link: #1668dc;
  --text-inline-code: #5b5fc7;
  --text-code: #1a1a2e;
  --text-code-secondary: #333;
  --text-label: #5a5d72;
  --text-on-dark: #5a5d72;

  --border-primary: #d8dce5;
  --border-secondary: #c5c9d6;
  --border-subtle: #e0e3ea;
  --border-input: #c5c9d6;
  --border-strong: #a0a5b5;
  --border-dropdown: #d8dce5;

  --color-primary: #1668dc;
  --color-primary-light: #4088e8;
  --color-accent: #1668dc;
  --selection-bg: #b3d4fc;
  --scrollbar-thumb: #c5c9d6;
  --scrollbar-track: #f0f2f6;
  --scrollbar-thumb-hover: #a0a5b5;
  --popover-arrow: #d8dce5;

  /* Syntax highlighting */
  --hl-keyword: #c42b2b;
  --hl-string: #0969da;
  --hl-comment: #6a737d;
  --hl-linenum: #a0a5b5;
  --hl-code: #1a1a2e;

  /* Diff colors */
  --diff-add-bg: #dafbe1;
  --diff-add-text: #116329;
  --diff-del-bg: #ffebe9;
  --diff-del-text: #82071e;

  /* Status colors */
  --file-path-color: #7c3aed;
  --file-path-hover: #6d28d9;
  --diff-badge: #92700c;

  /* Button defaults */
  --btn-default-bg: #ffffff;
  --btn-default-border: #c5c9d6;
  --btn-default-text: #5a5d72;
  --btn-default-hover-bg: #f0f2f6;
  --btn-default-hover-border: #a0a5b5;
  --btn-default-hover-text: #1a1a2e;

  /* Dark-alpha tints (for overlays on light bg) */
  --tint-subtle: #0000000a;
  --tint-light: #00000012;
  --tint-medium: #00000040;
}
```

- [ ] **Step 2: Verify dark theme still looks correct**

Run: `npm run build`

Open the app — since no `data-theme` attribute is set yet, nothing should change (we'll wire that up in Task 2).

- [ ] **Step 3: Commit**

```bash
git add src/global.css
git commit -m "feat: add CSS variable definitions for dark/light themes"
```

---

## Task 2: Wire Theme Switching in JavaScript

**Files:**
- Modify: `src/AppBase.jsx:61,192-233,1194-1201,1647-1661`
- Modify: `src/App.jsx:260`
- Modify: `src/Mobile.jsx:241,252,322,388,397,423`

- [ ] **Step 1: Add lightThemeConfig and currentThemeConfig to AppBase.jsx**

After the existing `darkThemeConfig` getter (line 1661), add:

```javascript
  /** Ant Design 浅色主题配置 */
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

  /** 根据当前 themeColor 返回对应主题配置 */
  get currentThemeConfig() {
    return this.state.themeColor === 'light' ? this.lightThemeConfig : this.darkThemeConfig;
  }
```

- [ ] **Step 2: Add data-theme attribute setting to handleThemeColorChange**

Replace `handleThemeColorChange` (lines 1194-1201) with:

```javascript
  handleThemeColorChange = (value) => {
    this.setState({ themeColor: value });
    document.documentElement.dataset.theme = value;
    fetch(apiUrl('/api/preferences'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeColor: value }),
    }).catch(() => { });
  };
```

- [ ] **Step 3: Add system preference detection and initial data-theme in componentDidMount**

In componentDidMount, after the themeColor preference is loaded (line 222-224), update to:

```javascript
        if (data.themeColor) {
          this.setState({ themeColor: data.themeColor });
          document.documentElement.dataset.theme = data.themeColor;
        } else {
          // First visit: auto-detect system preference
          const preferLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
          const detected = preferLight ? 'light' : 'dark';
          this.setState({ themeColor: detected });
          document.documentElement.dataset.theme = detected;
        }
```

Also, set the default data-theme at the very start of componentDidMount (before any async calls):

```javascript
    // Set default theme attribute immediately to prevent flash
    document.documentElement.dataset.theme = this.state.themeColor;
```

- [ ] **Step 4: Update App.jsx to use currentThemeConfig**

In `src/App.jsx` line 260, change:
```javascript
<ConfigProvider theme={this.darkThemeConfig}>
```
to:
```javascript
<ConfigProvider theme={this.currentThemeConfig}>
```

Also in `renderWorkspaceMode()` wherever `darkThemeConfig` is used, change to `currentThemeConfig`.

- [ ] **Step 5: Update Mobile.jsx to use currentThemeConfig**

In `src/Mobile.jsx`, change all three `this.darkThemeConfig` references (lines 322, 423, and any others) to `this.currentThemeConfig`.

Also replace inline hardcoded colors with theme-aware values. Lines 241, 252:
```javascript
style={{ color: this.state.mobileGitDiffVisible ? 'var(--text-heading)' : 'var(--text-muted)', fontSize: 12 }}
```
```javascript
style={{ color: this.state.mobileTerminalVisible ? 'var(--text-heading)' : 'var(--text-muted)', fontSize: 12 }}
```

Lines 388, 397 — replace `{ color: '#666', borderColor: '#333' }` with:
```javascript
{ color: 'var(--text-dim)', borderColor: 'var(--border-subtle)' }
```

- [ ] **Step 6: Add global transition rule to global.css**

Add after the variable definitions, before the `body` rule:

```css
/* Theme transition */
*, *::before, *::after {
  transition: background-color 0.3s, color 0.3s, border-color 0.3s;
}
/* Disable transition for elements that need instant response */
.cm-editor *, .xterm *, .mermaid-diagram * {
  transition: none !important;
}
```

- [ ] **Step 7: Build and verify switching works**

Run: `npm run build`

Verify: Open app, change theme in settings — Ant Design components should switch. CSS variable-based colors will switch once we migrate them in subsequent tasks.

- [ ] **Step 8: Commit**

```bash
git add src/AppBase.jsx src/App.jsx src/Mobile.jsx src/global.css
git commit -m "feat: wire theme switching logic with light/dark ConfigProvider"
```

---

## Task 3: Migrate global.css to CSS Variables

**Files:**
- Modify: `src/global.css` (all hardcoded colors)

- [ ] **Step 1: Replace all hardcoded colors in global.css with var() references**

Apply these replacements throughout `global.css` (after the variable definitions block):

| Original | Replacement |
|----------|------------|
| `background-color: #0d0d0d` | `background-color: var(--bg-primary)` |
| `background-color: #264f78` | `background-color: var(--selection-bg)` |
| `scrollbar-color: #3a3a3a #0d0d0d` | `scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track)` |
| `background: #0d0d0d` (scrollbar track) | `background: var(--scrollbar-track)` |
| `background: #3a3a3a` (scrollbar thumb) | `background: var(--scrollbar-thumb)` |
| `background: #555` (scrollbar hover) | `background: var(--scrollbar-thumb-hover)` |
| `.code-highlight color: #e5e5e5` | `color: var(--hl-code)` |
| `.hl-keyword color: #f87171` | `color: var(--hl-keyword)` |
| `.hl-string color: #7dd3fc` | `color: var(--hl-string)` |
| `.hl-comment color: #888` | `color: var(--hl-comment)` |
| `.hl-number color: #7dd3fc` | `color: var(--hl-string)` |
| `.hl-linenum color: #555` | `color: var(--hl-linenum)` |
| `background: #0d1117` (pre, mermaid) | `background: var(--bg-code)` |
| `border: 1px solid #2a2a2a` | `border: 1px solid var(--border-primary)` |
| `background: #14141F` (inline code) | `background: var(--bg-inline-code)` |
| `color: #aeafff` (inline code) | `color: var(--text-inline-code)` |
| `color: #fff` (headings) | `color: var(--text-heading)` |
| `border-left: 3px solid #3b82f6` | `border-left: 3px solid var(--color-primary-light)` |
| `color: #999` (blockquote) | `color: var(--text-secondary)` |
| `border: 1px solid #6b7280` | `border: 1px solid var(--border-strong)` |
| `background: #1e1e1e` (th) | `background: var(--bg-table-header)` |
| `color: #60a5fa` (links) | `color: var(--text-link)` |
| `border-top: 1px solid #2a2a2a` (hr) | `border-top: 1px solid var(--border-primary)` |
| `color: #e5e5e5` (strong, em) | `color: var(--text-primary)` |
| chat-boxer `background: linear-gradient(...)` | `background: var(--bg-chat-bubble)` |
| chat-boxer hover gradient | `background: var(--bg-chat-bubble-hover)` |
| chat-boxer `color: #fff` | `color: var(--text-heading)` |
| chat-boxer `border: 1px solid #666` | `border: 1px solid var(--border-strong)` |
| `.chat-boxer .chat-md tbody background: #000` | `background: var(--bg-table-body)` |
| `border: 1px solid #3a3a3a` (dropdowns) | `border: 1px solid var(--border-dropdown)` |
| `background-color: #0d0d0d` (tooltip) | `background-color: var(--bg-tooltip)` |
| `background: #0d0d0d` (tooltip arrow) | `background: var(--bg-tooltip)` |
| `background: #303030` (popover arrow) | `background: var(--popover-arrow)` |
| Modal `.ant-modal-content background: #1e1e1e` | `background-color: var(--bg-elevated)` |
| Modal border `#2a2a2a` | `var(--border-primary)` |
| Modal title `#e5e5e5` | `var(--text-primary)` |
| Modal content `#aaa` | `var(--text-secondary)` |
| Modal `.ant-btn-default` bg `#00000000` | `var(--btn-default-bg)` |
| Modal btn border `#444` | `var(--btn-default-border)` |
| Modal btn text `#ccc` | `var(--btn-default-text)` |
| Modal btn hover bg `#2a2a2a` | `var(--btn-default-hover-bg)` |
| Modal btn hover border `#666` | `var(--btn-default-hover-border)` |
| Modal btn hover text `#fff` | `var(--btn-default-hover-text)` |

- [ ] **Step 2: Build and verify**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/global.css
git commit -m "feat: migrate global.css colors to CSS variables"
```

---

## Task 4: Migrate Core Layout CSS Files

**Files:**
- Modify: `src/App.module.css`
- Modify: `src/components/AppHeader.module.css`
- Modify: `src/components/PanelResizer.module.css`
- Modify: `src/components/WorkspaceList.module.css`

- [ ] **Step 1: Migrate App.module.css**

Replace hardcoded colors using the variable mapping. Key replacements:
- `#1e1e1e` → `var(--bg-elevated)`
- `#2a2a2a` → `var(--border-primary)`
- `#0d0d0d` → `var(--bg-primary)`
- `#999` → `var(--text-muted)`
- `#555` → `var(--text-dim)`
- `#3b82f6` → `var(--color-primary-light)`
- `#000000bf` → `var(--bg-overlay)`
- `#e5e5e5` → `var(--text-primary)`
- `#888` → `var(--text-muted)`
- `#111` → `var(--bg-secondary)`
- `#aaa` → `var(--text-secondary)`
- `#60a5fa` → `var(--text-link)`
- `#ffffff1a` → `var(--tint-light)`
- `#ffffff0a` → `var(--tint-subtle)`
- `#4a9eff` → `var(--color-accent)`
- `#303030` → `var(--border-subtle)`
- `#ccc` → `var(--text-on-dark)`
- `#000000e0` → `var(--bg-overlay-dark)`

- [ ] **Step 2: Migrate AppHeader.module.css**

Same mapping as above, plus:
- `#3a3a3a` → `var(--border-dropdown)`
- `#333` → `var(--border-subtle)` (where used as border/bg)

- [ ] **Step 3: Migrate PanelResizer.module.css**

- `#1e1e1e` → `var(--bg-elevated)`
- `#3b82f6` → `var(--color-primary-light)`

- [ ] **Step 4: Migrate WorkspaceList.module.css**

- `#0d0d0d` → `var(--bg-primary)`
- `#e5e5e5` → `var(--text-primary)`
- `#1668dc` → `var(--color-primary)`
- `#111` → `var(--bg-secondary)`
- `#2a2a2a` → `var(--border-primary)`
- `#666` → `var(--text-dim)` (where used as text)

- [ ] **Step 5: Build and verify**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/App.module.css src/components/AppHeader.module.css src/components/PanelResizer.module.css src/components/WorkspaceList.module.css
git commit -m "feat: migrate core layout CSS to theme variables"
```

---

## Task 5: Migrate Chat Component CSS Files

**Files:**
- Modify: `src/components/ChatMessage.module.css`
- Modify: `src/components/ChatView.module.css`
- Modify: `src/components/ChatInputBar.module.css`
- Modify: `src/components/RoleFilterBar.module.css`
- Modify: `src/components/ConceptHelp.module.css`

- [ ] **Step 1: Migrate ChatMessage.module.css**

Key replacements:
- `#303030` → `var(--border-subtle)`
- `#e5e5e5` → `var(--text-primary)`
- `#4a9eff` → `var(--color-accent)`
- `#60a5fa` → `var(--text-link)`
- `#111` → `var(--bg-secondary)`
- `#1668dc` → `var(--color-primary)`
- `#14141F` → `var(--bg-inline-code)`
- Note: Keep status badge colors (#22c55e, #ef4444, #f59e0b) as-is — they're semantic, not theme-dependent.
- Green selection colors (#1a3a1a, #2ea043) — keep as-is (approval state, not theme).

- [ ] **Step 2: Migrate ChatView.module.css**

- `#1e1e1e` → `var(--bg-elevated)`
- `#2a2a2a` → `var(--border-primary)`
- `#555` → `var(--text-dim)`
- `#999` → `var(--text-muted)`
- `#ffffff0a` → `var(--tint-subtle)`
- `#00000080` → `var(--bg-overlay)`

- [ ] **Step 3: Migrate ChatInputBar.module.css**

- `#00000080` → `var(--bg-overlay)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#303030` → `var(--border-subtle)`
- `#555` → `var(--text-dim)`
- `#e5e5e5` → `var(--text-primary)`
- `#444` → `var(--border-secondary)`
- `#888` → `var(--text-muted)`
- `#ccc` → `var(--text-on-dark)`

- [ ] **Step 4: Migrate RoleFilterBar.module.css**

- `#1e1e1e` → `var(--bg-elevated)`
- `#303030` → `var(--border-subtle)`
- `#888` → `var(--text-muted)`
- `#ccc` → `var(--text-on-dark)`
- `#4a9eff` → `var(--color-accent)`

- [ ] **Step 5: Migrate ConceptHelp.module.css**

- `#1e1e1e` → `var(--bg-elevated)`
- `#444` → `var(--border-secondary)`
- `#aaa` → `var(--text-secondary)`
- `#303030` → `var(--border-subtle)` / `var(--bg-active)`
- `#e5e5e5` → `var(--text-primary)`
- `#2a2a2a` → `var(--border-primary)`
- `#e06c75` → keep (code accent, theme-independent)

- [ ] **Step 6: Build and verify**

Run: `npm run build`

- [ ] **Step 7: Commit**

```bash
git add src/components/ChatMessage.module.css src/components/ChatView.module.css src/components/ChatInputBar.module.css src/components/RoleFilterBar.module.css src/components/ConceptHelp.module.css
git commit -m "feat: migrate chat component CSS to theme variables"
```

---

## Task 6: Migrate Code/Diff View CSS Files

**Files:**
- Modify: `src/components/DiffView.module.css`
- Modify: `src/components/FullFileDiffView.module.css`
- Modify: `src/components/GitDiffView.module.css`
- Modify: `src/components/GitChanges.module.css`
- Modify: `src/components/MobileGitDiff.module.css`
- Modify: `src/components/DiffMiniMap.module.css`
- Modify: `src/components/FileContentView.module.css`
- Modify: `src/components/FileExplorer.module.css`

- [ ] **Step 1: Migrate DiffView.module.css**

- `#14141F` → `var(--bg-inline-code)`
- `#2a2a3e` → `var(--border-primary)` (adjust as border)
- `#a78bfa` → `var(--file-path-color)`
- `#c4b5fd` → `var(--file-path-hover)`
- `#6b7280` → `var(--text-muted)`
- `#111` → `var(--bg-secondary)`
- `#303030` → `var(--border-subtle)`
- `#888` → `var(--text-muted)`
- `#ef44441d` → `var(--diff-del-bg)`
- `#22c55e1d` → `var(--diff-add-bg)`
- `#fca5a5` → `var(--diff-del-text)`
- `#4ade80` → `var(--diff-add-text)`
- `#555` → `var(--text-dim)`

- [ ] **Step 2: Migrate FullFileDiffView.module.css**

- `#111` → `var(--bg-secondary)`
- `#2a2a2a` → `var(--border-primary)`
- `#73c991` → `var(--diff-add-text)`
- `#73c99126` → `var(--diff-add-bg)`
- `#ef4444` → `var(--diff-del-text)` (where text) / keep as-is (where semantic red)
- `#ef444426` → `var(--diff-del-bg)`
- `#555` → `var(--text-dim)`

- [ ] **Step 3: Migrate GitDiffView.module.css**

- `#111` → `var(--bg-secondary)`
- `#888` → `var(--text-muted)`
- `#ccc` → `var(--text-on-dark)`
- `#7dd3fc` → `var(--hl-string)`
- `#e2c08d` → `var(--diff-badge)`

- [ ] **Step 4: Migrate GitChanges.module.css**

- `#111` → `var(--bg-secondary)`
- `#2a2a2a` → `var(--border-primary)`
- `#532f00` → `var(--bg-selected)`
- `#333` → `var(--border-subtle)` (as hover bg)

- [ ] **Step 5: Migrate MobileGitDiff.module.css**

- `#111` → `var(--bg-secondary)`
- `#2a2a2a` → `var(--border-primary)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#4a9eff26` → adjust to use `color-mix(in srgb, var(--color-accent) 15%, transparent)` or keep and add light variant
- `#e2c08d` → `var(--diff-badge)`

- [ ] **Step 6: Migrate DiffMiniMap.module.css, FileContentView.module.css, FileExplorer.module.css**

Same mapping pattern. Key:
- FileExplorer: `#532f00` → `var(--bg-selected)`, `#4a9eff` → `var(--color-accent)`
- FileContentView: `#1a3a1a` → keep (approval green), `#111` → `var(--bg-secondary)`, `#666` → `var(--text-dim)`, `#ccc` → `var(--text-on-dark)`, `#e06c75` → keep, `#4a9eff` → `var(--color-accent)`, `#303030` → `var(--border-subtle)`

- [ ] **Step 7: Build and verify**

Run: `npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/components/DiffView.module.css src/components/FullFileDiffView.module.css src/components/GitDiffView.module.css src/components/GitChanges.module.css src/components/MobileGitDiff.module.css src/components/DiffMiniMap.module.css src/components/FileContentView.module.css src/components/FileExplorer.module.css
git commit -m "feat: migrate code/diff view CSS to theme variables"
```

---

## Task 7: Migrate Panel & Utility CSS Files

**Files:**
- Modify: `src/components/DetailPanel.module.css`
- Modify: `src/components/TerminalPanel.module.css`
- Modify: `src/components/ToolApprovalPanel.module.css`
- Modify: `src/components/ToolResultView.module.css`
- Modify: `src/components/TeamSessionPanel.module.css`
- Modify: `src/components/ContextTab.module.css`
- Modify: `src/components/RequestList.module.css`

- [ ] **Step 1: Migrate DetailPanel.module.css**

- `#1e1e1e` → `var(--bg-elevated)`
- `#303030` → `var(--border-subtle)`
- `#888` → `var(--text-muted)`
- `#e5e5e5` → `var(--text-primary)`
- Note: Keep `#d97757` and `#22c55e` as-is (semantic: cache read/write colors).

- [ ] **Step 2: Migrate TerminalPanel.module.css**

- `#3a3a3a` → `var(--border-dropdown)`
- `#333` → `var(--border-subtle)`
- `#e5e5e5` → `var(--text-primary)`
- `#ccc` → `var(--text-on-dark)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#2a2a2a` → `var(--border-primary)`
- `#2a5a3a` → keep (team preset, semantic)

- [ ] **Step 3: Migrate ToolApprovalPanel.module.css**

- `#1e1e1e` → `var(--bg-elevated)`
- Note: Keep `#fbbf24`, `#22c55e`, `#ef4444` (semantic status colors).

- [ ] **Step 4: Migrate ToolResultView.module.css**

- `#111` → `var(--bg-secondary)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#e5e5e5` → `var(--text-primary)`
- `#888` → `var(--text-muted)`

- [ ] **Step 5: Migrate TeamSessionPanel.module.css**

- `#2a2a2a` → `var(--border-primary)`
- `#e5e5e5` → `var(--text-primary)`
- `#ccc` → `var(--text-on-dark)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#303030` → `var(--border-subtle)`
- `#060f2a`, `#0b2a5c` → keep (team-specific brand colors)
- `#4a9eff` → `var(--color-accent)`
- Keep `#f59e0b` (spinner, semantic).

- [ ] **Step 6: Migrate ContextTab.module.css and RequestList.module.css**

ContextTab:
- `#2a2a2a` → `var(--border-primary)`
- `#e5e5e5` → `var(--text-primary)`
- `#666` → `var(--text-dim)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#888` → `var(--text-muted)`
- `#1668dc26` → use `color-mix(in srgb, var(--color-primary) 15%, transparent)` or keep
- `#1668dc` → `var(--color-primary)`

RequestList:
- `#111` → `var(--bg-secondary)`
- `#1a2332` → `var(--bg-active-item)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#3b82f6` → `var(--color-primary-light)`
- `#888` → `var(--text-muted)`
- `#6b7280` → `var(--text-muted)`
- Keep `#d97757`, `#ef4444`, `#22c55e` (semantic status).

- [ ] **Step 7: Build and verify**

Run: `npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/components/DetailPanel.module.css src/components/TerminalPanel.module.css src/components/ToolApprovalPanel.module.css src/components/ToolResultView.module.css src/components/TeamSessionPanel.module.css src/components/ContextTab.module.css src/components/RequestList.module.css
git commit -m "feat: migrate panel & utility CSS to theme variables"
```

---

## Task 8: Migrate Remaining CSS Files

**Files:**
- Modify: `src/components/JsonViewer.module.css`
- Modify: `src/components/ImageLightbox.module.css`
- Modify: `src/components/ImageViewer.module.css`
- Modify: `src/components/MobileStats.module.css`
- Modify: `src/components/SnapLineOverlay.module.css`
- Modify: `src/components/OpenFolderIcon.module.css`

- [ ] **Step 1: Migrate all remaining CSS files**

JsonViewer:
- `#111` → `var(--bg-secondary)`
- `#2a2a2a` → `var(--border-primary)`

ImageLightbox:
- `#000000e0` → `var(--bg-overlay-dark)`
- `#00000080` → `var(--bg-overlay)`
- `#ffffff1a` → `var(--tint-light)`
- `#ffffffb3` → keep (spinner accent on overlay)

ImageViewer:
- `#111` → `var(--bg-secondary)`
- `#2a2a2a` → `var(--border-primary)`
- `#666` → `var(--text-dim)`
- `#ccc` → `var(--text-on-dark)`
- `#1e1e1e` → `var(--bg-elevated)`
- `#222` → `var(--bg-hover)` (checkerboard)
- `#888` → `var(--text-muted)`

MobileStats:
- `#2a2a2a` → `var(--border-primary)`
- `#ccc` → `var(--text-on-dark)`
- `#999` → `var(--text-muted)`

SnapLineOverlay:
- `#ffffff1a` → `var(--tint-light)`
- `#ffffff80` → `var(--tint-medium)`

OpenFolderIcon: Check for any hardcoded colors and replace.

- [ ] **Step 2: Build and verify**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/JsonViewer.module.css src/components/ImageLightbox.module.css src/components/ImageViewer.module.css src/components/MobileStats.module.css src/components/SnapLineOverlay.module.css src/components/OpenFolderIcon.module.css
git commit -m "feat: migrate remaining component CSS to theme variables"
```

---

## Task 9: Theme Third-Party Libraries

**Files:**
- Modify: `src/components/FileContentView.jsx:70-271`
- Modify: `src/components/TerminalPanel.jsx:148-166`
- Modify: `src/hooks/useMermaidRender.js:13-38`
- Modify: `src/components/FullFileDiffView.jsx:24`

- [ ] **Step 1: Add light theme to CodeMirror (FileContentView.jsx)**

The current `darkTheme` (line 70) and `darkHighlightStyle` (line 252) are module-level constants. Add parallel light versions:

After `darkTheme` (line 249), add:

```javascript
const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-primary)',
    color: '#333',
    height: '100%',
    overflow: 'visible',
  },
  '.cm-gutters:not(.cm-minimap-gutter)': {
    display: 'none',
  },
  '& .cm-scroller': {
    position: 'absolute',
    inset: '0',
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
    fontSize: '13px',
    lineHeight: '1.5',
  },
  '.cm-minimap-gutter': {
    background: '#eef0f4',
    borderLeft: '1px solid #d8dce5',
  },
  '.cm-minimap-overlay': {
    border: '1px solid rgba(22, 104, 220, 0.6)',
    background: 'rgba(22, 104, 220, 0.15)',
    borderRadius: '2px',
    transition: 'opacity 0.2s ease',
  },
  '.cm-minimap-gutter:hover .cm-minimap-overlay': {
    border: '1px solid rgba(22, 104, 220, 0.8)',
    background: 'rgba(22, 104, 220, 0.2)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  '.cm-cursor': {
    borderLeftColor: '#333',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#b3d4fc',
  },
  '.cm-panels': {
    backgroundColor: '#f0f2f6',
    borderBottom: '1px solid #d8dce5',
  },
  '.cm-panel.cm-search': {
    padding: '8px 12px 10px',
    fontSize: '13px',
    color: '#333',
    backgroundColor: '#f0f2f6',
  },
  '.cm-panel.cm-search input[type=text], .cm-panel.cm-search input[main]': {
    height: '26px',
    padding: '2px 11px',
    fontSize: '100%',
    color: '#333',
    backgroundColor: '#ffffff',
    border: '1px solid #c5c9d6',
    borderRadius: '6px',
    outline: 'none',
    transition: 'border-color 0.2s',
    verticalAlign: 'middle',
    boxSizing: 'border-box',
  },
  '.cm-panel.cm-search input[type=text]:focus': {
    borderColor: '#1668dc',
    boxShadow: '0 0 0 2px rgba(22, 104, 220, 0.15)',
  },
  '.cm-textfield': {
    height: '26px',
    padding: '2px 11px',
    fontSize: '100%',
    color: '#333 !important',
    backgroundColor: '#ffffff !important',
    border: '1px solid #c5c9d6 !important',
    borderRadius: '6px',
    outline: 'none',
    verticalAlign: 'middle',
    boxSizing: 'border-box',
  },
  '.cm-textfield:focus': {
    borderColor: '#1668dc !important',
    boxShadow: '0 0 0 2px rgba(22, 104, 220, 0.15)',
  },
  '.cm-panel.cm-search input[type=checkbox]': {
    accentColor: '#1668dc',
    width: '14px',
    height: '14px',
    verticalAlign: 'middle',
    marginRight: '4px',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search button': {
    height: '26px',
    padding: '2px 12px',
    fontSize: '100%',
    color: '#333',
    backgroundColor: 'transparent',
    backgroundImage: 'none !important',
    border: '1px solid #c5c9d6',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background 0.2s, border-color 0.2s, color 0.2s',
    verticalAlign: 'middle',
    lineHeight: '1',
  },
  '.cm-panel.cm-search button:hover': {
    color: '#1a1a2e',
    backgroundColor: '#e8eaef',
    backgroundImage: 'none !important',
    borderColor: '#a0a5b5',
  },
  '.cm-panel.cm-search button:active': {
    backgroundColor: '#dcdfe8',
    backgroundImage: 'none !important',
  },
  '.cm-button': {
    height: '26px',
    padding: '2px 12px',
    fontSize: '100%',
    color: '#333 !important',
    backgroundColor: 'transparent !important',
    backgroundImage: 'none !important',
    border: '1px solid #c5c9d6 !important',
    borderRadius: '6px',
    cursor: 'pointer',
    lineHeight: '1',
  },
  '.cm-button:hover': {
    color: '#1a1a2e !important',
    backgroundColor: '#e8eaef !important',
    backgroundImage: 'none !important',
    borderColor: '#a0a5b5 !important',
  },
  '.cm-panel.cm-search button[name=close]': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '28px',
    height: '28px',
    padding: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    color: '#8b8fa3',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
  },
  '.cm-panel.cm-search button[name=close]:hover': {
    color: '#1a1a2e',
    backgroundColor: '#e8eaef',
  },
  '.cm-panel.cm-search label': {
    fontSize: '13px',
    color: '#5a5d72',
    verticalAlign: 'middle',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search label:hover': {
    color: '#1a1a2e',
  },
  '.cm-panel.cm-search [name=close]': {
    fontSize: '16px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255, 213, 79, 0.35)',
    outline: '1px solid rgba(255, 213, 79, 0.5)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'rgba(255, 152, 0, 0.4)',
  },
}, { dark: false });

const lightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#cf222e' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#953800' },
  { tag: [t.function(t.variableName), t.labelName], color: '#8250df' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#0550ae' },
  { tag: [t.definition(t.name), t.separator], color: '#333' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#953800' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#0550ae' },
  { tag: [t.meta, t.comment], color: '#6e7781', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#0550ae', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#953800' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#0550ae' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#0a3069' },
  { tag: t.invalid, color: '#82071e' },
]);

const lightSyntaxTheme = syntaxHighlighting(lightHighlightStyle);
```

Then update the component to accept `themeColor` prop and select theme accordingly. In the component function signature, add `themeColor` to destructured props. In the `extensions` useMemo, select based on `themeColor`:

```javascript
const editorTheme = themeColor === 'light' ? lightTheme : darkTheme;
const editorSyntax = themeColor === 'light' ? lightSyntaxTheme : syntaxTheme;
```

Use `editorTheme` and `editorSyntax` in the extensions array instead of the hardcoded dark ones.

- [ ] **Step 2: Pass themeColor prop to FileContentView**

In whatever parent renders `<FileContentView>`, pass `themeColor={this.state.themeColor}`. Search for `<FileContentView` usage in App.jsx and Mobile.jsx and add the prop.

- [ ] **Step 3: Add light theme to Xterm (TerminalPanel.jsx)**

The terminal is initialized in `initTerminal()` (line 148). Update the theme to be dynamic based on a prop. Add `themeColor` to the component's props. Update the theme object:

```javascript
const isDark = this.props.themeColor !== 'light';
this.terminal = new Terminal({
  cursorBlink: false,
  cursorStyle: 'bar',
  cursorWidth: 1,
  cursorInactiveStyle: 'none',
  fontSize: isMobile ? 11 : 13,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: isDark ? {
    background: '#0a0a0a',
    foreground: '#d4d4d4',
    cursor: '#0a0a0a',
    selectionBackground: '#264f78',
  } : {
    background: '#f8f9fb',
    foreground: '#1a1a2e',
    cursor: '#1a1a2e',
    selectionBackground: '#b3d4fc',
  },
  // ... rest unchanged
});
```

Also add a `componentDidUpdate` check: if `themeColor` prop changes, update the terminal theme via `this.terminal.options.theme = { ... }`.

Pass `themeColor={this.state.themeColor}` from App.jsx / Mobile.jsx to TerminalPanel.

- [ ] **Step 4: Add light theme to Mermaid (useMermaidRender.js)**

Mermaid is lazily loaded and initialized once. We need to re-initialize when theme changes. Update the hook to accept theme and re-init:

Replace `loadMermaid()` to accept a theme parameter:

```javascript
let _currentTheme = 'dark';

function loadMermaid(isDark = true) {
  const newTheme = isDark ? 'dark' : 'default';
  if (_mermaidPromise && _currentTheme === newTheme) return _mermaidPromise;
  _currentTheme = newTheme;
  _mermaidPromise = import('mermaid').then(mod => {
    const m = mod.default;
    m.initialize({
      startOnLoad: false,
      theme: newTheme,
      darkMode: isDark,
      securityLevel: 'strict',
      flowchart: { useMaxWidth: true },
      themeVariables: isDark ? {
        darkMode: true,
        background: '#0d1117',
        primaryColor: '#1a3a5c',
        primaryTextColor: '#c9d1d9',
        primaryBorderColor: '#30363d',
        lineColor: '#58a6ff',
        secondaryColor: '#161b22',
        tertiaryColor: '#0d1117',
        nodeTextColor: '#c9d1d9',
        edgeLabelBackground: '#0d1117',
      } : {
        darkMode: false,
        background: '#ffffff',
        primaryColor: '#d0e2ff',
        primaryTextColor: '#1a1a2e',
        primaryBorderColor: '#d8dce5',
        lineColor: '#1668dc',
        secondaryColor: '#f0f2f6',
        tertiaryColor: '#ffffff',
        nodeTextColor: '#1a1a2e',
        edgeLabelBackground: '#ffffff',
      },
    });
    return m;
  }).catch(() => { _mermaidPromise = null; return null; });
  return _mermaidPromise;
}
```

Update `renderMermaidIn` to read the current theme from `document.documentElement.dataset.theme`:

```javascript
const isDark = document.documentElement.dataset.theme !== 'light';
const m = await loadMermaid(isDark);
```

- [ ] **Step 5: Handle highlight.js theme (FullFileDiffView.jsx)**

Line 24 imports `'highlight.js/styles/github-dark.css'`. For light mode, we need both stylesheets and toggle. The simplest approach: import both and use `data-theme` scoping.

Replace line 24:
```javascript
import 'highlight.js/styles/github-dark.css';
```

With both imports — but since highlight.js CSS applies globally, we need to scope them. Create a wrapper approach: import both CSS files and use `[data-theme]` overrides in global.css.

Actually, the simplest approach: keep `github-dark.css` import, and add overrides for `[data-theme="light"]` in global.css that switch hljs token colors. Add to global.css:

```css
[data-theme="light"] .hljs {
  color: #1a1a2e;
  background: var(--bg-code);
}
[data-theme="light"] .hljs-keyword,
[data-theme="light"] .hljs-selector-tag,
[data-theme="light"] .hljs-type { color: #cf222e; }
[data-theme="light"] .hljs-string,
[data-theme="light"] .hljs-attr,
[data-theme="light"] .hljs-literal { color: #0a3069; }
[data-theme="light"] .hljs-number { color: #0550ae; }
[data-theme="light"] .hljs-comment { color: #6e7781; }
[data-theme="light"] .hljs-function .hljs-title,
[data-theme="light"] .hljs-title.function_ { color: #8250df; }
[data-theme="light"] .hljs-name,
[data-theme="light"] .hljs-variable,
[data-theme="light"] .hljs-property { color: #953800; }
[data-theme="light"] .hljs-built_in { color: #0550ae; }
```

- [ ] **Step 6: Build and verify all third-party theming**

Run: `npm run build`

Verify: Switch theme and check CodeMirror editor, terminal, mermaid diagrams, and syntax-highlighted diffs all adapt.

- [ ] **Step 7: Commit**

```bash
git add src/components/FileContentView.jsx src/components/TerminalPanel.jsx src/hooks/useMermaidRender.js src/global.css
git commit -m "feat: add light theme support for CodeMirror, Xterm, Mermaid, highlight.js"
```

---

## Task 10: Build, Test & Final Verification

**Files:**
- Possibly adjust any CSS files if visual bugs found

- [ ] **Step 1: Run build**

```bash
npm run build
```

- [ ] **Step 2: Run tests**

```bash
npm run test
```

- [ ] **Step 3: Visual verification checklist**

Open the app and switch between dark/light mode. Verify each area:
- [ ] Header / navigation
- [ ] Session list (left panel)
- [ ] Chat messages (assistant + user bubbles)
- [ ] Code blocks in chat
- [ ] Diff views (inline + full file)
- [ ] File explorer
- [ ] Terminal panel
- [ ] Settings drawer
- [ ] Mobile view
- [ ] Mermaid diagrams
- [ ] Scrollbars
- [ ] Modals / tooltips / popovers
- [ ] Transition animation (smooth 0.3s)

- [ ] **Step 4: Fix any visual issues found**

Address any remaining hardcoded colors or contrast issues.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: polish light mode visual issues"
```

---

## Task 11: Update history.md

**Files:**
- Modify: `history.md`

- [ ] **Step 1: Add light mode entry to history.md**

Add a new entry for this feature at the top of the changelog.

- [ ] **Step 2: Commit**

```bash
git add history.md
git commit -m "docs: add light mode to changelog"
```
