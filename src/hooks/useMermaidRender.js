/**
 * Auto-render Mermaid diagrams via MutationObserver.
 * Lazily loads mermaid.js on first encounter of a `code.language-mermaid` block.
 * Call `setupMermaidAutoRender()` once at app init — no per-component changes needed.
 * Call `reinitializeMermaid()` on theme change to re-render with new colors.
 */
import DOMPurify from 'dompurify';

let _mermaidPromise = null;
let _mermaidInstance = null;
let _observerStarted = false;
let _scanTimer = null;
let _pendingNodes = new Set();

const THEME_DARK = {
  theme: 'dark',
  darkMode: true,
  themeVariables: {
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
  },
};

const THEME_LIGHT = {
  theme: 'default',
  darkMode: false,
  themeVariables: {
    darkMode: false,
    background: '#FFFFFF',
    primaryColor: '#dce8f5',
    primaryTextColor: '#1a1a1a',
    primaryBorderColor: '#E0E0E0',
    lineColor: '#0969DA',
    secondaryColor: '#F0F0F0',
    tertiaryColor: '#F5F5F5',
    nodeTextColor: '#1a1a1a',
    edgeLabelBackground: '#FFFFFF',
  },
};

function getCurrentThemeConfig() {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? THEME_LIGHT : THEME_DARK;
}

function loadMermaid() {
  if (_mermaidPromise) return _mermaidPromise;
  _mermaidPromise = import('mermaid').then(mod => {
    const m = mod.default;
    const cfg = getCurrentThemeConfig();
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      flowchart: { useMaxWidth: true },
      ...cfg,
    });
    _mermaidInstance = m;
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

  const m = await loadMermaid();
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
      wrapper.dataset.mermaidSrc = src;
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

/**
 * Re-initialize mermaid with current theme and re-render all existing diagrams.
 * Call this from handleThemeColorChange.
 */
export async function reinitializeMermaid() {
  if (!_mermaidInstance) return;
  const cfg = getCurrentThemeConfig();
  _mermaidInstance.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    flowchart: { useMaxWidth: true },
    ...cfg,
  });

  const diagrams = document.querySelectorAll('.mermaid-diagram[data-mermaid-src]');
  for (const wrapper of diagrams) {
    const src = wrapper.dataset.mermaidSrc;
    try {
      const id = 'mmd-' + Math.random().toString(36).slice(2, 9);
      const { svg } = await _mermaidInstance.render(id, src);
      wrapper.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['style', 'foreignObject'],
      });
    } catch {
      // keep existing SVG if re-render fails
    }
  }
}
