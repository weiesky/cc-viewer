# NotebookEdit

## التعريف

استبدال أو إدراج أو حذف خلايا محددة في Jupyter notebook (ملفات .ipynb).

## المعاملات

| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `notebook_path` | string | نعم | المسار المطلق لملف notebook |
| `new_source` | string | نعم | المحتوى الجديد للخلية |
| `cell_id` | string | لا | معرف الخلية المراد تحريرها. في وضع الإدراج تُدرج الخلية الجديدة بعد هذا المعرف |
| `cell_type` | enum | لا | نوع الخلية: `code` أو `markdown`. مطلوب في وضع الإدراج |
| `edit_mode` | enum | لا | وضع التحرير: `replace` (افتراضي)، `insert`، `delete` |

## سيناريوهات الاستخدام

**مناسب للاستخدام:**
- تعديل خلايا الكود أو markdown في Jupyter notebook
- إضافة خلايا جديدة إلى notebook
- حذف خلايا من notebook

## ملاحظات

- `cell_number` يبدأ من الصفر (0-indexed)
- وضع `insert` يُدرج خلية جديدة في الموضع المحدد
- وضع `delete` يحذف الخلية في الموضع المحدد
- يجب أن يكون المسار مطلقاً

## الأهمية في cc-viewer

يظهر استدعاء NotebookEdit في سجل الطلبات ككتلة محتوى `tool_use`، تسجل عمليات التعديل المحددة على notebook.

## النص الأصلي

<textarea readonly>Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.</textarea>
