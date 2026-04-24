---
phase: phase-18
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/App.jsx
  - src/components/VisualEditor/PagePreview.jsx
autonomous: true
requirements:
  - IFRAME-URL-PERSIST-01
must_haves:
  truths:
    - "After switching away from visual mode and back, the URL input still shows the previously-entered URL"
    - "After switching away from visual mode and back, the iframe still loads the previously-entered URL"
    - "Three consecutive mode switches preserve previewUrl without re-entry"
  artifacts:
    - path: "src/App.jsx"
      provides: "previewUrl state lifted to App class, passed as prop to PagePreview"
      contains: "previewUrl"
    - path: "src/components/VisualEditor/PagePreview.jsx"
      provides: "PagePreview reads urlInput/iframeSrc from props, not local useState"
      contains: "previewUrl"
  key_links:
    - from: "src/App.jsx"
      to: "src/components/VisualEditor/PagePreview.jsx"
      via: "previewUrl and onPreviewUrlChange props"
      pattern: "previewUrl=\\{this\\.state\\.previewUrl\\}"
---

<objective>
Fix the visual editor iframe URL reset bug: when the user switches away from `visual` viewMode and returns, the URL input and iframe are cleared because PagePreview is unmounted and its local state is lost.

Purpose: Preserve the user's entered preview URL across view-mode switches so they never have to retype it.
Output: `previewUrl` state lifted to App class; PagePreview receives it as a controlled prop; URL survives any number of viewMode switches.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/App.jsx
@src/components/VisualEditor/PagePreview.jsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Lift previewUrl state into App</name>
  <files>src/App.jsx</files>
  <action>
**Root cause:** `PagePreview` is a functional component owning `urlInput` and `iframeSrc` as local `useState`. When `viewMode !== 'visual'` the entire block at line 491 is unmounted; on remount all local state resets to `''`.

**Fix:** Lift the URL that the user has committed to navigate (i.e., the value last passed to `handleNavigate`) up into `App` state so it survives unmount/remount.

**Step 1 — Add `previewUrl` to App constructor state** (inside `Object.assign(this.state, { ... })` starting at line 29):

```js
// BEFORE (line 29-38):
Object.assign(this.state, {
  leftPanelWidth: 380,
  terminalVisible: true,
  currentTab: 'context',
  pendingCacheHighlight: null,
  visualPendingImages: [],
  visualMenuKey: 'ui-edit',
  visualOperationHeight: 220,
  launcherCollapsed: false,
});

// AFTER:
Object.assign(this.state, {
  leftPanelWidth: 380,
  terminalVisible: true,
  currentTab: 'context',
  pendingCacheHighlight: null,
  visualPendingImages: [],
  visualMenuKey: 'ui-edit',
  visualOperationHeight: 220,
  launcherCollapsed: false,
  previewUrl: '',          // persisted across viewMode switches
});
```

**Step 2 — Add a handler method** in the "PC 专属方法" section (after `handleVerticalResizeStart`, before `handleViewRequest`):

```js
handlePreviewUrlChange = (url) => {
  this.setState({ previewUrl: url });
};
```

**Step 3 — Pass props to PagePreview** at line 506-514. Change:

```jsx
// BEFORE:
<PagePreview
  port={this.state.projectStatus?.port}
  onElementHover={(el) => {}}
  onElementSelect={(el) => this.setState({ selectedElement: el })}
  onElementDeselect={() => this.setState({ selectedElement: null, visualPendingImages: [] })}
  selectedElement={this.state.selectedElement}
  sketchMcpStatus={this.state.sketchMcpStatus}
  onElementScreenshot={this.handleElementScreenshot}
/>

// AFTER:
<PagePreview
  port={this.state.projectStatus?.port}
  previewUrl={this.state.previewUrl}
  onPreviewUrlChange={this.handlePreviewUrlChange}
  onElementHover={(el) => {}}
  onElementSelect={(el) => this.setState({ selectedElement: el })}
  onElementDeselect={() => this.setState({ selectedElement: null, visualPendingImages: [] })}
  selectedElement={this.state.selectedElement}
  sketchMcpStatus={this.state.sketchMcpStatus}
  onElementScreenshot={this.handleElementScreenshot}
/>
```
  </action>
  <verify>
    <automated>grep -n "previewUrl" /Users/duanrong/yuyan/duanrong/cleffa/cc-viewer/src/App.jsx</automated>
  </verify>
  <done>
    - `this.state.previewUrl` initialised to `''` in constructor
    - `handlePreviewUrlChange` method exists in App class
    - `PagePreview` receives `previewUrl={this.state.previewUrl}` and `onPreviewUrlChange={this.handlePreviewUrlChange}` as props
  </done>
</task>

<task type="auto">
  <name>Task 2: Make PagePreview a controlled component for URL</name>
  <files>src/components/VisualEditor/PagePreview.jsx</files>
  <action>
`PagePreview` currently manages `urlInput` and `iframeSrc` entirely with local `useState`. We need to keep local `iframeSrc`/`iframeKey` (they are transient iframe state), but synchronise `urlInput` with the new `previewUrl` prop so the committed URL is never lost.

**Step 1 — Update function signature** (line 140). Add `previewUrl` and `onPreviewUrlChange`:

```js
// BEFORE:
export default function PagePreview({ port, onElementHover, onElementSelect, onElementDeselect, selectedElement, sketchMcpStatus, onElementScreenshot }) {

// AFTER:
export default function PagePreview({ port, previewUrl: externalUrl, onPreviewUrlChange, onElementHover, onElementSelect, onElementDeselect, selectedElement, sketchMcpStatus, onElementScreenshot }) {
```

**Step 2 — Replace `urlInput` useState initialisation** (line 141). Change:

```js
// BEFORE:
const [urlInput, setUrlInput] = useState('');

// AFTER:
const [urlInput, setUrlInput] = useState(externalUrl || '');
```

**Step 3 — Sync external URL into local input on remount.** Add a `useEffect` immediately after the existing state declarations (after line 150, before `handleNavigate`):

```js
// Sync externally-persisted URL into local input when component mounts or
// when externalUrl changes (e.g., first-time port-based auto-navigate writes
// back via onPreviewUrlChange, then on remount we restore from that value).
useEffect(() => {
  if (externalUrl && externalUrl !== urlInput) {
    setUrlInput(externalUrl);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [externalUrl]);
```

Note: The empty dependency on `urlInput` is intentional — we only want to restore from the external value, not track every keystroke.

**Step 4 — Notify parent when navigation is committed.** Inside `handleNavigate` (lines 152-170), add a call to `onPreviewUrlChange` after `setUrlInput(displayUrl)`:

```js
// BEFORE (inside handleNavigate, after displayUrl is computed):
setUrlInput(displayUrl);
setIframeSrc(toProxyUrl(displayUrl));

// AFTER:
setUrlInput(displayUrl);
onPreviewUrlChange?.(displayUrl);   // persist in App state
setIframeSrc(toProxyUrl(displayUrl));
```

This is the single point where a URL is "committed" — whether the user presses Enter, clicks the arrow button, or the port-auto-navigate effect fires. All three paths call `handleNavigate`, so this one insertion covers them all.

**No other changes needed.** `iframeSrc` and `iframeKey` remain local because they represent the live iframe load state, not the user's intended URL. On remount, `iframeSrc` will be `''` initially, which is fine — the sync `useEffect` (Step 3) restores `urlInput`, and the user can press Enter or the arrow button to reload; alternatively, add an auto-reload on remount (see optional step below).

**Optional Step 5 — Auto-reload iframe on remount when externalUrl exists.** To make the experience seamless (iframe reloads automatically without user action), modify the sync effect to also trigger navigation:

```js
useEffect(() => {
  if (externalUrl && !iframeSrc) {
    // Restore the URL in the input and reload the iframe
    handleNavigate(externalUrl);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // run once on mount only
```

Place this SEPARATE effect after Step 3's effect. The "run once on mount" (`[]` deps) ensures it fires on remount but not on every re-render. The `!iframeSrc` guard ensures it doesn't double-fire if the port-effect already navigated.
  </action>
  <verify>
    <automated>grep -n "externalUrl\|onPreviewUrlChange\|previewUrl" /Users/duanrong/yuyan/duanrong/cleffa/cc-viewer/src/components/VisualEditor/PagePreview.jsx</automated>
  </verify>
  <done>
    - Function signature accepts `previewUrl` (aliased as `externalUrl`) and `onPreviewUrlChange`
    - `useState('')` seeds from `externalUrl || ''`
    - A `useEffect` syncs `externalUrl` into `urlInput` when it changes
    - `handleNavigate` calls `onPreviewUrlChange?.(displayUrl)` after computing `displayUrl`
    - A mount-only `useEffect` auto-reloads the iframe when `externalUrl` is present and `iframeSrc` is empty
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    previewUrl state lifted to App; PagePreview reads/writes it via props; URL persists across viewMode switches.
  </what-built>
  <how-to-verify>
    1. Run `npm run build` and start the dev server.
    2. Switch to Visual Editor mode (top-right "Visual" button or equivalent).
    3. Type `http://localhost:3000` in the URL bar and press Enter — confirm the iframe loads.
    4. Switch away from Visual mode (e.g., click "Chat" or "Raw").
    5. Switch back to Visual mode.
    6. Verify: the URL bar still shows `http://localhost:3000` and the iframe reloads automatically.
    7. Repeat steps 4-6 two more times (total 3 round-trips).
    8. Confirm the URL is preserved every time and you never need to retype it.
  </how-to-verify>
  <resume-signal>Type "approved" if the URL persists across all 3 round-trips, or describe what broke.</resume-signal>
</task>

</tasks>

<verification>
Manual test (3 viewMode round-trips with a URL entered):
- previewUrl in App state equals the last navigated URL after each switch
- URL input field is populated on every return to visual mode
- iframe auto-loads on return (no manual re-enter required)

Automated smoke check:
```
grep -n "previewUrl\|onPreviewUrlChange" \
  src/App.jsx \
  src/components/VisualEditor/PagePreview.jsx
```
Both files should show hits on `previewUrl` and `onPreviewUrlChange`.
</verification>

<success_criteria>
- Entering `http://localhost:3000`, switching away, and returning 3 times always shows the URL without re-entry.
- `previewUrl` lives in `App` state (class field), not inside `PagePreview` local state.
- `onPreviewUrlChange` is the single callback that writes to App state, called inside `handleNavigate`.
- No new external dependencies introduced.
- `npm run build` completes with no errors.
</success_criteria>

<output>
After completion, create `.planning/phases/phase-18/phase-18-01-SUMMARY.md` summarising:
- Root cause (one sentence)
- Files changed and what changed in each
- How the fix works (one paragraph)
- Build/test result
</output>
