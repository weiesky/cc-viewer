import React, { useState, useMemo } from 'react';
import { Typography } from 'antd';
import * as Diff from 'diff';
import { t } from '../i18n';
import styles from './DiffView.module.css';

const { Text } = Typography;

function computeDiffLines(oldStr, newStr, startLine) {
  const changes = Diff.diffLines(oldStr, newStr);
  const lines = [];
  let oldLineNum = startLine;
  let newLineNum = startLine;

  for (const part of changes) {
    const partLines = part.value.replace(/\n$/, '').split('\n');
    // handle empty diff part (e.g. trailing newline only)
    if (part.value === '') continue;

    for (const text of partLines) {
      if (part.added) {
        lines.push({ type: 'add', oldNum: null, newNum: newLineNum++, text });
      } else if (part.removed) {
        lines.push({ type: 'del', oldNum: oldLineNum++, newNum: null, text });
      } else {
        lines.push({ type: 'context', oldNum: oldLineNum++, newNum: newLineNum++, text });
      }
    }
  }
  return lines;
}

function DiffView({ file_path, old_string, new_string, startLine = 1, onOpenFile }) {
  const [collapsed, setCollapsed] = useState(false);

  const diffLines = useMemo(
    () => computeDiffLines(old_string, new_string, startLine),
    [old_string, new_string, startLine]
  );

  const added = diffLines.filter(l => l.type === 'add').length;
  const removed = diffLines.filter(l => l.type === 'del').length;

  const maxLineNum = useMemo(() => {
    let max = 1;
    for (const dl of diffLines) {
      if (dl.oldNum != null && dl.oldNum > max) max = dl.oldNum;
      if (dl.newNum != null && dl.newNum > max) max = dl.newNum;
    }
    return max;
  }, [diffLines]);
  const digits = String(maxLineNum).length;
  const lineNumWidth = digits * 8 + 10;

  const rowCls = (type) =>
    type === 'del' ? styles.rowDel
    : type === 'add' ? styles.rowAdd
    : styles.rowContext;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <Text className={onOpenFile ? styles.filePathClickable : styles.filePath}>
          Edit: <span onClick={onOpenFile ? (e) => { e.stopPropagation(); onOpenFile(file_path); } : undefined}>{file_path}</span>
        </Text>
        <span className={styles.headerRight}>
          <Text className={styles.diffSummary}>
            {t('ui.diffSummary', { added, removed })}
          </Text>
          <Text
            className={styles.toggle}
            onClick={() => setCollapsed(c => !c)}
          >
            {collapsed ? t('ui.expand') : t('ui.collapse')}
          </Text>
        </span>
      </div>
      {!collapsed && (
        <div className={styles.diffBody}>
          {/* Fixed left gutter: line numbers + prefix */}
          <div className={styles.gutter} style={{ '--line-num-w': `${lineNumWidth}px` }}>
            {diffLines.map((dl, i) => {
              const prefix = dl.type === 'del' ? '-' : dl.type === 'add' ? '+' : ' ';
              return (
                <div key={i} className={`${styles.gutterRow} ${rowCls(dl.type)}`}>
                  <span className={styles.lineNumOld} style={{ width: lineNumWidth }}>{dl.oldNum ?? ''}</span>
                  <span className={styles.lineNumNew} style={{ width: lineNumWidth }}>{dl.newNum ?? ''}</span>
                  <span className={styles.prefix}>{prefix}</span>
                </div>
              );
            })}
          </div>
          {/* Scrollable code area */}
          <div className={styles.codeWrap}>
            <div className={styles.codeInner}>
              {diffLines.map((dl, i) => (
                <div key={i} className={`${styles.codeLine} ${rowCls(dl.type)}`}>
                  {dl.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DiffView;
