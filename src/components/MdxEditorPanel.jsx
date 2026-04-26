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
import { compressImageToDataURL } from '../utils/imageCompress';
import { mdxZhTranslation } from '../i18n/mdxZh';
import { t as i18n, getLang } from '../i18n';

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
  { initialMarkdown, onChange, onError },
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

  // (c) 暴露给父组件
  useImperativeHandle(ref, () => ({
    getMarkdown: () => editorRef.current?.getMarkdown?.() ?? '',
    setMarkdown: (md) => editorRef.current?.setMarkdown?.(md ?? ''),
    focus: () => editorRef.current?.focus?.(),
  }), []);

  // (d) translation 注入：中文走自定义覆盖；其他语言用 MDXEditor 默认英文
  const translation = lang === 'zh' || lang === 'zh-TW' ? mdxZhTranslation : undefined;

  return (
    <div className={`${styles.container} ${theme === 'dark' ? `dark-theme ${styles.dark}` : styles.light}`}>
      <MDXEditor
        ref={editorRef}
        markdown={initialMarkdown ?? ''}
        onChange={onChange}
        translation={translation}
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
