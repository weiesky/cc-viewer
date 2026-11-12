---
"cc-viewer": patch
---

新增字幕文件在线预览：SRT/VTT/ASS/SSA 解析时间区间为列表/原文双视图，复用压缩包 BOM/UTF-16/GBK/Latin-1 解码（顺带修复其 Latin-1 回退的 ReferenceError），超 1MiB/3000 条截断提示，纯文本渲染不执行标签。图片预览扩展名补充 APNG/JFIF（TIFF/HEIC 归类图片但保持下载回退）。
