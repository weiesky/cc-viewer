import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiUrl } from '../utils/apiUrl';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { showMinimap } from '@replit/codemirror-minimap';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { php } from '@codemirror/lang-php';
import { xml } from '@codemirror/lang-xml';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { go } from '@codemirror/lang-go';
import { keymap } from '@codemirror/view';
import { t as i18n } from '../i18n';
import { renderMarkdown } from '../utils/markdown';
import styles from './FileContentView.module.css';

const LANG_MAP = {
  js: javascript,
  jsx: javascript,
  ts: javascript,
  tsx: javascript,
  py: python,
  java: java,
  c: cpp,
  cpp: cpp,
  cc: cpp,
  cxx: cpp,
  h: cpp,
  hpp: cpp,
  go: go,
  rs: rust,
  php: php,
  html: xml,
  htm: xml,
  xml: xml,
  svg: xml,
  json: json,
  yml: yaml,
  yaml: yaml,
  md: markdown,
  markdown: markdown,
  css: css,
  scss: css,
  sass: css,
  less: css,
  sql: sql,
};

function getLanguageExtension(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return LANG_MAP[ext] ? [LANG_MAP[ext]()] : [];
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 静态主题 Extension — 使用 CSS 变量以适配 light/dark
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-base-alt)',
    color: 'var(--text-primary)',
    height: '100%',
    overflow: 'visible',
  },
  // 隐藏 CodeMirror 内置行号栏（由外部行号栏替代），但保留 minimap
  '.cm-gutters:not(.cm-minimap-gutter)': {
    display: 'none',
  },
  // scroller 绝对定位以支持横向滚动
  '& .cm-scroller': {
    position: 'absolute',
    inset: '0',
    fontFamily: "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
    fontSize: '13px',
    lineHeight: '1.5',
  },
  // minimap 样式（位置由插件自行管理）
  '.cm-minimap-gutter': {
    background: 'var(--bg-base-alt)',
    borderLeft: '1px solid var(--border-primary)',
  },
  '.cm-minimap-overlay': {
    border: '1px solid rgba(158, 174, 235, 0.8)',
    background: 'rgba(95, 110, 185, 0.45)',
    borderRadius: '2px',
    transition: 'opacity 0.2s ease',
  },
  '.cm-minimap-gutter:hover .cm-minimap-overlay': {
    border: '1px solid rgba(178, 194, 255, 0.95)',
    background: 'rgba(95, 110, 225, 0.45)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--overlay-light-faint)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--text-primary)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--color-selection-bg)',
  },
  // Search / Replace 面板
  '.cm-panels': {
    backgroundColor: 'var(--bg-container)',
    borderBottom: '1px solid var(--border-secondary)',
  },
  '.cm-panel.cm-search': {
    padding: '8px 12px 10px',
    fontSize: '13px',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-container)',
  },
  '.cm-panel.cm-search input[type=text], .cm-panel.cm-search input[main]': {
    height: '26px',
    padding: '2px 11px',
    fontSize: '100%',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-light)',
    borderRadius: '6px',
    outline: 'none',
    transition: 'border-color 0.2s',
    verticalAlign: 'middle',
    boxSizing: 'border-box',
  },
  '.cm-panel.cm-search input[type=text]:focus': {
    borderColor: 'var(--color-primary)',
    boxShadow: '0 0 0 2px var(--color-primary-bg-light)',
  },
  // 覆盖 CodeMirror 基础主题的 .cm-textfield
  '.cm-textfield': {
    height: '26px',
    padding: '2px 11px',
    fontSize: '100%',
    color: 'var(--text-primary) !important',
    backgroundColor: 'var(--bg-elevated) !important',
    border: '1px solid var(--border-light) !important',
    borderRadius: '6px',
    outline: 'none',
    verticalAlign: 'middle',
    boxSizing: 'border-box',
  },
  '.cm-textfield:focus': {
    borderColor: 'var(--color-primary) !important',
    boxShadow: '0 0 0 2px var(--color-primary-bg-light)',
  },
  '.cm-panel.cm-search input[type=checkbox]': {
    accentColor: 'var(--color-primary)',
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
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
    backgroundImage: 'none !important',
    border: '1px solid var(--border-light)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background 0.2s, border-color 0.2s, color 0.2s',
    verticalAlign: 'middle',
    lineHeight: '1',
  },
  '.cm-panel.cm-search button:hover': {
    color: 'var(--text-white)',
    backgroundColor: 'var(--overlay-light-faint)',
    backgroundImage: 'none !important',
    borderColor: 'var(--text-disabled)',
  },
  '.cm-panel.cm-search button:active': {
    backgroundColor: 'var(--overlay-light-medium)',
    backgroundImage: 'none !important',
  },
  // 覆盖 CodeMirror 基础主题的 .cm-button 渐变
  '.cm-button': {
    height: '26px',
    padding: '2px 12px',
    fontSize: '100%',
    color: 'var(--text-primary) !important',
    backgroundColor: 'transparent !important',
    backgroundImage: 'none !important',
    border: '1px solid var(--border-light) !important',
    borderRadius: '6px',
    cursor: 'pointer',
    lineHeight: '1',
  },
  '.cm-button:hover': {
    color: 'var(--text-white) !important',
    backgroundColor: 'var(--overlay-light-faint) !important',
    backgroundImage: 'none !important',
    borderColor: 'var(--text-disabled) !important',
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
    color: 'var(--text-muted)',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '6px',
  },
  '.cm-panel.cm-search button[name=close]:hover': {
    color: 'var(--text-primary)',
    backgroundColor: 'var(--bg-surface)',
  },
  '.cm-panel.cm-search label': {
    fontSize: '13px',
    color: 'var(--text-light)',
    verticalAlign: 'middle',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search label:hover': {
    color: 'var(--text-primary)',
  },
  '.cm-panel.cm-search [name=close]': {
    fontSize: '16px',
  },
  // 搜索高亮匹配色
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255, 213, 79, 0.25)',
    outline: '1px solid rgba(255, 213, 79, 0.4)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'rgba(255, 152, 0, 0.35)',
  },
}, { dark: typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') !== 'light' : true });

// 语法高亮配色 — 使用 CSS 变量
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword, #ff7b72)' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: 'var(--code-name, #ffa657)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--code-function, #d2a8ff)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--code-constant, #79c0ff)' },
  { tag: [t.definition(t.name), t.separator], color: 'var(--text-primary, #e0e0e0)' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: 'var(--code-name, #ffa657)' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: 'var(--code-constant, #79c0ff)' },
  { tag: [t.meta, t.comment], color: 'var(--code-comment, #8b949e)', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--code-constant, #79c0ff)', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--code-name, #ffa657)' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: 'var(--code-constant, #79c0ff)' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: 'var(--code-string, #a5d6ff)' },
  { tag: t.invalid, color: 'var(--code-error, #f85149)' },
]);

const syntaxTheme = syntaxHighlighting(highlightStyle);

export default function FileContentView({ filePath, onClose, editorSession, scrollToLine }) {
  const [content, setContent] = useState(null);
  const [currentContent, setCurrentContent] = useState(null);
  const [error, setError] = useState(null);
  const [fileSize, setFileSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [lineCount, setLineCount] = useState(0);
  const [closing, setClosing] = useState(false);
  const isMdFile = /\.md$/i.test(filePath);
  const [viewMode, setViewMode] = useState(isMdFile ? 'markdown' : 'text');
  const containerRef = useRef(null);
  const mounted = useRef(true);
  const saveTimeoutRef = useRef(null);
  const saveRef = useRef(null);
  const lineNumRef = useRef(null);
  const editorViewRef = useRef(null);
  const editorWrapperRef = useRef(null);

  const isDirty = content !== null && currentContent !== null && content !== currentContent;

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const el = containerRef.current;
    if (el) {
      el.addEventListener('animationend', () => onClose(), { once: true });
    } else {
      onClose();
    }
  }, [closing, onClose]);

  const doSave = useCallback(async () => {
    if (!isDirty) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(apiUrl('/api/file-content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: currentContent, ...(editorSession ? { editorSession: true } : {}) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (mounted.current) {
        setContent(currentContent);
        setFileSize(data.size);
        setSaveStatus('saved');
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          if (mounted.current) setSaveStatus(null);
        }, 2000);
      }
    } catch (err) {
      if (mounted.current) {
        setSaveStatus('failed');
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          if (mounted.current) setSaveStatus(null);
        }, 3000);
      }
    }
  }, [isDirty, filePath, currentContent]);

  saveRef.current = doSave;

  // 纵向滚动同步：CodeMirror 滚动时同步行号栏
  const scrollSyncExtension = useMemo(() =>
    EditorView.updateListener.of((update) => {
      if (update.geometryChanged || update.viewportChanged) {
        const scroller = update.view.scrollDOM;
        if (lineNumRef.current) {
          lineNumRef.current.scrollTop = scroller.scrollTop;
        }
      }
    }),
  []);

  // 手动绑定 scroll 事件以获得实时同步
  const onEditorCreate = useCallback((view) => {
    editorViewRef.current = view;
    const scroller = view.scrollDOM;
    const syncScroll = () => {
      if (lineNumRef.current) {
        lineNumRef.current.scrollTop = scroller.scrollTop;
      }
    };
    scroller.addEventListener('scroll', syncScroll);
    // 初始同步
    syncScroll();
  }, []);

  const loadFileContent = useCallback(() => {
    mounted.current = true;
    setContent(null);
    setCurrentContent(null);
    setError(null);
    setLoading(true);
    setLineCount(0);

    fetch(apiUrl(`/api/file-content?path=${encodeURIComponent(filePath)}${editorSession ? '&editorSession=true' : ''}`))
      .then((r) => {
        if (!r.ok) {
          return r
            .json()
            .then((err) => {
              throw new Error(err.error || 'Failed to load');
            })
            .catch(() => {
              throw new Error(`HTTP ${r.status}`);
            });
        }
        return r.json();
      })
      .then((data) => {
        if (mounted.current) {
          setContent(data.content);
          setCurrentContent(data.content);
          setFileSize(data.size);
          setLineCount(data.content.split('\n').length);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted.current) {
          setError(`${i18n('ui.fileLoadError')}: ${err.message}`);
          setLoading(false);
        }
      });
  }, [filePath, editorSession]);

  useEffect(() => {
    loadFileContent();
    return () => {
      mounted.current = false;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [loadFileContent]);

  // 滚动到指定行
  useEffect(() => {
    if (scrollToLine && editorViewRef.current && !loading && content !== null) {
      const view = editorViewRef.current;
      const lineNum = Math.min(scrollToLine, view.state.doc.lines);
      const line = view.state.doc.line(lineNum);
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
      });
    }
  }, [scrollToLine, loading, content]);

  const extensions = useMemo(() => {
    const exts = [
      ...getLanguageExtension(filePath),
      syntaxTheme,
      scrollSyncExtension,
      keymap.of([{
        key: 'Mod-s',
        run: () => { saveRef.current?.(); return true; },
      }]),
    ];

    // 添加 minimap（优化配置）
    exts.push(
      showMinimap.compute(['doc'], (state) => {
        return {
          create: (view) => {
            const dom = document.createElement('div');
            return { dom };
          },
          displayText: 'characters', // 使用字符显示而非色块，更清晰
          showOverlay: 'mouse-over',  // 仅在鼠标悬停时显示 overlay，减少视觉干扰
        };
      })
    );

    return exts;
  }, [filePath, scrollSyncExtension]);

  // 跟踪文档行数变化
  const handleChange = useCallback((value) => {
    setCurrentContent(value);
    setLineCount(value.split('\n').length);
  }, []);

  const saveStatusText = saveStatus === 'saving'
    ? i18n('ui.saving')
    : saveStatus === 'saved'
      ? i18n('ui.saved')
      : saveStatus === 'failed'
        ? i18n('ui.saveFailed')
        : null;

  // 生成行号
  const lineNumbers = useMemo(() => {
    if (lineCount <= 0) return null;
    const lines = [];
    for (let i = 1; i <= lineCount; i++) {
      lines.push(<div key={i} className={styles.lineNumRow}>{i}</div>);
    }
    return lines;
  }, [lineCount]);

  return (
    <div ref={containerRef} className={`${styles.fileContentView}${closing ? ` ${styles.closing}` : ''}`}>
      {editorSession && (
        <div className={styles.editorBanner} onClick={handleClose} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleClose(); }}>
          {i18n('ui.editorSession.banner')}
        </div>
      )}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={handleClose} title={i18n('ui.backToChat')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className={styles.filePath}>{filePath}</span>
          {fileSize > 0 && (
            <span className={styles.fileSize}>{formatFileSize(fileSize)}</span>
          )}
        </div>
        <div className={styles.headerRight}>
          {saveStatusText && (
            <span className={`${styles.saveStatus} ${saveStatus === 'failed' ? styles.saveStatusFailed : saveStatus === 'saved' ? styles.saveStatusSaved : ''}`}>
              {saveStatusText}
            </span>
          )}
          {isMdFile && (
            <button
              className={`${styles.viewToggleBtn}${viewMode === 'markdown' ? ` ${styles.viewToggleActive}` : ''}`}
              onClick={() => setViewMode(v => v === 'markdown' ? 'text' : 'markdown')}
              title={viewMode === 'markdown' ? i18n('ui.viewText') : i18n('ui.viewMarkdown')}
            >
              {viewMode === 'markdown' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h20v18H2z"/><path d="M7 15V9l2 3 2-3v6"/><path d="M17 9l-2 3h4l-2 3"/>
                </svg>
              )}
              {viewMode === 'markdown' ? i18n('ui.viewText') : i18n('ui.viewMarkdown')}
            </button>
          )}
          <button
            className={styles.saveBtn}
            onClick={doSave}
            disabled={!isDirty || saveStatus === 'saving'}
            title={`${i18n('ui.save')} (Ctrl+S)`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            {i18n('ui.save')}
          </button>
          <button className={styles.closeBtn} onClick={handleClose} title={i18n('ui.backToChat')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.contentContainer}>
        {error && <div className={styles.error}>{error}</div>}
        {loading && !error && <div className={styles.loading}>{i18n('ui.loading')}</div>}
        {!loading && content !== null && viewMode === 'markdown' && isMdFile && (
          <div className={styles.markdownPreview} dangerouslySetInnerHTML={{ __html: renderMarkdown(isDirty ? currentContent : content) }} />
        )}
        {!loading && content !== null && !(viewMode === 'markdown' && isMdFile) && (
          <div className={styles.editorWrapper} ref={editorWrapperRef}>
            <div className={styles.lineNumCol} ref={lineNumRef}>
              {lineNumbers}
            </div>
            <div className={styles.editorCol}>
              <CodeMirror
                value={content}
                height="100%"
                theme={editorTheme}
                extensions={extensions}
                onChange={handleChange}
                onCreateEditor={onEditorCreate}
                basicSetup={{
                  lineNumbers: false,
                  foldGutter: false,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  bracketMatching: true,
                  autocompletion: false,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
