import React, { useState, useEffect } from 'react';
import { Typography } from 'antd';
import { t } from '../i18n';
import { renderMarkdown } from '../utils/markdown';
import { escapeHtml } from '../utils/helpers';
import styles from './ToolResultView.module.css';

const { Text } = Typography;

// File extension to language mapping
const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  md: 'markdown', sql: 'sql',
};

// Tools whose results are typically code/file content
const CODE_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'];

function detectLang(toolName, toolInput, resultText) {
  if (!toolInput) return null;

  // 1. Try file_path extension (works for Read, Write, Edit)
  const filePath = toolInput.file_path || '';
  if (filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    if (EXT_LANG[ext]) return EXT_LANG[ext];
  }

  // 2. Bash → shell output
  if (toolName === 'Bash') return 'shell-output';

  // 3. Glob → result is always a file path list
  if (toolName === 'Glob') return 'file-list';

  // 4. Grep → try glob field, then check result format
  if (toolName === 'Grep') {
    const glob = toolInput.glob || '';
    if (glob) {
      // Handle compound globs like "*.{js,jsx}" → try each part
      const parts = glob.replace(/[{}*]/g, ',').split(',').filter(Boolean);
      for (const p of parts) {
        const ext = p.replace(/^\./, '').toLowerCase();
        if (EXT_LANG[ext]) return EXT_LANG[ext];
      }
    }
    // Grep output_mode=files_with_matches → file list
    if (toolInput.output_mode === 'files_with_matches' || !toolInput.output_mode) {
      return 'file-list';
    }
    // Grep content mode with file:line: prefix → try detect from file extensions in result
    if (toolInput.output_mode === 'content' && resultText) {
      const match = resultText.match(/^[\w/.~-]+\.([\w]+):\d+/m);
      if (match && EXT_LANG[match[1].toLowerCase()]) {
        return EXT_LANG[match[1].toLowerCase()];
      }
    }
    return 'shell-output';
  }

  // 5. path field is a directory (no useful extension) — try content-based detection
  if (resultText) {
    return detectLangFromContent(resultText);
  }

  return null;
}

// Content-based language detection by scanning for characteristic patterns
function detectLangFromContent(text) {
  const sample = text.substring(0, 2000);

  // JSON: starts with { or [
  if (/^\s*[\[{]/.test(sample) && /[}\]]\s*$/.test(sample.trimEnd())) return 'json';

  // HTML/XML: starts with < or has doctype
  if (/^\s*<!DOCTYPE|^\s*<html|^\s*<\?xml/i.test(sample)) return 'html';

  // Python: def/class/import with colon, or shebang
  if (/^#!.*python/m.test(sample)) return 'python';
  if (/\bdef\s+\w+\s*\(.*\)\s*:/m.test(sample) || /\bclass\s+\w+.*:/m.test(sample)) return 'python';
  if (/^\s*(from\s+\w+\s+import|import\s+\w+)/m.test(sample) && /:$/.test(sample)) return 'python';

  // Rust: fn main, let mut, impl, pub fn
  if (/\bfn\s+\w+\s*\(/.test(sample) && /\blet\s+(mut\s+)?\w+/.test(sample)) return 'rust';

  // Go: func, package main, :=
  if (/^package\s+\w+/m.test(sample) && /\bfunc\s+/.test(sample)) return 'go';

  // Java: public class, public static void
  if (/\bpublic\s+(class|interface|static)\b/.test(sample)) return 'java';

  // Ruby: def/end, do/end
  if (/\bdef\s+\w+/.test(sample) && /\bend\b/.test(sample) && !/;/.test(sample)) return 'ruby';

  // Shell script: shebang or heavy use of shell builtins
  if (/^#!.*\b(bash|sh|zsh)\b/m.test(sample)) return 'shell';

  // JS/TS: const/let/var + arrow functions or require/import
  if (/\b(const|let|var)\s+\w+\s*=/.test(sample) && (/=>/.test(sample) || /\brequire\s*\(/.test(sample))) return 'javascript';
  if (/^\s*import\s+.*\s+from\s+['"]/.test(sample)) return 'javascript';
  if (/^\s*export\s+(default\s+)?(function|class|const)\b/m.test(sample)) return 'javascript';

  // CSS: selectors with { property: value }
  if (/[.#][\w-]+\s*\{[\s\S]*?:\s*[\w#]/.test(sample)) return 'css';

  // YAML: key: value pattern without braces
  if (/^[\w-]+\s*:(\s+\S|$)/m.test(sample) && !/[{;]/.test(sample)) return 'yaml';

  // SQL
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE)\b/i.test(sample)) return 'sql';

  return null;
}

// Lightweight syntax highlight rules per language
const RULES = {
  javascript: [
    { pattern: /(\/\/.*$)/gm, cls: 'hl-comment' },
    { pattern: /(\/\*[\s\S]*?\*\/)/g, cls: 'hl-comment' },
    { pattern: /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g, cls: 'hl-string' },
    { pattern: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|default|new|this|async|await|try|catch|throw|switch|case|break|continue|typeof|instanceof|in|of|null|undefined|true|false)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
  typescript: null, // will fallback to javascript
  python: [
    { pattern: /(#.*$)/gm, cls: 'hl-comment' },
    { pattern: /('''[\s\S]*?'''|"""[\s\S]*?"""|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, cls: 'hl-string' },
    { pattern: /\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|raise|with|yield|lambda|pass|break|continue|and|or|not|in|is|None|True|False|self|async|await)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
  go: [
    { pattern: /(\/\/.*$)/gm, cls: 'hl-comment' },
    { pattern: /(\/\*[\s\S]*?\*\/)/g, cls: 'hl-comment' },
    { pattern: /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)/g, cls: 'hl-string' },
    { pattern: /\b(func|return|if|else|for|range|switch|case|default|break|continue|go|defer|select|chan|map|struct|interface|package|import|var|const|type|nil|true|false|make|new|append|len|cap)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
  rust: [
    { pattern: /(\/\/.*$)/gm, cls: 'hl-comment' },
    { pattern: /("(?:[^"\\]|\\.)*")/g, cls: 'hl-string' },
    { pattern: /\b(fn|let|mut|return|if|else|for|while|loop|match|struct|enum|impl|trait|pub|use|mod|crate|self|super|where|async|await|move|ref|true|false|Some|None|Ok|Err)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
  java: [
    { pattern: /(\/\/.*$)/gm, cls: 'hl-comment' },
    { pattern: /(\/\*[\s\S]*?\*\/)/g, cls: 'hl-comment' },
    { pattern: /("(?:[^"\\]|\\.)*")/g, cls: 'hl-string' },
    { pattern: /\b(public|private|protected|class|interface|extends|implements|return|if|else|for|while|switch|case|break|continue|new|this|super|static|final|void|int|long|double|float|boolean|char|String|import|package|try|catch|throw|throws|null|true|false)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*[fFdDlL]?)\b/g, cls: 'hl-number' },
  ],
  ruby: [
    { pattern: /(#.*$)/gm, cls: 'hl-comment' },
    { pattern: /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, cls: 'hl-string' },
    { pattern: /\b(def|end|class|module|return|if|elsif|else|unless|for|while|do|begin|rescue|ensure|raise|yield|block_given\?|nil|true|false|self|require|include|attr_accessor|attr_reader)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
  css: [
    { pattern: /(\/\*[\s\S]*?\*\/)/g, cls: 'hl-comment' },
    { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, cls: 'hl-string' },
    { pattern: /([.#][\w-]+)/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*(px|em|rem|%|vh|vw|s|ms)?)\b/g, cls: 'hl-number' },
  ],
  json: [
    { pattern: /("(?:[^"\\]|\\.)*")\s*:/g, cls: 'hl-keyword' },
    { pattern: /:\s*("(?:[^"\\]|\\.)*")/g, cls: 'hl-string' },
    { pattern: /\b(true|false|null)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, cls: 'hl-number' },
  ],
  shell: [
    { pattern: /(#.*$)/gm, cls: 'hl-comment' },
    { pattern: /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, cls: 'hl-string' },
    { pattern: /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|source|alias|cd|ls|grep|find|echo|cat|mkdir|rm|cp|mv|chmod|sudo|apt|npm|pip|git)\b/g, cls: 'hl-keyword' },
  ],
  sql: [
    { pattern: /(--.*$)/gm, cls: 'hl-comment' },
    { pattern: /('(?:[^'\\]|\\.)*')/g, cls: 'hl-string' },
    { pattern: /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|SET|VALUES|INTO|DISTINCT|COUNT|SUM|AVG|MAX|MIN|LIKE|BETWEEN|EXISTS|CASE|WHEN|THEN|ELSE|END)\b/gi, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
  html: [
    { pattern: /(<!--[\s\S]*?-->)/g, cls: 'hl-comment' },
    { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, cls: 'hl-string' },
    { pattern: /(<\/?[\w-]+|\/?>)/g, cls: 'hl-keyword' },
  ],
  xml: null, // fallback to html
  yaml: [
    { pattern: /(#.*$)/gm, cls: 'hl-comment' },
    { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, cls: 'hl-string' },
    { pattern: /^([\w.-]+)\s*:/gm, cls: 'hl-keyword' },
    { pattern: /\b(true|false|null|yes|no)\b/gi, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
  markdown: [
    { pattern: /^(#{1,6}\s.*$)/gm, cls: 'hl-keyword' },
    { pattern: /(`[^`]+`)/g, cls: 'hl-string' },
    { pattern: /(\*\*[^*]+\*\*|__[^_]+__)/g, cls: 'hl-keyword' },
    { pattern: /(\[[^\]]+\]\([^)]+\))/g, cls: 'hl-string' },
  ],
  toml: [
    { pattern: /(#.*$)/gm, cls: 'hl-comment' },
    { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, cls: 'hl-string' },
    { pattern: /^([\w.-]+)\s*=/gm, cls: 'hl-keyword' },
    { pattern: /(\[[\w.-]+\])/g, cls: 'hl-keyword' },
    { pattern: /\b(true|false)\b/g, cls: 'hl-keyword' },
    { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
  ],
};

// Fallback rules for unknown languages
const FALLBACK_RULES = [
  { pattern: /(\/\/.*$|#.*$)/gm, cls: 'hl-comment' },
  { pattern: /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g, cls: 'hl-string' },
  { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
];

// Shell output: highlight file paths and line numbers (e.g. grep/read output)
const SHELL_OUTPUT_RULES = [
  { pattern: /^([\w/.~-]+:\d+[:-])/gm, cls: 'hl-keyword' },  // file:line:
  { pattern: /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, cls: 'hl-string' },
  { pattern: /\b(\d+\.?\d*)\b/g, cls: 'hl-number' },
];

// File list output: highlight paths by extension
const FILE_LIST_RULES = [
  { pattern: /^(.*\.(jsx?|tsx?|mjs|cjs))$/gm, cls: 'hl-string' },    // JS/TS files
  { pattern: /^(.*\.(py|rb|go|rs|java|c|cpp|h))$/gm, cls: 'hl-keyword' }, // other code
  { pattern: /^(.*\.(json|ya?ml|toml|xml|html?|css|scss|less|md))$/gm, cls: 'hl-number' }, // config/markup
  { pattern: /^(.*\.(log|txt|csv|jsonl))$/gm, cls: 'hl-comment' },    // data files
];

function highlight(text, lang) {
  let resolvedLang = lang;
  // resolve aliases
  if (resolvedLang === 'typescript') resolvedLang = 'javascript';
  if (resolvedLang === 'xml') resolvedLang = 'html';
  if (resolvedLang === 'c' || resolvedLang === 'cpp') resolvedLang = 'javascript'; // close enough for basic highlighting

  let rules;
  if (resolvedLang === 'shell-output') {
    rules = SHELL_OUTPUT_RULES;
  } else if (resolvedLang === 'file-list') {
    rules = FILE_LIST_RULES;
  } else {
    rules = RULES[resolvedLang] || FALLBACK_RULES;
  }

  // Strip Read tool line number prefixes (e.g. "     1→" or "   123→")
  // before highlighting to avoid number pollution
  const lineNumRe = /^(\s*\d+→)/gm;
  const lineNums = [];
  let stripped = text.replace(lineNumRe, (match) => {
    const idx = lineNums.length;
    lineNums.push(match);
    return `\x01L${idx}\x01`;
  });

  const escaped = escapeHtml(stripped);

  // Use placeholder-based approach to avoid double-replacing.
  // Use \x02P{idx}\x02 as placeholder — these chars won't appear in
  // escaped HTML or be matched by any highlight regex.
  const placeholders = [];
  let result = escaped;

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, (match) => {
      const idx = placeholders.length;
      placeholders.push(`<span class="${rule.cls}">${match}</span>`);
      return `\x02P${idx}\x02`;
    });
  }

  // Restore highlight placeholders
  result = result.replace(/\x02P(\d+)\x02/g, (_, idx) => placeholders[parseInt(idx)]);

  // Restore line number prefixes with dedicated styling
  result = result.replace(/\x01L(\d+)\x01/g, (_, idx) => {
    const ln = escapeHtml(lineNums[parseInt(idx)]);
    return `<span class="hl-linenum">${ln}</span>`;
  });

  return result;
}

function ToolResultView({ toolName, toolInput, resultText, defaultCollapsed }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  useEffect(() => { setCollapsed(defaultCollapsed ?? false); }, [defaultCollapsed]);
  const isCodeTool = CODE_TOOLS.includes(toolName);
  const lang = isCodeTool ? detectLang(toolName, toolInput, resultText) : null;
  const displayText = resultText.length > 5000 ? resultText.substring(0, 5000) + '\n... (truncated)' : resultText;

  // Build title
  let title = toolName ? t('ui.toolReturnNamed', { name: toolName }) : 'Result';
  if (toolInput) {
    const filePath = toolInput.file_path || toolInput.path || '';
    if (filePath) {
      // show just filename
      const parts = filePath.split('/');
      title = `${toolName}: ${parts[parts.length - 1]}`;
    }
  }

  if (!isCodeTool) {
    // Task tool: render as markdown
    if (toolName === 'Task') {
      return (
        <div className={styles.plainResult}>
          <div className={styles.codeHeader}>
            <Text type="secondary" className={styles.plainTitle}>{title}</Text>
            <Text
              className={styles.codeToggle}
              onClick={() => setCollapsed(c => !c)}
            >
              {collapsed ? t('ui.expand') : t('ui.collapse')}
            </Text>
          </div>
          {!collapsed && (
            <div className={`chat-md ${styles.markdownBody}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(displayText) }} />
          )}
        </div>
      );
    }
    // Non-code tool: plain text with collapse support
    return (
      <div className={styles.plainResult}>
        <div className={styles.codeHeader}>
          <Text type="secondary" className={styles.plainTitle}>{title}</Text>
          <Text
            className={styles.codeToggle}
            onClick={() => setCollapsed(c => !c)}
          >
            {collapsed ? t('ui.expand') : t('ui.collapse')}
          </Text>
        </div>
        {!collapsed && (
          <pre className={styles.plainPre}>
            {displayText}
          </pre>
        )}
      </div>
    );
  }

  const highlighted = highlight(displayText, lang || 'fallback');

  return (
    <div className={`tool-result-code ${styles.codeResult}`}>
      <div className={styles.codeHeader}>
        <Text className={styles.codeTitle}>{title}{lang ? ` (${lang})` : ''}</Text>
        <Text
          className={styles.codeToggle}
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? t('ui.expand') : t('ui.collapse')}
        </Text>
      </div>
      {!collapsed && (
        <pre
          className={`code-highlight ${styles.codePre}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      )}
    </div>
  );
}

export default ToolResultView;
