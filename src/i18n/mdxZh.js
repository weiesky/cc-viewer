// MDXEditor 内部 dialog/menu 文案的中文覆盖
// 通过 <MDXEditor translation={...} /> 注入；其他语言保持英文 fallback。
// key 路径与 MDXEditor 默认 t("xxx.yyy", "default") 对齐，覆盖范围限定为
// 本项目实际启用的 plugin（link / image / table / codeBlock / blockType / dialog）。

const ZH = {
  contentArea: {
    editableMarkdown: '可编辑 Markdown',
  },
  dialog: {
    close: '关闭',
  },
  dialogControls: {
    cancel: '取消',
    save: '保存',
  },
  createLink: {
    text: '链接文字',
    textTooltip: '链接显示的文字',
    title: '标题',
    titleTooltip: '链接的 title 属性（鼠标悬停时显示）',
    url: '链接地址',
    urlPlaceholder: '请输入链接地址',
    saveTooltip: '保存链接',
    cancelTooltip: '取消编辑',
  },
  linkPreview: {
    // MDXEditor: t("linkPreview.open", "Open {{url}} in new window", { url })
    open: '在新窗口打开 {{url}}',
    edit: '编辑链接',
    copyToClipboard: '复制链接到剪贴板',
    copied: '已复制',
    remove: '移除链接',
  },
  uploadImage: {
    dialogTitle: '插入图片',
    uploadInstructions: '从本地选择图片上传',
    addViaUrlInstructions: '或输入图片地址',
    addViaUrlInstructionsNoUpload: '请输入图片地址',
    autoCompletePlaceholder: '搜索已有图片',
    alt: '替代文字',
    title: '标题',
    width: '宽度',
    height: '高度',
  },
  imageEditor: {
    editImage: '编辑图片',
    deleteImage: '删除图片',
  },
  table: {
    columnMenu: '列菜单',
    rowMenu: '行菜单',
    textAlignment: '文字对齐',
    alignLeft: '左对齐',
    alignCenter: '居中',
    alignRight: '右对齐',
    insertColumnLeft: '在左侧插入列',
    insertColumnRight: '在右侧插入列',
    insertRowAbove: '在上方插入行',
    insertRowBelow: '在下方插入行',
    deleteColumn: '删除列',
    deleteRow: '删除行',
    deleteTable: '删除表格',
  },
  codeBlock: {
    language: '语言',
    inlineLanguage: '行内语言',
    selectLanguage: '选择语言',
  },
  codeblock: {
    delete: '删除代码块',
  },
  toolbar: {
    // MDXEditor 的 UndoRedo 按钮 tooltip 含快捷键占位符（⌘Z / Ctrl+Z 等）
    undo: '撤销 {{shortcut}}',
    redo: '重做 {{shortcut}}',
    blockTypeSelect: {
      placeholder: '块类型',
      selectBlockTypeTooltip: '选择块类型',
    },
    blockTypes: {
      paragraph: '段落',
      // MDXEditor 调用 t("toolbar.blockTypes.heading", "Heading {{level}}", { level: n })，
      // 用 double-curly 占位符填 1-6 表示 H1~H6
      heading: '标题 {{level}}',
      quote: '引用',
    },
  },
};

function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

// MDXEditor 内部统一用 i18next 风格 double-curly 占位符（如 "Heading {{level}}"）。
// 不用 lookbehind/lookahead（老 Safari 不支持）；通过两步替换保证不互相干扰：
// 1) 先消化 {{var}}（贪心后缩回）；2) 再处理任何剩余的单层 {var} 兜底。
function interpolate(template, values) {
  if (!values) return template;
  let out = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    k in values ? String(values[k]) : `{{${k}}}`,
  );
  out = out.replace(/\{(\w+)\}/g, (_, k) => (k in values ? String(values[k]) : `{${k}}`));
  return out;
}

export function mdxZhTranslation(key, defaultValue, interpolations) {
  const hit = getByPath(ZH, key);
  const text = hit ?? defaultValue ?? key;
  return interpolate(text, interpolations);
}
