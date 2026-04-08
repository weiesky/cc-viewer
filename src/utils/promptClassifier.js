/**
 * Prompt classification utilities for PTY prompt detection.
 * Shared by ChatView.jsx and ChatMessage.jsx.
 */

export function isPlanApprovalPrompt(prompt) {
  if (!prompt || !prompt.question) return false;
  const q = prompt.question.toLowerCase();
  return /plan/i.test(q) && (/approv/i.test(q) || /proceed/i.test(q) || /accept/i.test(q));
}

export function isDangerousOperationPrompt(prompt) {
  if (!prompt || !prompt.question) return false;
  const q = prompt.question;
  if (isPlanApprovalPrompt(prompt)) return false;
  // Match Claude Code permission prompt patterns:
  // - "Do you want to make this edit" / "Do you want to write" / "Do you want to proceed"
  // - "Allow X to Y" / "Want to allow" / "wants to (execute|run|...)"
  // - "May Claude read/write/execute..." / "grant access/permission" / "permit"
  if (/do you want to (make this edit|write|proceed|create|delete)|allow\b.*\bto\b|want to allow|wants to (execute|run|read|write|access|create|delete|modify|use)|may .*(read|write|execute|run|access|create|delete|modify)|grant .*(access|permission)|permit/i.test(q)) {
    return true;
  }
  // Also detect by options: if options contain both Allow/Yes and Deny/No keywords
  if (prompt.options && prompt.options.length >= 2) {
    const texts = prompt.options.map(o => (o.text || '').toLowerCase());
    const hasAllow = texts.some(t => /^allow|^yes/i.test(t));
    const hasDeny = texts.some(t => /^no$|^no[^a-z]|^deny|^reject/i.test(t));
    if (hasAllow && hasDeny) return true;
  }
  return false;
}
