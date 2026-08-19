// MDXEditor 内部 dialog/menu/toolbar 文案的多语言覆盖
// 通过 <MDXEditor translation={...} /> 注入；未覆盖的 key 走 lib 默认英文 fallback。
//
// 覆盖范围：
//   - zh / zh-TW: 完整覆盖（dialog + menu + toolbar）
//   - 其他 16 种语言: 仅覆盖 toolbar.* 段（hover tooltip 是用户最直接看到的）；
//     dialog/menu 段走英文 fallback（国际通用，且翻译量从 ~75×17 字段 → 0）
//
// MDXEditor 内部统一用 i18next 风格 double-curly 占位符（如 "Heading {{level}}"）；
// interpolate() 同时兼容 single-curly 兜底。

import { getLang } from '../i18n.js';

// 中文工具栏 tooltip（zh / zh-TW 共用大部分）
const ZH_TOOLBAR = {
  undo: '撤销 {{shortcut}}',
  redo: '重做 {{shortcut}}',
  bold: '加粗',
  italic: '斜体',
  underline: '下划线',
  removeBold: '取消加粗',
  removeItalic: '取消斜体',
  removeUnderline: '取消下划线',
  inlineCode: '行内代码',
  removeInlineCode: '取消行内代码',
  bulletedList: '无序列表',
  numberedList: '有序列表',
  checkList: '任务列表',
  toggleGroup: '列表样式',
  link: '插入链接',
  image: '插入图片',
  table: '插入表格',
  codeBlock: '插入代码块',
  thematicBreak: '插入分隔线',
  richText: '富文本',
  diffMode: '对比视图',
  source: '源代码',
  blockTypeSelect: { placeholder: '块类型', selectBlockTypeTooltip: '选择块类型' },
  blockTypes: { paragraph: '段落', heading: '标题 {{level}}', quote: '引用' },
};

const TRANSLATIONS = {
  // ─── 简体中文：完整覆盖 ──────────────────────────────────────────────
  zh: {
    contentArea: { editableMarkdown: '可编辑 Markdown' },
    dialog: { close: '关闭' },
    dialogControls: { cancel: '取消', save: '保存' },
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
    imageEditor: { editImage: '编辑图片', deleteImage: '删除图片' },
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
    codeBlock: { language: '语言', inlineLanguage: '行内语言', selectLanguage: '选择语言' },
    codeblock: { delete: '删除代码块' },
    toolbar: ZH_TOOLBAR,
  },

  // ─── 繁体中文：复用 zh 的 toolbar，dialog/menu 用繁体写法 ────────────
  'zh-TW': {
    contentArea: { editableMarkdown: '可編輯 Markdown' },
    dialog: { close: '關閉' },
    dialogControls: { cancel: '取消', save: '儲存' },
    createLink: {
      text: '連結文字',
      textTooltip: '連結顯示的文字',
      title: '標題',
      titleTooltip: '連結的 title 屬性（滑鼠懸停時顯示）',
      url: '連結網址',
      urlPlaceholder: '請輸入連結網址',
      saveTooltip: '儲存連結',
      cancelTooltip: '取消編輯',
    },
    linkPreview: {
      open: '在新視窗開啟 {{url}}',
      edit: '編輯連結',
      copyToClipboard: '複製連結至剪貼簿',
      copied: '已複製',
      remove: '移除連結',
    },
    uploadImage: {
      dialogTitle: '插入圖片',
      uploadInstructions: '從本地選擇圖片上傳',
      addViaUrlInstructions: '或輸入圖片網址',
      addViaUrlInstructionsNoUpload: '請輸入圖片網址',
      autoCompletePlaceholder: '搜尋現有圖片',
      alt: '替代文字',
      title: '標題',
      width: '寬度',
      height: '高度',
    },
    imageEditor: { editImage: '編輯圖片', deleteImage: '刪除圖片' },
    table: {
      columnMenu: '欄選單',
      rowMenu: '列選單',
      textAlignment: '文字對齊',
      alignLeft: '靠左',
      alignCenter: '置中',
      alignRight: '靠右',
      insertColumnLeft: '在左側插入欄',
      insertColumnRight: '在右側插入欄',
      insertRowAbove: '在上方插入列',
      insertRowBelow: '在下方插入列',
      deleteColumn: '刪除欄',
      deleteRow: '刪除列',
      deleteTable: '刪除表格',
    },
    codeBlock: { language: '語言', inlineLanguage: '行內語言', selectLanguage: '選擇語言' },
    codeblock: { delete: '刪除程式碼區塊' },
    toolbar: {
      undo: '復原 {{shortcut}}',
      redo: '重做 {{shortcut}}',
      bold: '粗體',
      italic: '斜體',
      underline: '底線',
      removeBold: '取消粗體',
      removeItalic: '取消斜體',
      removeUnderline: '取消底線',
      inlineCode: '行內程式碼',
      removeInlineCode: '取消行內程式碼',
      bulletedList: '項目符號清單',
      numberedList: '編號清單',
      checkList: '工作清單',
      toggleGroup: '清單樣式',
      link: '插入連結',
      image: '插入圖片',
      table: '插入表格',
      codeBlock: '插入程式碼區塊',
      thematicBreak: '插入分隔線',
      richText: '所見即所得',
      diffMode: '比對檢視',
      source: '原始碼',
      blockTypeSelect: { placeholder: '區塊類型', selectBlockTypeTooltip: '選擇區塊類型' },
      blockTypes: { paragraph: '段落', heading: '標題 {{level}}', quote: '引用' },
    },
  },

  // ─── 其他语言：仅覆盖 toolbar 段 ─────────────────────────────────────
  // en: 不需要（lib 默认就是英文）

  ja: {
    toolbar: {
      undo: '元に戻す {{shortcut}}',
      redo: 'やり直し {{shortcut}}',
      bold: '太字', italic: 'イタリック', underline: '下線',
      removeBold: '太字を解除', removeItalic: 'イタリックを解除', removeUnderline: '下線を解除',
      inlineCode: 'インラインコード', removeInlineCode: 'インラインコードを解除',
      bulletedList: '箇条書き', numberedList: '番号付きリスト', checkList: 'チェックリスト',
      toggleGroup: 'リストスタイル',
      link: 'リンクを挿入', image: '画像を挿入', table: '表を挿入',
      codeBlock: 'コードブロックを挿入', thematicBreak: '区切り線を挿入',
      richText: 'リッチテキスト', diffMode: '差分表示', source: 'ソース',
      blockTypeSelect: { placeholder: 'ブロック種別', selectBlockTypeTooltip: 'ブロック種別を選択' },
      blockTypes: { paragraph: '段落', heading: '見出し {{level}}', quote: '引用' },
    },
  },

  ko: {
    toolbar: {
      undo: '실행 취소 {{shortcut}}',
      redo: '다시 실행 {{shortcut}}',
      bold: '굵게', italic: '기울임', underline: '밑줄',
      removeBold: '굵게 해제', removeItalic: '기울임 해제', removeUnderline: '밑줄 해제',
      inlineCode: '인라인 코드', removeInlineCode: '인라인 코드 해제',
      bulletedList: '글머리 기호 목록', numberedList: '번호 매기기 목록', checkList: '체크리스트',
      toggleGroup: '목록 스타일',
      link: '링크 삽입', image: '이미지 삽입', table: '표 삽입',
      codeBlock: '코드 블록 삽입', thematicBreak: '구분선 삽입',
      richText: '서식있는 텍스트', diffMode: '비교 보기', source: '소스',
      blockTypeSelect: { placeholder: '블록 유형', selectBlockTypeTooltip: '블록 유형 선택' },
      blockTypes: { paragraph: '단락', heading: '제목 {{level}}', quote: '인용' },
    },
  },

  de: {
    toolbar: {
      undo: 'Rückgängig {{shortcut}}',
      redo: 'Wiederherstellen {{shortcut}}',
      bold: 'Fett', italic: 'Kursiv', underline: 'Unterstrichen',
      removeBold: 'Fett entfernen', removeItalic: 'Kursiv entfernen', removeUnderline: 'Unterstrichen entfernen',
      inlineCode: 'Inline-Code', removeInlineCode: 'Inline-Code entfernen',
      bulletedList: 'Aufzählungsliste', numberedList: 'Nummerierte Liste', checkList: 'Aufgabenliste',
      toggleGroup: 'Listenstil',
      link: 'Link einfügen', image: 'Bild einfügen', table: 'Tabelle einfügen',
      codeBlock: 'Codeblock einfügen', thematicBreak: 'Trennlinie einfügen',
      richText: 'Rich-Text', diffMode: 'Diff-Ansicht', source: 'Quelltext',
      blockTypeSelect: { placeholder: 'Blocktyp', selectBlockTypeTooltip: 'Blocktyp auswählen' },
      blockTypes: { paragraph: 'Absatz', heading: 'Überschrift {{level}}', quote: 'Zitat' },
    },
  },

  es: {
    toolbar: {
      undo: 'Deshacer {{shortcut}}',
      redo: 'Rehacer {{shortcut}}',
      bold: 'Negrita', italic: 'Cursiva', underline: 'Subrayado',
      removeBold: 'Quitar negrita', removeItalic: 'Quitar cursiva', removeUnderline: 'Quitar subrayado',
      inlineCode: 'Código en línea', removeInlineCode: 'Quitar código en línea',
      bulletedList: 'Lista con viñetas', numberedList: 'Lista numerada', checkList: 'Lista de tareas',
      toggleGroup: 'Estilo de lista',
      link: 'Insertar enlace', image: 'Insertar imagen', table: 'Insertar tabla',
      codeBlock: 'Insertar bloque de código', thematicBreak: 'Insertar separador',
      richText: 'Texto enriquecido', diffMode: 'Vista comparativa', source: 'Código fuente',
      blockTypeSelect: { placeholder: 'Tipo de bloque', selectBlockTypeTooltip: 'Seleccionar tipo de bloque' },
      blockTypes: { paragraph: 'Párrafo', heading: 'Encabezado {{level}}', quote: 'Cita' },
    },
  },

  fr: {
    toolbar: {
      undo: 'Annuler {{shortcut}}',
      redo: 'Rétablir {{shortcut}}',
      bold: 'Gras', italic: 'Italique', underline: 'Souligné',
      removeBold: 'Retirer le gras', removeItalic: 'Retirer l’italique', removeUnderline: 'Retirer le soulignement',
      inlineCode: 'Code en ligne', removeInlineCode: 'Retirer le code en ligne',
      bulletedList: 'Liste à puces', numberedList: 'Liste numérotée', checkList: 'Liste de tâches',
      toggleGroup: 'Style de liste',
      link: 'Insérer un lien', image: 'Insérer une image', table: 'Insérer un tableau',
      codeBlock: 'Insérer un bloc de code', thematicBreak: 'Insérer un séparateur',
      richText: 'Texte enrichi', diffMode: 'Vue comparative', source: 'Source',
      blockTypeSelect: { placeholder: 'Type de bloc', selectBlockTypeTooltip: 'Choisir le type de bloc' },
      blockTypes: { paragraph: 'Paragraphe', heading: 'Titre {{level}}', quote: 'Citation' },
    },
  },

  it: {
    toolbar: {
      undo: 'Annulla {{shortcut}}',
      redo: 'Ripristina {{shortcut}}',
      bold: 'Grassetto', italic: 'Corsivo', underline: 'Sottolineato',
      removeBold: 'Rimuovi grassetto', removeItalic: 'Rimuovi corsivo', removeUnderline: 'Rimuovi sottolineato',
      inlineCode: 'Codice in linea', removeInlineCode: 'Rimuovi codice in linea',
      bulletedList: 'Elenco puntato', numberedList: 'Elenco numerato', checkList: 'Elenco di attività',
      toggleGroup: 'Stile elenco',
      link: 'Inserisci link', image: 'Inserisci immagine', table: 'Inserisci tabella',
      codeBlock: 'Inserisci blocco di codice', thematicBreak: 'Inserisci separatore',
      richText: 'Testo formattato', diffMode: 'Vista differenze', source: 'Sorgente',
      blockTypeSelect: { placeholder: 'Tipo di blocco', selectBlockTypeTooltip: 'Seleziona tipo di blocco' },
      blockTypes: { paragraph: 'Paragrafo', heading: 'Titolo {{level}}', quote: 'Citazione' },
    },
  },

  da: {
    toolbar: {
      undo: 'Fortryd {{shortcut}}',
      redo: 'Gentag {{shortcut}}',
      bold: 'Fed', italic: 'Kursiv', underline: 'Understreget',
      removeBold: 'Fjern fed', removeItalic: 'Fjern kursiv', removeUnderline: 'Fjern understregning',
      inlineCode: 'Indlejret kode', removeInlineCode: 'Fjern indlejret kode',
      bulletedList: 'Punktopstilling', numberedList: 'Nummereret liste', checkList: 'Tjekliste',
      toggleGroup: 'Listestil',
      link: 'Indsæt link', image: 'Indsæt billede', table: 'Indsæt tabel',
      codeBlock: 'Indsæt kodeblok', thematicBreak: 'Indsæt skillelinje',
      richText: 'Formateret tekst', diffMode: 'Diff-visning', source: 'Kilde',
      blockTypeSelect: { placeholder: 'Bloktype', selectBlockTypeTooltip: 'Vælg bloktype' },
      blockTypes: { paragraph: 'Afsnit', heading: 'Overskrift {{level}}', quote: 'Citat' },
    },
  },

  pl: {
    toolbar: {
      undo: 'Cofnij {{shortcut}}',
      redo: 'Ponów {{shortcut}}',
      bold: 'Pogrubienie', italic: 'Kursywa', underline: 'Podkreślenie',
      removeBold: 'Usuń pogrubienie', removeItalic: 'Usuń kursywę', removeUnderline: 'Usuń podkreślenie',
      inlineCode: 'Kod w linii', removeInlineCode: 'Usuń kod w linii',
      bulletedList: 'Lista punktowana', numberedList: 'Lista numerowana', checkList: 'Lista zadań',
      toggleGroup: 'Styl listy',
      link: 'Wstaw link', image: 'Wstaw obraz', table: 'Wstaw tabelę',
      codeBlock: 'Wstaw blok kodu', thematicBreak: 'Wstaw separator',
      richText: 'Tekst sformatowany', diffMode: 'Widok porównania', source: 'Źródło',
      blockTypeSelect: { placeholder: 'Typ bloku', selectBlockTypeTooltip: 'Wybierz typ bloku' },
      blockTypes: { paragraph: 'Akapit', heading: 'Nagłówek {{level}}', quote: 'Cytat' },
    },
  },

  ru: {
    toolbar: {
      undo: 'Отменить {{shortcut}}',
      redo: 'Повторить {{shortcut}}',
      bold: 'Полужирный', italic: 'Курсив', underline: 'Подчёркнутый',
      removeBold: 'Убрать полужирный', removeItalic: 'Убрать курсив', removeUnderline: 'Убрать подчёркивание',
      inlineCode: 'Встроенный код', removeInlineCode: 'Убрать встроенный код',
      bulletedList: 'Маркированный список', numberedList: 'Нумерованный список', checkList: 'Список задач',
      toggleGroup: 'Стиль списка',
      link: 'Вставить ссылку', image: 'Вставить изображение', table: 'Вставить таблицу',
      codeBlock: 'Вставить блок кода', thematicBreak: 'Вставить разделитель',
      richText: 'Форматированный текст', diffMode: 'Вид сравнения', source: 'Исходный код',
      blockTypeSelect: { placeholder: 'Тип блока', selectBlockTypeTooltip: 'Выбрать тип блока' },
      blockTypes: { paragraph: 'Абзац', heading: 'Заголовок {{level}}', quote: 'Цитата' },
    },
  },

  ar: {
    toolbar: {
      undo: 'تراجع {{shortcut}}',
      redo: 'إعادة {{shortcut}}',
      bold: 'عريض', italic: 'مائل', underline: 'تسطير',
      removeBold: 'إزالة العريض', removeItalic: 'إزالة المائل', removeUnderline: 'إزالة التسطير',
      inlineCode: 'كود مضمن', removeInlineCode: 'إزالة الكود المضمن',
      bulletedList: 'قائمة نقطية', numberedList: 'قائمة مرقمة', checkList: 'قائمة مهام',
      toggleGroup: 'نمط القائمة',
      link: 'إدراج رابط', image: 'إدراج صورة', table: 'إدراج جدول',
      codeBlock: 'إدراج كتلة كود', thematicBreak: 'إدراج فاصل',
      richText: 'نص منسق', diffMode: 'عرض المقارنة', source: 'المصدر',
      blockTypeSelect: { placeholder: 'نوع الكتلة', selectBlockTypeTooltip: 'اختر نوع الكتلة' },
      blockTypes: { paragraph: 'فقرة', heading: 'عنوان {{level}}', quote: 'اقتباس' },
    },
  },

  no: {
    toolbar: {
      undo: 'Angre {{shortcut}}',
      redo: 'Gjør om {{shortcut}}',
      bold: 'Fet', italic: 'Kursiv', underline: 'Understreket',
      removeBold: 'Fjern fet', removeItalic: 'Fjern kursiv', removeUnderline: 'Fjern understreking',
      inlineCode: 'Inline-kode', removeInlineCode: 'Fjern inline-kode',
      bulletedList: 'Punktliste', numberedList: 'Nummerert liste', checkList: 'Sjekkliste',
      toggleGroup: 'Listestil',
      link: 'Sett inn lenke', image: 'Sett inn bilde', table: 'Sett inn tabell',
      codeBlock: 'Sett inn kodeblokk', thematicBreak: 'Sett inn skillelinje',
      richText: 'Formatert tekst', diffMode: 'Diff-visning', source: 'Kilde',
      blockTypeSelect: { placeholder: 'Blokktype', selectBlockTypeTooltip: 'Velg blokktype' },
      blockTypes: { paragraph: 'Avsnitt', heading: 'Overskrift {{level}}', quote: 'Sitat' },
    },
  },

  'pt-BR': {
    toolbar: {
      undo: 'Desfazer {{shortcut}}',
      redo: 'Refazer {{shortcut}}',
      bold: 'Negrito', italic: 'Itálico', underline: 'Sublinhado',
      removeBold: 'Remover negrito', removeItalic: 'Remover itálico', removeUnderline: 'Remover sublinhado',
      inlineCode: 'Código em linha', removeInlineCode: 'Remover código em linha',
      bulletedList: 'Lista com marcadores', numberedList: 'Lista numerada', checkList: 'Lista de tarefas',
      toggleGroup: 'Estilo da lista',
      link: 'Inserir link', image: 'Inserir imagem', table: 'Inserir tabela',
      codeBlock: 'Inserir bloco de código', thematicBreak: 'Inserir separador',
      richText: 'Texto formatado', diffMode: 'Visualização de diferenças', source: 'Código-fonte',
      blockTypeSelect: { placeholder: 'Tipo de bloco', selectBlockTypeTooltip: 'Selecionar tipo de bloco' },
      blockTypes: { paragraph: 'Parágrafo', heading: 'Título {{level}}', quote: 'Citação' },
    },
  },

  th: {
    toolbar: {
      undo: 'เลิกทำ {{shortcut}}',
      redo: 'ทำซ้ำ {{shortcut}}',
      bold: 'ตัวหนา', italic: 'ตัวเอียง', underline: 'ขีดเส้นใต้',
      removeBold: 'ยกเลิกตัวหนา', removeItalic: 'ยกเลิกตัวเอียง', removeUnderline: 'ยกเลิกขีดเส้นใต้',
      inlineCode: 'โค้ดในบรรทัด', removeInlineCode: 'ยกเลิกโค้ดในบรรทัด',
      bulletedList: 'รายการแบบจุด', numberedList: 'รายการตัวเลข', checkList: 'รายการตรวจสอบ',
      toggleGroup: 'รูปแบบรายการ',
      link: 'แทรกลิงก์', image: 'แทรกรูปภาพ', table: 'แทรกตาราง',
      codeBlock: 'แทรกบล็อกโค้ด', thematicBreak: 'แทรกเส้นคั่น',
      richText: 'ข้อความรูปแบบ', diffMode: 'มุมมองเปรียบเทียบ', source: 'ซอร์ส',
      blockTypeSelect: { placeholder: 'ประเภทบล็อก', selectBlockTypeTooltip: 'เลือกประเภทบล็อก' },
      blockTypes: { paragraph: 'ย่อหน้า', heading: 'หัวข้อ {{level}}', quote: 'คำพูดอ้างอิง' },
    },
  },

  tr: {
    toolbar: {
      undo: 'Geri al {{shortcut}}',
      redo: 'Yinele {{shortcut}}',
      bold: 'Kalın', italic: 'İtalik', underline: 'Altı çizili',
      removeBold: 'Kalını kaldır', removeItalic: 'İtaliği kaldır', removeUnderline: 'Altı çiziliyi kaldır',
      inlineCode: 'Satır içi kod', removeInlineCode: 'Satır içi kodu kaldır',
      bulletedList: 'Madde işaretli liste', numberedList: 'Numaralı liste', checkList: 'Kontrol listesi',
      toggleGroup: 'Liste stili',
      link: 'Bağlantı ekle', image: 'Resim ekle', table: 'Tablo ekle',
      codeBlock: 'Kod bloğu ekle', thematicBreak: 'Ayraç ekle',
      richText: 'Zengin metin', diffMode: 'Karşılaştırma görünümü', source: 'Kaynak',
      blockTypeSelect: { placeholder: 'Blok türü', selectBlockTypeTooltip: 'Blok türü seç' },
      blockTypes: { paragraph: 'Paragraf', heading: 'Başlık {{level}}', quote: 'Alıntı' },
    },
  },

  uk: {
    toolbar: {
      undo: 'Скасувати {{shortcut}}',
      redo: 'Повторити {{shortcut}}',
      bold: 'Жирний', italic: 'Курсив', underline: 'Підкреслений',
      removeBold: 'Прибрати жирний', removeItalic: 'Прибрати курсив', removeUnderline: 'Прибрати підкреслення',
      inlineCode: 'Вбудований код', removeInlineCode: 'Прибрати вбудований код',
      bulletedList: 'Маркований список', numberedList: 'Нумерований список', checkList: 'Список завдань',
      toggleGroup: 'Стиль списку',
      link: 'Вставити посилання', image: 'Вставити зображення', table: 'Вставити таблицю',
      codeBlock: 'Вставити блок коду', thematicBreak: 'Вставити роздільник',
      richText: 'Форматований текст', diffMode: 'Перегляд порівняння', source: 'Джерело',
      blockTypeSelect: { placeholder: 'Тип блоку', selectBlockTypeTooltip: 'Виберіть тип блоку' },
      blockTypes: { paragraph: 'Абзац', heading: 'Заголовок {{level}}', quote: 'Цитата' },
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

// 主 translation 函数：根据当前 lang 查表，未命中走 fallback 链：
//   全码 (zh-TW / pt-BR) → 首段 (zh / pt) → defaultValue (lib 默认英文) → key 本身
// 每次调用都 getLang()，因此 setLang() 后立刻生效（配合 MdxEditorPanel 的 key={lang} 重挂载读取新值）。
export function mdxTranslation(key, defaultValue, interpolations) {
  const lang = (typeof getLang === 'function' ? getLang() : 'en') || 'en';
  const langTable = TRANSLATIONS[lang] || TRANSLATIONS[lang.split('-')[0]];
  const hit = langTable && getByPath(langTable, key);
  const text = hit ?? defaultValue ?? key;
  return interpolate(text, interpolations);
}

// 暴露给测试用
export { TRANSLATIONS, getByPath, interpolate };
