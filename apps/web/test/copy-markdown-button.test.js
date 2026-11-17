import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', path), 'utf8');
const component = src('components/common/CopyMarkdownButton.jsx');

// Source-contract test for CopyMarkdownButton. The web test suite has no
// jsdom, so this is the project-standard way to lock the component's
// behavior (same pattern as file-browser-modal.test.js).
describe('CopyMarkdownButton source contract', () => {
  it('routes every copy through copyTextToClipboard (never bare navigator.clipboard)', () => {
    // navigator.clipboard is undefined over LAN plain HTTP, which is a
    // supported deployment. A bare writeText throws a synchronous TypeError
    // before any .catch attaches — the button silently does nothing. The
    // shared helper falls back to execCommand in that case.
    assert.match(component, /import \{ copyTextToClipboard \} from '\.\.\/\.\.\/utils\/terminalClipboard'/);
    assert.match(component, /copyTextToClipboard\(text\)/);
    assert.doesNotMatch(component, /navigator\.clipboard\.writeText/);
  });

  it('is keyboard-activatable (Enter/Space) and stops propagation', () => {
    assert.match(component, /role="button"/);
    assert.match(component, /tabIndex=\{0\}/);
    assert.match(component, /if \(e\.key === 'Enter' \|\| e\.key === ' '\)/);
    assert.match(component, /e\.stopPropagation\(\)/);
  });

  it('supports getText as either a function or a plain string', () => {
    assert.match(component, /typeof getText === 'function' \? getText\(\) : getText/);
  });

  it('surfaces both success and failure to the user, and reports failures', () => {
    assert.match(component, /message\.success\(t\('ui\.copySuccess'\)\)/);
    assert.match(component, /message\.error\(t\('ui\.copyFailed'\)\)/);
    assert.match(component, /reportSwallowed\('copyMarkdown\.writeText'/);
  });

  it('keeps the feedback timer under control (ref + unmount cleanup + cooldown)', () => {
    // RefreshIcon parity: re-arming clears the previous timer, unmount
    // clears it, and a second click during the feedback window is a no-op.
    assert.match(component, /const timerRef = useRef\(null\)/);
    assert.match(component, /useEffect\(\(\) => \(\) => \{/);
    assert.match(component, /clearTimeout\(timerRef\.current\)/);
    assert.match(component, /if \(justCopied\) return;/);
  });
});
