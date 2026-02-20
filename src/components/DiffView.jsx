import React, { useState } from 'react';
import { Typography } from 'antd';
import { t } from '../i18n';
import styles from './DiffView.module.css';

const { Text } = Typography;

function DiffView({ file_path, old_string, new_string }) {
  const [collapsed, setCollapsed] = useState(false);

  const oldLines = old_string.split('\n');
  const newLines = new_string.split('\n');

  const diffLines = [];

  // Build simple unified diff: show removed lines then added lines
  oldLines.forEach(line => {
    diffLines.push({ type: 'del', text: line });
  });
  newLines.forEach(line => {
    diffLines.push({ type: 'add', text: line });
  });

  return (
    <div className={`diff-view ${styles.wrapper}`}>
      <div className={styles.header}>
        <Text className={styles.filePath}>
          Edit: {file_path}
        </Text>
        <Text
          className={styles.toggle}
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? t('ui.expand') : t('ui.collapse')}
        </Text>
      </div>
      {!collapsed && (
        <pre className={styles.code}>
          {diffLines.map((dl, i) => (
            <div
              key={i}
              className={dl.type === 'del' ? 'diff-line-del' : 'diff-line-add'}
            >
              {dl.type === 'del' ? '- ' : '+ '}{dl.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export default DiffView;
