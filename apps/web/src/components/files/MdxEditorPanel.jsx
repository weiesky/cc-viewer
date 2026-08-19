import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { message } from 'antd';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  diffSourcePlugin,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  ListsToggle,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertCodeBlock,
  InsertThematicBreak,
  Separator,
  UndoRedo,
  DiffSourceToggleWrapper,
} from '@mdxeditor/editor';
// 通过 base.css 把 MDXEditor 的样式包进 @layer，让 module.css 里的覆盖
// 不依赖 !important 就能赢过它。详见 MdxEditorPanel.base.css 的注释。
import './MdxEditorPanel.base.css';
import styles from './MdxEditorPanel.module.css';
import { compressImageToDataURL } from '../../utils/imageCompress';
import { mdxTranslation } from '../../i18n/mdxTranslations';
import { t as i18n, getLang } from '../../i18n';

function getDocTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

const CODE_BLOCK_LANGUAGES = {
  '': 'Plain text',
  js: 'JavaScript',
  ts: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  py: 'Python',
  sh: 'Shell',
  bash: 'Bash',
  json: 'JSON',
  yaml: 'YAML',
  md: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  cpp: 'C++',
};

// 注：v1 暂未包 ErrorBoundary——MDXEditor 内部 plugin 抛错（如解析极端畸形 markdown）
// 理论上会让 FileContentView 整片白屏。实际触发概率极低（标准 markdown + extension 检测
// 已先 fallback 走旧 marked），且 React 18 的 root error boundary 行为不稳定，故 v2 跟进。
const MdxEditorPanel = forwardRef(function MdxEditorPanel(
  { initialMarkdown, onChange, onError, onParseError },
  ref,
) {
  const editorRef = useRef(null);
  const [theme, setTheme] = useState(getDocTheme);
  const lang = typeof getLang === 'function' ? getLang() : 'en';

  // (a) 主题同步：监听 documentElement[data-theme] 变化，cleanup 必做
  useEffect(() => {
    const target = document.documentElement;
    const obs = new MutationObserver(() => setTheme(getDocTheme()));
    obs.observe(target, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // (b) 图片处理：浏览器端压缩 → base64 内联，零后端
  const imageUploadHandler = useCallback(async (file) => {
    try {
      const dataURL = await compressImageToDataURL(file, { maxEdge: 2000, quality: 0.85 });
      return dataURL;
    } catch (err) {
      const msg = `${i18n('ui.mdEditor.uploadFailed')}: ${err.message ?? err}`;
      try {
        message.error(msg);
      } catch {
        // 在没有 antd App context 的极端场景下静默失败
      }
      if (typeof onError === 'function') onError(err);
      throw err;
    }
  }, [onError]);

  // wrapperRef 用来给 FileContentView 的 scroll 记忆功能定位 MDXEditor 内部 contenteditable
  // 滚动容器（MDXEditor 不暴露 scroller，故由外层 wrapper 内 querySelector 定位）。
  const wrapperRef = useRef(null);

  // (c) 暴露给父组件
  useImperativeHandle(ref, () => ({
    getMarkdown: () => editorRef.current?.getMarkdown?.() ?? '',
    setMarkdown: (md) => editorRef.current?.setMarkdown?.(md ?? ''),
    focus: () => editorRef.current?.focus?.(),
    // 返回内部 contenteditable 滚动容器；未挂载 / 类名漂移返回 wrapper 自身做兜底。
    // MDXEditor 当前版本（@mdxeditor/editor 3.55.0）渲染出 .mdxeditor-root-contenteditable，
    // 库主版本升级时可能改类名 —— 出 bug 时优先在这一处升级类名而不是侵入 FileContentView。
    getScrollEl: () => wrapperRef.current?.querySelector('.mdxeditor-root-contenteditable') || wrapperRef.current || null,
  }), []);

  // (d) translation 注入：所有语言都走 mdxTranslation（未覆盖 key 由它自动 fall back 到 defaultValue 英文）
  // key={lang} 强制 React 在切语言时重挂载 MDXEditor，保证 toolbar tooltip 立即生效（lib 内部 t() 在
  // init 时一次性读取，无 subscribe 机制）。代价：编辑光标 + undo/redo history 在切语言时丢失，
  // 用户切语言频率极低，可接受；initialMarkdown 回填保证内容不丢。
  return (
    <div ref={wrapperRef} className={`${styles.container} ${theme === 'dark' ? `dark-theme ${styles.dark}` : styles.light}`}>
      <MDXEditor
        key={lang}
        ref={editorRef}
        markdown={initialMarkdown ?? ''}
        onChange={onChange}
        onError={(payload) => {
          // MDXEditor 在解析到无法识别的 mdast 节点（如自定义 JSX 标签 <system-reminder>）
          // 时会触发；payload 形如 { error: string, source: string }。我们把信号上抛给
          // 父组件，让 FileContentView 自动降级到旧 marked 渲染——避免用户看到红色
          // "Parsing of the following markdown structure failed" 横幅。
          if (typeof onParseError === 'function') {
            try { onParseError(payload); } catch { /* swallow — fallback 路径不能再抛 */ }
          }
        }}
        translation={mdxTranslation}
        contentEditableClassName={styles.contentEditable}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          imagePlugin({ imageUploadHandler }),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
          codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES }),
          thematicBreakPlugin(),
          markdownShortcutPlugin(),
          // diffSourcePlugin 提供 rich-text / diff / source 三态视图。
          // diffMarkdown 设为初始内容，用户在 rich/source 模式编辑后切到 diff 即可看
          // "已编辑 vs 原始"的差异。配合 key={filePath} 重挂载，文件切换时自动重置。
          diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: initialMarkdown ?? '' }),
          toolbarPlugin({
            // DiffSourceToggleWrapper 把 rich-text 的 toolbar items 作为 children 包裹起来；
            // diff/source 模式下自动隐藏 children 改显示模式标题；切换器自身始终右对齐渲染。
            toolbarContents: () => (
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <CodeToggle />
                <Separator />
                <BlockTypeSelect />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <InsertImage />
                <InsertTable />
                <InsertCodeBlock />
                <InsertThematicBreak />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  );
});

export default MdxEditorPanel;
