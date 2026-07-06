import React, { useMemo, useRef, useEffect } from 'react';
import * as Diff from 'diff';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import 'highlight.js/styles/github-dark.css';
import styles from './FullFileDiffView.module.css';
import DiffMiniMap from './DiffMiniMap';

// 注册语言
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sql', sql);

const LANG_MAP = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  java: 'java',
  c: 'cpp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  kt: 'kotlin',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
};

function getLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return LANG_MAP[ext] || null;
}

function highlightLines(content, lang) {
  if (!content) return [];
  const lines = content.split('\n');
  if (lang) {
    try {
      const highlighted = hljs.highlight(content, { language: lang });
      return highlighted.value.split('\n');
    } catch {
      return lines;
    }
  }
  return lines;
}

function computeDiffLines(oldStr, newStr) {
  const changes = Diff.diffLines(oldStr, newStr);
  const lines = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const part of changes) {
    const partLines = part.value.replace(/\n$/, '').split('\n');
    if (part.value === '') continue;

    for (const text of partLines) {
      if (part.added) {
        lines.push({ type: 'add', oldNum: null, newNum: newLineNum++, text, oldIdx: null, newIdx: lines.filter(l => l.type !== 'del').length });
      } else if (part.removed) {
        lines.push({ type: 'del', oldNum: oldLineNum++, newNum: null, text, oldIdx: null, newIdx: null });
      } else {
        lines.push({ type: 'context', oldNum: oldLineNum++, newNum: newLineNum++, text, oldIdx: null, newIdx: null });
      }
    }
  }
  return lines;
}

export default function FullFileDiffView({ file_path, old_string, new_string }) {
  const lineNumScrollRef = useRef(null);
  const codeScrollRef = useRef(null);

  // 纵向滚动同步：代码区滚动时同步行号列
  useEffect(() => {
    const codeEl = codeScrollRef.current;
    const lineEl = lineNumScrollRef.current;
    if (!codeEl || !lineEl) return;
    const onScroll = () => { lineEl.scrollTop = codeEl.scrollTop; };
    codeEl.addEventListener('scroll', onScroll);
    return () => codeEl.removeEventListener('scroll', onScroll);
  });

  // 检测文件状态
  const isDeleted = !new_string || new_string.trim() === '';
  const isNew = !old_string || old_string.trim() === '';

  const lang = getLanguage(file_path);

  // 分别高亮旧内容和新内容
  const oldHighlightedLines = useMemo(
    () => highlightLines(old_string || '', lang),
    [old_string, lang]
  );
  const newHighlightedLines = useMemo(
    () => highlightLines(new_string || '', lang),
    [new_string, lang]
  );

  // 计算 unified diff 行
  const diffLines = useMemo(() => {
    if (isNew) {
      // 新文件：所有行都是 add
      const lines = (new_string || '').split('\n');
      return lines.map((text, i) => ({
        type: 'add', oldNum: null, newNum: i + 1, text
      }));
    }
    if (isDeleted) {
      // 删除文件：所有行都是 del
      const lines = (old_string || '').split('\n');
      return lines.map((text, i) => ({
        type: 'del', oldNum: i + 1, newNum: null, text
      }));
    }
    return computeDiffLines(old_string, new_string);
  }, [old_string, new_string, isDeleted, isNew]);

  // 将高亮行映射到 diff 行
  const highlightedDiffLines = useMemo(() => {
    let oldIdx = 0;
    let newIdx = 0;
    return diffLines.map(dl => {
      let html;
      if (dl.type === 'del') {
        html = oldHighlightedLines[oldIdx] ?? '';
        oldIdx++;
      } else if (dl.type === 'add') {
        html = newHighlightedLines[newIdx] ?? '';
        newIdx++;
      } else {
        // context: advance both
        html = newHighlightedLines[newIdx] ?? '';
        oldIdx++;
        newIdx++;
      }
      return { ...dl, html };
    });
  }, [diffLines, oldHighlightedLines, newHighlightedLines]);

  const addedCount = highlightedDiffLines.filter(l => l.type === 'add').length;
  const deletedCount = highlightedDiffLines.filter(l => l.type === 'del').length;

  return (
    <div className={styles.fullFileDiffView}>
      <div className={styles.diffSummary}>
        {addedCount > 0 && <span className={styles.addedBadge}>+{addedCount}</span>}
        {deletedCount > 0 && <span className={styles.deletedBadge}>-{deletedCount}</span>}
      </div>
      <div className={styles.codeContainer}>
        <div className={styles.lineNumberCol} ref={lineNumScrollRef}>
          {highlightedDiffLines.map((dl, idx) => {
            let numClass = styles.lineNumNormal;
            if (dl.type === 'add') numClass = styles.lineNumAdd;
            else if (dl.type === 'del') numClass = styles.lineNumDelete;
            return (
              <div key={idx} className={`${styles.lineNumRow} ${numClass}`}>
                <span className={styles.oldLineNum}>{dl.oldNum ?? ''}</span>
                <span className={styles.newLineNum}>{dl.newNum ?? ''}</span>
              </div>
            );
          })}
        </div>
        <div className={styles.codeColWrap}>
          <div className={styles.codeCol} ref={codeScrollRef}>
            <div className={styles.codeInner}>
              {highlightedDiffLines.map((dl, idx) => {
                let lineClass;
                if (dl.type === 'add') lineClass = styles.lineAdd;
                else if (dl.type === 'del') lineClass = styles.lineDelete;
                else lineClass = styles.lineNormal;

                const prefix = dl.type === 'add' ? '+' : dl.type === 'del' ? '-' : ' ';

                return (
                  <div key={idx} className={`${styles.codeLine} ${lineClass}`}>
                    <span className={styles.linePrefix}>{prefix}</span>
                    <span
                      className={styles.lineContent}
                      dangerouslySetInnerHTML={{ __html: dl.html || ' ' }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <DiffMiniMap diffLines={highlightedDiffLines} scrollRef={codeScrollRef} />
        </div>
      </div>
    </div>
  );
}
