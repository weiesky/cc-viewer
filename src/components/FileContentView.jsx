import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

// 静态主题 Extension，避免每次渲染重建
const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#0d0d0d',
    color: '#e0e0e0',
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
    background: '#0f0f0f',
    borderLeft: '1px solid #262626',
  },
  '.cm-minimap-overlay': {
    border: '1px solid rgba(128, 144, 178, 0.6)',
    background: 'rgba(95, 110, 145, 0.15)',
    borderRadius: '2px',
    transition: 'opacity 0.2s ease',
  },
  '.cm-minimap-gutter:hover .cm-minimap-overlay': {
    border: '1px solid rgba(128, 144, 178, 0.85)',
    background: 'rgba(95, 110, 145, 0.25)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  '.cm-cursor': {
    borderLeftColor: '#e0e0e0',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#264f78',
  },
}, { dark: true });

// 语法高亮配色（GitHub Dark 风格）
const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#ff7b72' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#ffa657' },
  { tag: [t.function(t.variableName), t.labelName], color: '#d2a8ff' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#79c0ff' },
  { tag: [t.definition(t.name), t.separator], color: '#e0e0e0' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#ffa657' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#79c0ff' },
  { tag: [t.meta, t.comment], color: '#8b949e', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#79c0ff', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#ffa657' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#79c0ff' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#a5d6ff' },
  { tag: t.invalid, color: '#f85149' },
]);

const syntaxTheme = syntaxHighlighting(darkHighlightStyle);

export default function FileContentView({ filePath, onClose, editorSession }) {
  const [content, setContent] = useState(null);
  const [currentContent, setCurrentContent] = useState(null);
  const [error, setError] = useState(null);
  const [fileSize, setFileSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [lineCount, setLineCount] = useState(0);
  const mounted = useRef(true);
  const saveTimeoutRef = useRef(null);
  const saveRef = useRef(null);
  const lineNumRef = useRef(null);
  const editorViewRef = useRef(null);
  const editorWrapperRef = useRef(null);

  const isDirty = content !== null && currentContent !== null && content !== currentContent;

  const doSave = useCallback(async () => {
    if (!isDirty) return;
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/file-content', {
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

    fetch(`/api/file-content?path=${encodeURIComponent(filePath)}${editorSession ? '&editorSession=true' : ''}`)
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
    <div className={styles.fileContentView}>
      {editorSession && (
        <div className={styles.editorBanner}>
          {i18n('ui.editorSession.banner')}
        </div>
      )}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onClose} title={i18n('ui.backToChat')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className={styles.filePath}>{filePath}</span>
        </div>
        <div className={styles.headerRight}>
          {saveStatusText && (
            <span className={`${styles.saveStatus} ${saveStatus === 'failed' ? styles.saveStatusFailed : saveStatus === 'saved' ? styles.saveStatusSaved : ''}`}>
              {saveStatusText}
            </span>
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
          {fileSize > 0 && (
            <span className={styles.fileSize}>{formatFileSize(fileSize)}</span>
          )}
        </div>
      </div>
      <div className={styles.contentContainer}>
        {error && <div className={styles.error}>{error}</div>}
        {loading && !error && <div className={styles.loading}>{i18n('ui.loading')}</div>}
        {!loading && content !== null && (
          <div className={styles.editorWrapper} ref={editorWrapperRef}>
            <div className={styles.lineNumCol} ref={lineNumRef}>
              {lineNumbers}
            </div>
            <div className={styles.editorCol}>
              <CodeMirror
                value={content}
                height="100%"
                theme={darkTheme}
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
