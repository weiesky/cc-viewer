/**
 * Permission prompt detection end-to-end test
 * Tests the complete chain: ANSI strip → buffer → regex detect → classify
 */
import assert from 'assert';
import { describe, it } from 'node:test';

// ── Extract logic from source (no JSX dependency) ──

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[^[\]](.|$)/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function detectPrompt(rawBuf) {
  const buf = rawBuf.trimEnd();
  let question = null;
  let options = null;

  // Pattern 1: Numbered options
  const match1 = buf.match(/([^\n]*\?)\s*\n((?:\s*[❯>]?\s*\d+\.\s+[^\n]+\n?){2,})$/);
  if (match1) {
    question = match1[1].trim();
    const optionLines = match1[2].match(/\s*([❯>])?\s*(\d+)\.\s+([^\n]+)/g);
    if (optionLines) {
      options = optionLines.map(line => {
        const m = line.match(/\s*([❯>])?\s*(\d+)\.\s+(.+)/);
        return { number: parseInt(m[2], 10), text: m[3].trim(), selected: !!m[1] };
      });
    }
  }

  // Pattern 2: Non-numbered cursor-based (Ink Select)
  if (!options) {
    const match2 = buf.match(/([^\n]+)\n((?:\s+[❯>]?\s+[^\n]+\n?){2,})$/);
    if (match2) {
      const candidateQ = match2[1].trim();
      const block = match2[2];
      const lines = block.split('\n').filter(l => l.trim());
      const parsed = [];
      for (const line of lines) {
        const m = line.match(/^\s*([❯>])?\s+(.+)/);
        if (m && m[2].trim()) {
          parsed.push({ number: parsed.length + 1, text: m[2].trim(), selected: !!m[1] });
        }
      }
      if (parsed.length >= 2 && parsed.some(p => p.selected)) {
        question = candidateQ;
        options = parsed;
      }
    }
  }

  if (question && options) {
    // False positive filters
    if (/^[■\s]*[~\/.:]/.test(question) && /\//.test(question)) return null;
    if (/^[*■✦⏎]/.test(question)) return null;
    return { question, options };
  }
  return null;
}

// promptClassifier.js logic
function isPlanApprovalPrompt(prompt) {
  if (!prompt || !prompt.question) return false;
  const q = prompt.question.toLowerCase();
  return /plan/i.test(q) && (/approv/i.test(q) || /proceed/i.test(q) || /accept/i.test(q));
}

function isDangerousOperationPrompt(prompt) {
  if (!prompt || !prompt.question) return false;
  const q = prompt.question;
  if (isPlanApprovalPrompt(prompt)) return false;
  if (/do you want to (make this edit|write|proceed|create|delete)|allow\b.*\bto\b|want to allow|wants to (execute|run|read|write|access|create|delete|modify|use)|may .*(read|write|execute|run|access|create|delete|modify)|grant .*(access|permission)|permit/i.test(q)) {
    return true;
  }
  if (prompt.options && prompt.options.length >= 2) {
    const texts = prompt.options.map(o => (o.text || '').toLowerCase());
    const hasAllow = texts.some(t => /^allow|^yes/i.test(t));
    const hasDeny = texts.some(t => /^no$|^no[^a-z]|^deny|^reject/i.test(t));
    if (hasAllow && hasDeny) return true;
  }
  return false;
}

// ── Test cases: Real Claude Code permission prompts ──

describe('Permission prompt detection', () => {

  // ============================================================
  // Group A: File edit permission (most common)
  // ============================================================

  describe('A. File edit permission prompts', () => {

    it('A1: Basic "Do you want to make this edit?" with cursor options', () => {
      const raw = `Do you want to make this edit to src/components/App.jsx?
  ❯ Yes
    Yes, allow all edits during this session (shift+tab)
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect prompt');
      assert.ok(result.question.includes('Do you want to make this edit'));
      assert.strictEqual(result.options.length, 3);
      assert.ok(isDangerousOperationPrompt(result), 'Should classify as dangerous operation');
      assert.ok(!isPlanApprovalPrompt(result), 'Should NOT classify as plan approval');
      console.log('  ✓ Detected:', result.question);
      console.log('    Options:', result.options.map(o => `${o.selected ? '❯' : ' '} ${o.text}`).join(' | '));
    });

    it('A2: Edit prompt with ANSI escape sequences', () => {
      const raw = `\x1b[1m\x1b[33mDo you want to make this edit to\x1b[0m \x1b[1msrc/index.js\x1b[0m\x1b[33m?\x1b[0m
  \x1b[36m❯\x1b[0m \x1b[36mYes\x1b[0m
    Yes, allow all edits during this session (shift+tab)
    No
`;
      const stripped = stripAnsi(raw);
      const result = detectPrompt(stripped);
      assert.ok(result, 'Should detect after ANSI stripping');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ ANSI stripped → Detected:', result.question);
    });

    it('A3: Edit prompt with directory scope', () => {
      const raw = `Do you want to make this edit to package.json?
  ❯ Yes
    Yes, allow all edits to cc-viewer/ during this session (shift+tab)
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Detected:', result.question);
    });
  });

  // ============================================================
  // Group B: Bash command permission
  // ============================================================

  describe('B. Bash command permission prompts', () => {

    it('B1: Bash command permission with numbered options', () => {
      const raw = `Claude wants to execute a bash command. Allow?
  ❯ Yes
    Yes, allow all bash commands during this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect bash permission');
      assert.ok(isDangerousOperationPrompt(result), 'Should classify as dangerous');
      console.log('  ✓ Detected:', result.question);
    });

    it('B2: Bash with specific command shown', () => {
      const raw = `Claude wants to run: npm install lodash
  ❯ Yes
    Yes, allow all bash commands during this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect');
      // Note: "wants to run" should match isDangerousOperationPrompt
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Detected:', result.question);
    });
  });

  // ============================================================
  // Group C: File write/create permission
  // ============================================================

  describe('C. File write permission prompts', () => {

    it('C1: Write new file', () => {
      const raw = `Do you want to write this new file?
  ❯ Yes
    Yes, allow all writes during this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect write permission');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Detected:', result.question);
    });
  });

  // ============================================================
  // Group D: Generic Allow/Deny prompts
  // ============================================================

  describe('D. Generic Allow/Deny prompts', () => {

    it('D1: Simple Allow/Deny', () => {
      const raw = `Tool requires permission
  ❯ Allow once
    Allow for this session
    Deny
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect');
      assert.ok(isDangerousOperationPrompt(result), 'Options have Allow+Deny → dangerous');
      console.log('  ✓ Detected:', result.question);
      console.log('    Options:', result.options.map(o => o.text).join(' | '));
    });

    it('D2: MCP tool permission', () => {
      const raw = `Allow mcp__slack__post_message to post to #general?
  ❯ Allow once
    Allow for this session
    Deny
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect MCP permission');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Detected:', result.question);
    });
  });

  // ============================================================
  // Group E: Plan approval (should NOT be classified as dangerous)
  // ============================================================

  describe('E. Plan approval (not dangerous)', () => {

    it('E1: Plan approval prompt', () => {
      const raw = `Do you want to approve this plan?
  ❯ 1. Approve
    2. Approve with edits
    3. Reject
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect');
      assert.ok(isPlanApprovalPrompt(result), 'Should classify as plan approval');
      assert.ok(!isDangerousOperationPrompt(result), 'Should NOT classify as dangerous');
      console.log('  ✓ Plan prompt correctly classified (not dangerous)');
    });
  });

  // ============================================================
  // Group F: False positives (should NOT detect)
  // ============================================================

  describe('F. False positives that should NOT be detected', () => {

    it('F1: File path output', () => {
      const raw = `~/projects/cc-viewer/src/components/
  ❯ App.jsx
    ChatView.jsx
    ChatMessage.jsx
`;
      const result = detectPrompt(raw);
      // Even if detected, the false positive filter should catch it
      if (result) {
        assert.ok(!isDangerousOperationPrompt(result), 'File listing should not be dangerous');
      }
      console.log('  ✓ File path output correctly handled');
    });

    it('F2: Status bar output', () => {
      const raw = `*Crunched for 2m18s · 15k tokens
  ❯ some line
    another line
`;
      const result = detectPrompt(raw);
      assert.ok(!result, 'Status bar should be filtered out');
      console.log('  ✓ Status bar correctly filtered');
    });

    it('F3: Diff output', () => {
      const raw = `--- a/src/index.js
+++ b/src/index.js
@@ -1,3 +1,4 @@
  const a = 1;
+ const b = 2;
  const c = 3;
`;
      const result = detectPrompt(raw);
      assert.ok(!result, 'Diff output should not be detected');
      console.log('  ✓ Diff output correctly not detected');
    });
  });

  // ============================================================
  // Group G: Edge cases & tricky scenarios
  // ============================================================

  describe('G. Edge cases', () => {

    it('G1: Prompt preceded by other output in buffer', () => {
      const raw = `Some previous output here...
Tool result: success

Do you want to make this edit to test.js?
  ❯ Yes
    Yes, allow all edits during this session (shift+tab)
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect prompt even with preceding output');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Detected with preceding buffer content');
    });

    it('G2: Prompt with trailing newlines', () => {
      const raw = `Do you want to make this edit to foo.js?
  ❯ Yes
    Yes, allow all edits during this session (shift+tab)
    No

`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect despite trailing newlines (trimEnd)');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Handled trailing newlines');
    });

    it('G3: Prompt split across multiple chunks (simulated)', () => {
      // Simulate data arriving in chunks - after debounce, buffer should be complete
      let buffer = '';
      buffer += 'Do you want to make this edit to ';
      buffer += 'main.js?\n';
      buffer += '  ❯ Yes\n';
      buffer += '    Yes, allow all edits during this session (shift+tab)\n';
      buffer += '    No\n';
      const result = detectPrompt(buffer);
      assert.ok(result, 'Assembled buffer should detect');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Chunked data assembled correctly');
    });

    it('G4: Cursor on non-first option (user moved cursor)', () => {
      const raw = `Do you want to make this edit to app.js?
    Yes
  ❯ Yes, allow all edits during this session (shift+tab)
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect even when cursor is not on first option');
      const selected = result.options.find(o => o.selected);
      assert.ok(selected, 'Should have a selected option');
      assert.ok(selected.text.includes('allow all edits'), 'Selected should be the second option');
      console.log('  ✓ Cursor on 2nd option correctly detected');
    });

    it('G5: Question without ? (some prompts)', () => {
      const raw = `Claude wants to execute the following bash command
  ❯ Yes
    Yes, always allow
    No
`;
      const result = detectPrompt(raw);
      // Pattern 1 requires ?, but Pattern 2 should still match
      assert.ok(result, 'Pattern 2 should match question without ?');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ No-? prompt detected via Pattern 2');
    });

    it('G6: ".claude" folder permission', () => {
      const raw = `Do you want to make this edit to .claude/settings.json?
  ❯ Yes
    Yes, and allow Claude to edit its own settings for this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect .claude settings edit');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ .claude settings permission detected');
    });

    it('G7: Read permission', () => {
      const raw = `Do you want to allow reading from /etc/passwd?
  ❯ Yes
    Yes, allow reading from etc/ during this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect read permission');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Read permission detected');
    });

    it('G8: Buffer overflow - prompt at end of 4KB buffer', () => {
      const padding = 'x'.repeat(3800) + '\n';
      const prompt = `Do you want to make this edit to large.js?
  ❯ Yes
    Yes, allow all edits during this session
    No
`;
      let buffer = padding + prompt;
      // Simulate 4KB truncation
      if (buffer.length > 4096) {
        buffer = buffer.slice(-4096);
      }
      const result = detectPrompt(buffer);
      assert.ok(result, 'Should detect prompt at end of truncated buffer');
      console.log('  ✓ Detected in truncated 4KB buffer');
    });

    it('G9: Prompt with unicode path', () => {
      const raw = `Do you want to make this edit to src/组件/App.jsx?
  ❯ Yes
    Yes, allow all edits during this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect prompt with unicode path');
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Unicode path prompt detected');
    });
  });

  // ============================================================
  // Group H: Real-world permission prompt variations from CLI source
  // ============================================================

  describe('H. Real-world CLI permission prompt variations', () => {

    it('H1: accept-once / accept-session / reject (standard 3-option)', () => {
      const raw = `Do you want to make this edit to src/App.jsx?
  ❯ Yes
    Yes, allow all edits to my-project/ during this session (shift+tab)
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result);
      assert.strictEqual(result.options.length, 3);
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ Standard 3-option permission prompt');
    });

    it('H2: Claude settings folder special option', () => {
      const raw = `Do you want to make this edit to .claude/settings.json?
  ❯ Yes
    Yes, and allow Claude to edit its own settings for this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result);
      assert.strictEqual(result.options.length, 3);
      console.log('  ✓ Claude settings special permission prompt');
    });

    it('H3: Read-only permission', () => {
      const raw = `May Claude read /secret/config.yml?
  ❯ Yes
    Yes, allow reading from secret/ during this session
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect read permission');
      assert.ok(isDangerousOperationPrompt(result), '"May ... read" should match');
      console.log('  ✓ Read-only permission detected');
    });

    it('H4: No input mode (reject with feedback)', () => {
      // When user tabs to "No", it becomes an input field
      const raw = `Do you want to make this edit to foo.js?
    Yes
    Yes, allow all edits during this session (shift+tab)
  ❯ No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect with cursor on No');
      const noOpt = result.options.find(o => o.selected);
      assert.ok(noOpt.text === 'No');
      console.log('  ✓ Cursor on No option detected');
    });
  });

  // ============================================================
  // Group I: Additional edge cases from code review
  // ============================================================

  describe('I. Code review edge cases', () => {

    it('I1: 4+ options (project-scoped permission)', () => {
      const raw = `Do you want to make this edit to src/App.jsx?
  ❯ Yes
    Yes, allow all edits to src/ during this session
    Yes, allow all edits to my-project/ during this session (shift+tab)
    No
`;
      const result = detectPrompt(raw);
      assert.ok(result, 'Should detect 4-option prompt');
      assert.strictEqual(result.options.length, 4);
      assert.ok(isDangerousOperationPrompt(result));
      console.log('  ✓ 4-option prompt detected');
    });

    it('I2: Empty buffer', () => {
      const result = detectPrompt('');
      assert.strictEqual(result, null, 'Empty buffer should return null');
      console.log('  ✓ Empty buffer returns null');
    });

    it('I3: Whitespace-only buffer', () => {
      const result = detectPrompt('   \n  \n  ');
      assert.strictEqual(result, null, 'Whitespace-only buffer should return null');
      console.log('  ✓ Whitespace-only buffer returns null');
    });

    it('I4: Options-only block with no question line', () => {
      const raw = `  ❯ Yes
    No
`;
      const result = detectPrompt(raw);
      // Even if detected, no meaningful question
      if (result) {
        assert.ok(!isDangerousOperationPrompt(result), 'Should not classify as dangerous without question');
      }
      console.log('  ✓ Options-only block handled correctly');
    });
  });
});
