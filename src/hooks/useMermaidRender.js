/**
 * Auto-render Mermaid diagrams via MutationObserver.
 * Lazily loads mermaid.js on first encounter of a `code.language-mermaid` block.
 * Call `setupMermaidAutoRender()` once at app init — no per-component changes needed.
 */
import DOMPurify from 'dompurify';

let _mermaidPromise = null;
let _currentTheme = null;
let _observerStarted = false;
let _scanTimer = null;
let _pendingNodes = new Set();

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

/**
 * Scan a container for unrendered mermaid code blocks and replace with SVG.
 * SVG output is sanitized via DOMPurify for defense-in-depth.
 */
async function renderMermaidIn(container) {
  if (!container) return;
  const codeEls = container.querySelectorAll('code.language-mermaid');
  if (codeEls.length === 0) return;

  const isDark = document.documentElement.dataset.theme !== 'light';
  const m = await loadMermaid(isDark);
  if (!m) return;

  for (const code of codeEls) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.mermaidRendered) continue;
    pre.dataset.mermaidRendered = '1';
    const src = code.textContent;
    try {
      const id = 'mmd-' + Math.random().toString(36).slice(2, 9);
      const { svg } = await m.render(id, src);
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-diagram';
      wrapper.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['style', 'foreignObject'],
      });
      pre.replaceWith(wrapper);
    } catch {
      // render failed — keep original <pre> code block visible
    }
  }
}

function scheduleScan() {
  if (_scanTimer) return;
  _scanTimer = requestAnimationFrame(() => {
    _scanTimer = null;
    const nodes = _pendingNodes;
    _pendingNodes = new Set();
    for (const node of nodes) {
      if (node.isConnected) renderMermaidIn(node);
    }
  });
}

/**
 * Start a global MutationObserver that auto-renders mermaid blocks
 * whenever new DOM nodes are inserted (e.g. via dangerouslySetInnerHTML).
 */
export function setupMermaidAutoRender() {
  if (_observerStarted || typeof document === 'undefined') return;
  _observerStarted = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && node.querySelector?.('code.language-mermaid')) {
          _pendingNodes.add(node);
          scheduleScan();
          return;
        }
      }
    }
  });

  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
}
