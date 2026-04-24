---
phase: phase-19
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/utils/elementContext.js
  - src/components/TerminalPanel.jsx
  - test/elementContext.test.js
autonomous: true
requirements:
  - PHASE-19-XML-CONTEXT
must_haves:
  truths:
    - "buildElementContext(element, screenshotPaths) returns a well-formed XML string opening with <selected-element>"
    - "screenshot paths appear inside <screenshot> tags, not as shell-quoted path prefixes"
    - "styles block contains exactly the 6 specified properties using camelCase→hyphen mapping"
    - "padding shorthand collapses 4 values correctly (1-value, 2-value, or 4-value form)"
    - "when screenshotPaths is empty, no <screenshot> tag is emitted"
    - "<id></id> is always present even when element.id is empty"
    - "TerminalPanel Enter handler sends context + newline + 用户要求: + userInput (no shell path prefix)"
    - "buildElementContext(null) returns empty string"
    - "all existing tests continue to pass after the change"
  artifacts:
    - path: "src/utils/elementContext.js"
      provides: "XML element context builder"
      exports: ["buildElementContext"]
    - path: "test/elementContext.test.js"
      provides: "Node test-runner unit tests for buildElementContext"
  key_links:
    - from: "src/components/TerminalPanel.jsx"
      to: "src/utils/elementContext.js"
      via: "import { buildElementContext } from '../utils/elementContext'"
      pattern: "buildElementContext"
---

<objective>
Replace the hard-coded Chinese-prose output of `buildElementContext()` with a structured XML block that Claude can parse reliably, and thread screenshot paths through the new `screenshotPaths` parameter so TerminalPanel no longer builds a separate shell-quoted path prefix.

Purpose: Structured XML gives the AI model unambiguous field boundaries (tag, file, selector, styles), eliminates ambiguity in the current free-text prompt, and makes future additions (children, attributes) trivial.
Output: Updated `src/utils/elementContext.js`, updated `TerminalPanel.jsx` onData handler, new unit-test file `test/elementContext.test.js`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/phase-19/CONTEXT.md

Key facts discovered during planning:

1. Element object shape (from public/inspector-inject.js line 94-136):
   - element.tag           — lowercase tag name
   - element.id            — string, may be ''
   - element.className     — string, may be ''
   - element.text          — innerText, max 100 chars
   - element.selector      — auto-built (tag + #id or .class1.class2.class3)
   - element.computedStyle — object with: color, backgroundColor, fontSize, fontWeight,
                             borderRadius, paddingTop, paddingRight, paddingBottom, paddingLeft
                             (NOTE: field is `computedStyle`, NOT `computedStyles`)
   - element.sourceInfo    — { fileName, lineNumber, componentName } (may be null/undefined)

2. Test runner: `node --test` (Node built-in test runner, ESM, package type=module)
   Run with: CCV_LOG_DIR=tmp node --test test/elementContext.test.js

3. TerminalPanel current call site (lines 344-365):
   - Imports buildElementContext from '../utils/elementContext' (line 16)
   - Enter handler builds imagePaths shell prefix separately, then calls buildElementContext(element)
   - After change: pass screenshotPaths array into buildElementContext, drop shell prefix entirely
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rewrite buildElementContext() to emit XML and create unit tests</name>
  <files>src/utils/elementContext.js, test/elementContext.test.js</files>
  <behavior>
    - buildElementContext(null) → ''
    - buildElementContext(null, []) → ''
    - buildElementContext(element) with no screenshotPaths → no <screenshot> tag in output
    - buildElementContext(element, ['/tmp/a.png']) → output contains <screenshot>/tmp/a.png</screenshot>
    - buildElementContext(element, ['/tmp/a.png', '/tmp/b.png']) → two <screenshot> lines
    - output starts with '<selected-element>' and ends with '</selected-element>'
    - <id></id> present even when element.id === ''
    - padding shorthand: all 4 same → '8px'; top===bottom AND left===right → 'Xpx Ypx'; else 'T R B L'
    - styles block contains exactly: color, background-color, font-size, font-weight, border-radius, padding
    - missing computedStyle fields → empty tag value (e.g. <color></color>)
  </behavior>
  <action>
**Step 1 — Write the test file first (RED phase)**

Create `test/elementContext.test.js` with the following content (Node built-in test runner, ESM):

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildElementContext } from '../src/utils/elementContext.js';

const baseElement = {
  tag: 'button',
  id: '',
  className: 'btn-primary large',
  text: '提交',
  selector: 'button.btn-primary',
  computedStyle: {
    color: 'rgb(255,255,255)',
    backgroundColor: 'rgb(24,144,255)',
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '6px',
    paddingTop: '8px',
    paddingRight: '16px',
    paddingBottom: '8px',
    paddingLeft: '16px',
  },
  sourceInfo: {
    componentName: 'Button',
    fileName: 'src/components/Button.jsx',
    lineNumber: 42,
  },
};

describe('buildElementContext', () => {
  it('returns empty string for null element', () => {
    assert.equal(buildElementContext(null), '');
    assert.equal(buildElementContext(null, []), '');
    assert.equal(buildElementContext(undefined), '');
  });

  it('wraps output in <selected-element> root tag', () => {
    const out = buildElementContext(baseElement);
    assert.ok(out.startsWith('<selected-element>'), 'should start with <selected-element>');
    assert.ok(out.trimEnd().endsWith('</selected-element>'), 'should end with </selected-element>');
  });

  it('includes basic element fields in correct order', () => {
    const out = buildElementContext(baseElement);
    assert.ok(out.includes('<tag>button</tag>'));
    assert.ok(out.includes('<component>Button</component>'));
    assert.ok(out.includes('<file>src/components/Button.jsx:42</file>'));
    assert.ok(out.includes('<class>btn-primary large</class>'));
    assert.ok(out.includes('<id></id>'), '<id></id> must be present even when empty');
    assert.ok(out.includes('<selector>button.btn-primary</selector>'));
    assert.ok(out.includes('<text>提交</text>'));
  });

  it('emits no <screenshot> tag when screenshotPaths is empty', () => {
    const out = buildElementContext(baseElement);
    assert.ok(!out.includes('<screenshot>'), 'no screenshot tag when none provided');
  });

  it('emits no <screenshot> tag when screenshotPaths is []', () => {
    const out = buildElementContext(baseElement, []);
    assert.ok(!out.includes('<screenshot>'), 'no screenshot tag for empty array');
  });

  it('emits one <screenshot> tag for a single path', () => {
    const out = buildElementContext(baseElement, ['/tmp/elem-123.png']);
    assert.ok(out.includes('<screenshot>/tmp/elem-123.png</screenshot>'));
  });

  it('emits multiple <screenshot> tags for multiple paths', () => {
    const out = buildElementContext(baseElement, ['/tmp/a.png', '/tmp/b.png']);
    assert.ok(out.includes('<screenshot>/tmp/a.png</screenshot>'));
    assert.ok(out.includes('<screenshot>/tmp/b.png</screenshot>'));
  });

  it('includes all 6 style properties', () => {
    const out = buildElementContext(baseElement);
    assert.ok(out.includes('<color>rgb(255,255,255)</color>'));
    assert.ok(out.includes('<background-color>rgb(24,144,255)</background-color>'));
    assert.ok(out.includes('<font-size>14px</font-size>'));
    assert.ok(out.includes('<font-weight>500</font-weight>'));
    assert.ok(out.includes('<border-radius>6px</border-radius>'));
  });

  it('collapses padding to 2-value shorthand when top===bottom and left===right', () => {
    const out = buildElementContext(baseElement);
    assert.ok(out.includes('<padding>8px 16px</padding>'), `got: ${out}`);
  });

  it('collapses padding to 1-value shorthand when all 4 sides equal', () => {
    const el = {
      ...baseElement,
      computedStyle: { ...baseElement.computedStyle, paddingTop: '8px', paddingRight: '8px', paddingBottom: '8px', paddingLeft: '8px' },
    };
    const out = buildElementContext(el);
    assert.ok(out.includes('<padding>8px</padding>'), `got: ${out}`);
  });

  it('uses 4-value padding when no shorthand applies', () => {
    const el = {
      ...baseElement,
      computedStyle: { ...baseElement.computedStyle, paddingTop: '1px', paddingRight: '2px', paddingBottom: '3px', paddingLeft: '4px' },
    };
    const out = buildElementContext(el);
    assert.ok(out.includes('<padding>1px 2px 3px 4px</padding>'), `got: ${out}`);
  });

  it('emits empty style tags when computedStyle fields are missing', () => {
    const el = { ...baseElement, computedStyle: {} };
    const out = buildElementContext(el);
    assert.ok(out.includes('<color></color>'));
    assert.ok(out.includes('<background-color></background-color>'));
  });

  it('handles missing sourceInfo gracefully', () => {
    const el = { ...baseElement, sourceInfo: null };
    const out = buildElementContext(el);
    // component and file tags should be absent or empty — no crash
    assert.ok(typeof out === 'string');
    assert.ok(out.includes('<selected-element>'));
  });
});
```

Run the tests — they MUST all fail at this point (RED):
```
CCV_LOG_DIR=tmp node --test test/elementContext.test.js
```

**Step 2 — Implement buildElementContext() (GREEN phase)**

Replace the entire content of `src/utils/elementContext.js` with:

```js
/**
 * Builds a structured XML context string for the selected element,
 * suitable for injection into AI prompts.
 *
 * @param {Object|null} element - Selected element from the inspector
 * @param {string[]} screenshotPaths - Absolute paths to screenshot files
 * @returns {string} XML string, or '' if element is falsy
 */
export function buildElementContext(element, screenshotPaths = []) {
  if (!element) return '';

  const cs = element.computedStyle || {};

  // --- padding shorthand ---
  const pt = cs.paddingTop    || '';
  const pr = cs.paddingRight  || '';
  const pb = cs.paddingBottom || '';
  const pl = cs.paddingLeft   || '';
  let padding = '';
  if (pt && pr && pb && pl) {
    if (pt === pr && pt === pb && pt === pl) {
      padding = pt;                     // 1-value: all same
    } else if (pt === pb && pr === pl) {
      padding = `${pt} ${pr}`;          // 2-value: top===bottom, left===right
    } else {
      padding = `${pt} ${pr} ${pb} ${pl}`;  // 4-value: no shorthand
    }
  } else {
    // at least one side present — fallback to whatever is available
    padding = [pt, pr, pb, pl].filter(Boolean).join(' ') || '';
  }

  // --- sourceInfo ---
  const si = element.sourceInfo || {};
  const componentLine = si.componentName
    ? `  <component>${si.componentName}</component>\n`
    : '';
  const fileLine = si.fileName
    ? `  <file>${si.fileName}${si.lineNumber != null ? ':' + si.lineNumber : ''}</file>\n`
    : '';

  // --- screenshot tags (one per path, only when present) ---
  const screenshotLines = (screenshotPaths || [])
    .map(p => `  <screenshot>${p}</screenshot>`)
    .join('\n');
  const screenshotBlock = screenshotLines ? screenshotLines + '\n' : '';

  // --- class and id ---
  const classVal = element.className || '';
  const idVal    = element.id        || '';

  // --- text (may be absent on non-text elements) ---
  const textVal = element.text != null ? element.text : '';

  return (
    `<selected-element>\n` +
    `  <tag>${element.tag || ''}</tag>\n` +
    screenshotBlock +
    componentLine +
    fileLine +
    `  <class>${classVal}</class>\n` +
    `  <id>${idVal}</id>\n` +
    `  <selector>${element.selector || ''}</selector>\n` +
    `  <text>${textVal}</text>\n` +
    `  <styles>\n` +
    `    <color>${cs.color || ''}</color>\n` +
    `    <background-color>${cs.backgroundColor || ''}</background-color>\n` +
    `    <font-size>${cs.fontSize || ''}</font-size>\n` +
    `    <font-weight>${cs.fontWeight || ''}</font-weight>\n` +
    `    <border-radius>${cs.borderRadius || ''}</border-radius>\n` +
    `    <padding>${padding}</padding>\n` +
    `  </styles>\n` +
    `</selected-element>`
  );
}
```

Run the tests — they MUST all pass (GREEN):
```
CCV_LOG_DIR=tmp node --test test/elementContext.test.js
```
  </action>
  <verify>
    <automated>CCV_LOG_DIR=tmp node --test test/elementContext.test.js</automated>
  </verify>
  <done>All tests in test/elementContext.test.js pass. buildElementContext(null) returns ''. buildElementContext(element, ['/tmp/a.png']) returns a string starting with &lt;selected-element&gt; containing &lt;screenshot&gt;/tmp/a.png&lt;/screenshot&gt; and a well-formed &lt;styles&gt; block. Padding shorthand is verified by the 1-value, 2-value, and 4-value cases.</done>
</task>

<task type="auto">
  <name>Task 2: Update TerminalPanel.jsx Enter handler to use new signature</name>
  <files>src/components/TerminalPanel.jsx</files>
  <action>
In `src/components/TerminalPanel.jsx`, locate the `onData` handler inside `setupTerminal()`. The block to replace is approximately lines 344-365.

**Current code (lines 344-365 approximately):**

```js
const context = buildElementContext(this.props.selectedElement);
if (context) {
  // 清理 [SelectUI #N] 标记，提取纯用户输入
  const userInput = this._userInputBuffer.replace(/\[SelectUI #\d+\]\s*/g, '').trim();
  this._userInputBuffer = '';
  // 清理后无实际输入，按普通 Enter 处理
  if (!userInput) {
    this.ws.send(JSON.stringify({ type: 'input', data }));
    return;
  }
  // 统一处理 pending 截图路径（避免与 attachCustomKeyEventHandler 重复注入）
  const pending = this.props.pendingImages;
  let imagePaths = '';
  if (pending?.length > 0) {
    imagePaths = pending.map(img => `'${img.path.replace(/'/g, "'\\''")}'`).join(' ') + ' ';
    this.props.onClearPendingImages?.();
  }
  // 组合完整 prompt：截图路径 + 元素上下文 + 用户要求
  const fullPrompt = imagePaths + context.replace(/\n+/g, ' ').trim() + ' 用户要求: ' + userInput;
  // 通过 visual-input 发送，服务端会抑制 PTY 回显，
  // 终端上 [SelectUI #N] + 用户输入保持原样
  this.ws.send(JSON.stringify({ type: 'visual-input', prompt: fullPrompt }));
  return;
}
```

**Replace with:**

```js
// 清理 [SelectUI #N] 标记，提取纯用户输入
const userInput = this._userInputBuffer.replace(/\[SelectUI #\d+\]\s*/g, '').trim();
this._userInputBuffer = '';
// 清理后无实际输入，按普通 Enter 处理
if (!userInput) {
  this.ws.send(JSON.stringify({ type: 'input', data }));
  return;
}
// 收集截图路径并传入 buildElementContext（per D1）
const pending = this.props.pendingImages;
const screenshotPaths = pending?.map(img => img.path) ?? [];
if (screenshotPaths.length > 0) this.props.onClearPendingImages?.();
// 组合 XML 上下文，截图路径内嵌于 <screenshot> 标签（per D1, D3）
const context = buildElementContext(this.props.selectedElement, screenshotPaths);
// 组合完整 prompt：XML 上下文 + \n用户要求: + 用户输入
const fullPrompt = context + '\n用户要求: ' + userInput;
// 通过 visual-input 发送，服务端会抑制 PTY 回显，
// 终端上 [SelectUI #N] + 用户输入保持原样
this.ws.send(JSON.stringify({ type: 'visual-input', prompt: fullPrompt }));
return;
```

**Key changes:**
- Removed `if (context) {` guard — context is now always built (function returns '' for null, but selectedElement is guaranteed truthy here)
- Removed `imagePaths` shell-quoting logic (per D1: paths now go into XML)
- Removed `.replace(/\n+/g, ' ').trim()` compression — XML must remain multi-line (per D3 note)
- `screenshotPaths` passed as plain `img.path` strings, no shell quoting needed
- `fullPrompt` separator changed from `' 用户要求: '` to `'\n用户要求: '` (per D3)

The `if (context)` guard that wrapped the old block is also removed; the outer guard `if (!inAlternateScreen && this._userInputBuffer)` already ensures we only proceed when there is user input.
  </action>
  <verify>
    <automated>CCV_LOG_DIR=tmp node --test test/elementContext.test.js && npm run build 2>&1 | tail -5</automated>
  </verify>
  <done>TerminalPanel.jsx Enter handler no longer builds a shell-quoted `imagePaths` string. `buildElementContext` is called with `(this.props.selectedElement, screenshotPaths)`. `fullPrompt` is assembled as `context + '\n用户要求: ' + userInput`. `npm run build` exits 0 with no errors.</done>
</task>

</tasks>

<verification>
After both tasks complete, run the full verification sequence:

```bash
# 1. Unit tests for elementContext
CCV_LOG_DIR=tmp node --test test/elementContext.test.js

# 2. Full test suite (must not regress)
CCV_LOG_DIR=tmp node --test 2>&1 | tail -20

# 3. Production build
npm run build 2>&1 | tail -10
```

Expected: all tests pass, build exits 0.

Manual spot-check (if browser available):
1. Open app, navigate to a page with a running project
2. Click an element in PagePreview — inspector should highlight it
3. Type a message in the terminal, press Enter
4. Observe the WebSocket `visual-input` message in DevTools Network tab — `prompt` field should start with `<selected-element>` and end with `\n用户要求: <your text>`
5. If a screenshot was attached, verify `<screenshot>/tmp/...</screenshot>` appears inside the XML, NOT as a leading shell path
</verification>

<success_criteria>
- `test/elementContext.test.js` passes 100% (13 test cases)
- Full `node --test` suite passes with no regressions
- `npm run build` exits 0
- `buildElementContext(null)` → `''`
- `buildElementContext(element, [])` → XML with no `<screenshot>` tag
- `buildElementContext(element, ['/tmp/a.png'])` → XML with `<screenshot>/tmp/a.png</screenshot>` between `<tag>` and `<component>`
- padding shorthand: equal-4 → 1-value, top=bottom+left=right → 2-value, else 4-value
- TerminalPanel sends `fullPrompt` as `<selected-element>...</selected-element>\n用户要求: {input}`
</success_criteria>

<output>
After completion, create `.planning/phases/phase-19/phase-19-01-SUMMARY.md` with:
- Files changed and what changed in each
- Confirmation that all tests pass
- Note on any edge cases discovered during implementation
</output>
