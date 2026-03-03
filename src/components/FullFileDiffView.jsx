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

function computeLineChanges(oldStr, newStr) {
  const changes = Diff.diffLines(oldStr, newStr);
  const changeMap = new Map(); // lineNum -> { type, oldContent }
  let newLineNum = 1;
  let oldLineNum = 1;

  for (const part of changes) {
    const partLines = part.value.replace(/\n$/, '').split('\n');
    if (part.value === '') continue;

    if (part.added) {
      // 新增的行
      for (let i = 0; i < partLines.length; i++) {
        changeMap.set(newLineNum++, { type: 'add', oldContent: null });
      }
    } else if (part.removed) {
      // 删除的行 - 记录下来，可能与后续的添加行配对
      const removedLines = partLines;
      oldLineNum += removedLines.length;

      // 检查下一个 part 是否是添加，如果是则配对为修改
      const nextPartIdx = changes.indexOf(part) + 1;
      if (nextPartIdx < changes.length && changes[nextPartIdx].added) {
        const addedLines = changes[nextPartIdx].value.replace(/\n$/, '').split('\n');
        const minLen = Math.min(removedLines.length, addedLines.length);

        // 配对的行标记为修改
        for (let i = 0; i < minLen; i++) {
          changeMap.set(newLineNum++, { type: 'modify', oldContent: removedLines[i] });
        }

        // 剩余的添加行标记为新增
        for (let i = minLen; i < addedLines.length; i++) {
          changeMap.set(newLineNum++, { type: 'add', oldContent: null });
        }

        // 跳过下一个 part（已处理）
        changes.splice(nextPartIdx, 1);
      }
    } else {
      // 未变更的行
      newLineNum += partLines.length;
      oldLineNum += partLines.length;
    }
  }

  return changeMap;
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

  const changeMap = useMemo(
    () => {
      if (isDeleted || isNew) {
        // 对于新增或删除的文件，不需要计算 diff
        return new Map();
      }
      return computeLineChanges(old_string, new_string);
    },
    [old_string, new_string, isDeleted, isNew]
  );

  // 对于删除的文件，显示旧内容；否则显示新内容
  const displayContent = isDeleted ? old_string : new_string;
  const displayLines = displayContent.split('\n');
  const lang = getLanguage(file_path);

  // 高亮代码
  const highlightedLines = useMemo(() => {
    if (lang) {
      try {
        const highlighted = hljs.highlight(displayContent, { language: lang });
        return highlighted.value.split('\n');
      } catch {
        return displayLines;
      }
    }
    return displayLines;
  }, [displayContent, lang, displayLines]);

  const addedCount = isNew ? displayLines.length : Array.from(changeMap.values()).filter(c => c.type === 'add').length;
  const modifiedCount = Array.from(changeMap.values()).filter(c => c.type === 'modify').length;
  const deletedCount = isDeleted ? displayLines.length : 0;

  return (
    <div className={styles.fullFileDiffView}>
      <div className={styles.diffSummary}>
        {addedCount > 0 && <span className={styles.addedBadge}>+{addedCount}</span>}
        {modifiedCount > 0 && <span className={styles.modifiedBadge}>~{modifiedCount}</span>}
        {deletedCount > 0 && <span className={styles.deletedBadge}>-{deletedCount}</span>}
      </div>
      <div className={styles.codeContainer}>
        <div className={styles.lineNumberCol} ref={lineNumScrollRef}>
          {highlightedLines.map((_, idx) => {
            const lineNum = idx + 1;
            const change = changeMap.get(lineNum);
            let numClass = styles.lineNumNormal;
            if (isDeleted) numClass = styles.lineNumDelete;
            else if (isNew) numClass = styles.lineNumAdd;
            else if (change) numClass = change.type === 'add' ? styles.lineNumAdd : styles.lineNumModify;
            return <div key={idx} className={numClass}>{lineNum}</div>;
          })}
        </div>
        <div className={styles.codeCol} ref={codeScrollRef}>
          <div className={styles.codeInner}>
            {highlightedLines.map((line, idx) => {
              const lineNum = idx + 1;
              const change = changeMap.get(lineNum);

              let lineClass;
              if (isDeleted) lineClass = styles.lineDelete;
              else if (isNew) lineClass = styles.lineAdd;
              else if (change) lineClass = change.type === 'add' ? styles.lineAdd : styles.lineModify;
              else lineClass = styles.lineNormal;

              return (
                <div key={idx} className={`${styles.codeLine} ${lineClass}`}>
                  <span
                    className={styles.lineContent}
                    dangerouslySetInnerHTML={{ __html: line || ' ' }}
                  />
                  {change && change.oldContent !== null && (
                    <div className={styles.oldContentTooltip}>
                      <div className={styles.tooltipLabel}>原内容:</div>
                      <div className={styles.tooltipContent}>{change.oldContent}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
