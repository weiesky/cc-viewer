import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { DownloadOutlined, CopyOutlined, CameraOutlined } from '@ant-design/icons';
import { Modal, message } from 'antd';
import { apiUrl } from '../utils/apiUrl';
import { useMarkdownExport } from '../hooks/useMarkdownExport';
import { detectMdExtensions } from '../utils/mdExtensionDetect';
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
import { isMobile } from '../env';
import styles from './FileContentView.module.css';

// 单独 chunk + 仅在打开 .md 文件时才加载，避免 ~850KB MDXEditor 进首屏
const MdxEditorPanel = lazy(() => import('./MdxEditorPanel'));

// Feature flag：默认开；用户可在 devtools 里 localStorage.setItem('mdxEditorEnabled','false') 回退
function readMdxFeatureFlag() {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem('mdxEditorEnabled') !== 'false'
      : true;
  } catch {
    return true;
  }
}

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
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  // MDX 编辑相关 state
  const [mdxFeatureEnabled] = useState(readMdxFeatureFlag);
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [forceMdxOverride, setForceMdxOverride] = useState(false);
  const containerRef = useRef(null);
  const mounted = useRef(true);
  const saveTimeoutRef = useRef(null);
  const saveRef = useRef(null);
  const lineNumRef = useRef(null);
  const editorViewRef = useRef(null);
  const markdownPreviewRef = useRef(null);
  const downloadWrapRef = useRef(null);
  const editorWrapperRef = useRef(null);
  const mdxRef = useRef(null);
  // 总是反映最新 filePath（不通过 useCallback closure），doSave 完成回调用它做
  // "保存中切文件 race" 的兜底比对：保存时 snapshot 当前 filePath，保存完成后
  // 若 filePathRef.current 已变（用户切到别的文件），不再 setContent，避免把
  // 旧文件的内容写到新文件的 state。
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  const isDirty = content !== null && currentContent !== null && content !== currentContent;

  // 「使用 MDX 编辑」= flag 开 + 非移动端 + (无扩展语法 OR 用户强制覆盖)
  // 移动端直接降级到旧 marked 渲染：屏幕小 + 触屏体验差 + bundle 加载成本高，
  // GUI 编辑能力性价比不足，统一走 fallback 预览路径。
  const useMdxEditor = isMdFile && mdxFeatureEnabled && !isMobile && (!extensionDetected || forceMdxOverride);
  // 「展示旧 marked 预览」= viewMode='markdown' && !useMdx
  const useLegacyPreview = isMdFile && viewMode === 'markdown' && !useMdxEditor;

  // 取当前文本：MDX 模式优先从 editor ref 读 markdown（保持 GUI 编辑里的最新值），
  // 否则走原 content/currentContent。
  // 空串兜底：跟 doSave 一致——MDX mount 早期可能返回 ''，若原文件非空则用
  // currentContent/content 回退，避免 Copy 按钮在快速点击时复制到空字符串。
  const getCurrentText = useCallback(() => {
    if (useMdxEditor && mdxRef.current?.getMarkdown) {
      try {
        const fromMdx = mdxRef.current.getMarkdown() ?? '';
        if (fromMdx.length > 0 || (content?.length ?? 0) === 0) {
          return fromMdx;
        }
      } catch {
        // fall through to legacy path
      }
    }
    return (isDirty ? currentContent : content) ?? '';
  }, [useMdxEditor, isDirty, currentContent, content]);

  const { handleCopy, handleSaveAs, handleSaveAsImage } = useMarkdownExport({
    getText: getCurrentText,
    getSnapshotTarget: useCallback(() => markdownPreviewRef.current, []),
    onDone: useCallback(() => setDownloadMenuOpen(false), []),
  });

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const onDocClick = (e) => {
      if (downloadWrapRef.current && !downloadWrapRef.current.contains(e.target)) {
        setDownloadMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setDownloadMenuOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [downloadMenuOpen]);

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

  // MDX onChange：把 markdown 同步到 currentContent，触发 isDirty + 行号刷新
  const handleMdxChange = useCallback((md) => {
    if (typeof md !== 'string') return;
    setCurrentContent(md);
    setLineCount(md.split('\n').length);
  }, []);

  // viewMode 切换前的 dirty 守护：弹 confirm 让用户保存或丢弃
  const requestViewModeSwitch = useCallback((next) => {
    if (next === viewMode) return;
    if (!isDirty) { setViewMode(next); return; }
    Modal.confirm({
      title: i18n('ui.mdEditor.unsavedConfirmTitle'),
      content: i18n('ui.mdEditor.unsavedConfirmContent'),
      okText: i18n('ui.mdEditor.unsavedConfirmDiscard'),
      cancelText: i18n('ui.mdEditor.unsavedConfirmKeep'),
      okButtonProps: { danger: true },
      onOk: () => {
        // 丢弃：把 currentContent 回滚到 content（消除 isDirty）后再切
        setCurrentContent(content);
        setLineCount((content ?? '').split('\n').length);
        setViewMode(next);
      },
    });
  }, [viewMode, isDirty, content]);

  // 「强制 GUI 编辑」：用户明确接受可能损坏扩展语法
  const requestForceMdx = useCallback(() => {
    Modal.confirm({
      title: i18n('ui.mdEditor.forceGuiEdit'),
      content: i18n('ui.mdEditor.forceGuiEditConfirm'),
      okText: i18n('ui.mdEditor.forceGuiEdit'),
      cancelText: i18n('ui.mdEditor.unsavedConfirmKeep'),
      okButtonProps: { danger: true },
      onOk: () => setForceMdxOverride(true),
    });
  }, []);

  const doSave = useCallback(async () => {
    if (!isDirty) return;
    // MDX 模式下优先从 editor ref 取最新 markdown（onChange 是 debounced，currentContent 可能滞后）
    let saveContent = currentContent;
    if (useMdxEditor && mdxRef.current?.getMarkdown) {
      try {
        const fromMdx = mdxRef.current.getMarkdown();
        // 防御：MDX 在 mount 早期 / 状态异常时 getMarkdown() 可能返回 ''，
        // 若原文件非空则不要让空串覆盖（用 currentContent 兜底）。
        if (typeof fromMdx === 'string' && (fromMdx.length > 0 || (content?.length ?? 0) === 0)) {
          saveContent = fromMdx;
        }
      } catch {
        // fall through to currentContent
      }
    }
    // Snapshot 当前 filePath，用于保存完成后比对是否切了文件
    const startFilePath = filePathRef.current;
    setSaveStatus('saving');
    try {
      const res = await fetch(apiUrl('/api/file-content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: saveContent, ...(editorSession ? { editorSession: true } : {}) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      // 切文件后落空保护：若保存期间用户切到别的文件，filePathRef 已变，
      // 此时绝不能 setContent (会把旧文件的内容写到新文件的 state)
      if (mounted.current && filePathRef.current === startFilePath) {
        setContent(saveContent);
        setCurrentContent(saveContent);
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
  }, [isDirty, filePath, currentContent, useMdxEditor, editorSession]);

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
    // 切换文件时重置 MDX 相关 state，避免上一个文件的扩展检测/强制覆盖跨文件污染
    setExtensionDetected(false);
    setForceMdxOverride(false);

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
          // 仅对 .md 且 flag 开启时做扩展检测，命中则提示 + 走旧 marked 渲染（自动 fallback）
          if (isMdFile && mdxFeatureEnabled) {
            const det = detectMdExtensions(data.content);
            if (det.anyExtension) {
              setExtensionDetected(true);
              try {
                // 用固定 key 去重，连续打开多个含扩展的 .md 不会叠 toast
                message.open({ key: 'mdxExtFallback', type: 'info', content: i18n('ui.mdEditor.extensionFallbackToast') });
              } catch {
                // 没 antd App 上下文也无所谓
              }
            }
          }
        }
      })
      .catch((err) => {
        if (mounted.current) {
          setError(`${i18n('ui.fileLoadError')}: ${err.message}`);
          setLoading(false);
        }
      });
  }, [filePath, editorSession, isMdFile, mdxFeatureEnabled]);

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
            <div className={styles.downloadWrap} ref={downloadWrapRef}>
              <button
                className={styles.viewToggleBtn}
                onClick={() => setDownloadMenuOpen(v => !v)}
                title={i18n('ui.saveAs')}
                aria-label={i18n('ui.saveAs')}
                aria-expanded={downloadMenuOpen}
              >
                <DownloadOutlined />
              </button>
              {downloadMenuOpen && (
                <div className={styles.downloadMenu}>
                  <button className={styles.downloadMenuItem} onClick={handleSaveAs}>
                    <DownloadOutlined />
                    <span>{i18n('ui.saveAsMd')}</span>
                  </button>
                  <button className={styles.downloadMenuItem} onClick={handleCopy}>
                    <CopyOutlined />
                    <span>{i18n('ui.copyTextContent')}</span>
                  </button>
                  <button
                    className={styles.downloadMenuItem}
                    onClick={handleSaveAsImage}
                    disabled={viewMode !== 'markdown' || useMdxEditor}
                    title={
                      viewMode !== 'markdown'
                        ? i18n('ui.saveAsImageHintMd')
                        : useMdxEditor
                          ? i18n('ui.mdEditor.saveAsImageDisabled')
                          : undefined
                    }
                  >
                    <CameraOutlined />
                    <span>{i18n('ui.saveAsImage')}</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {isMdFile && extensionDetected && !forceMdxOverride && mdxFeatureEnabled && !isMobile && (
            <button
              className={styles.viewToggleBtn}
              onClick={requestForceMdx}
              title={i18n('ui.mdEditor.forceGuiEditConfirm')}
            >
              {i18n('ui.mdEditor.forceGuiEdit')}
            </button>
          )}
          {/* MDX 状态下三态切换器（DiffSourceToggleWrapper 在 toolbar 里）已包含 source 模式访问，
              外层不再放重复按钮；fallback / 旧 marked / 含扩展自动降级 / 移动端 状态保留作为兜底入口。 */}
          {isMdFile && !useMdxEditor && (
            <button
              className={`${styles.viewToggleBtn}${viewMode === 'markdown' ? ` ${styles.viewToggleActive}` : ''}`}
              onClick={() => requestViewModeSwitch(viewMode === 'markdown' ? 'text' : 'markdown')}
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
        {!loading && content !== null && viewMode === 'markdown' && isMdFile && useMdxEditor && (
          <Suspense fallback={<div className={styles.loading}>{i18n('ui.loading')}</div>}>
            <MdxEditorPanel
              key={filePath}
              ref={mdxRef}
              initialMarkdown={content}
              onChange={handleMdxChange}
            />
          </Suspense>
        )}
        {!loading && content !== null && useLegacyPreview && (
          <div ref={markdownPreviewRef} className={styles.markdownPreview} dangerouslySetInnerHTML={{ __html: renderMarkdown(isDirty ? currentContent : content) }} />
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
