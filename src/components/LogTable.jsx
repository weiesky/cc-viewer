import React, { useMemo } from 'react';
import { Table, Checkbox, Button, Tag, Popover } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { formatSize, formatTimestamp } from '../utils/formatters';
import styles from '../App.module.css';

const EMPTY_SET = new Set();

function LogTable({ logs, mobile, selectedLogs = EMPTY_SET, onToggleSelect, onOpenLog, onDownloadLog }) {
  const columns = useMemo(() => [
    {
      title: '',
      dataIndex: 'file',
      key: 'check',
      width: 40,
      fixed: mobile ? 'left' : false,
      render: (file) => (
        <Checkbox
          checked={selectedLogs.has(file) || false}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(file, e.target.checked); }}
        />
      ),
    },
    {
      title: t('ui.logTime'),
      dataIndex: 'timestamp',
      key: 'time',
      width: mobile ? 150 : 180,
      render: (ts) => <span className={styles.tableTimestampCell}>{formatTimestamp(ts, mobile)}</span>,
    },
    {
      title: t('ui.logPreview'),
      dataIndex: 'preview',
      key: 'preview',
      width: mobile ? 150 : undefined,
      ellipsis: true,
      render: (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return '—';
        const first = arr[0];
        // 防 server 偶发返回 [null] / [undefined] / [number] — 强制 string 才用作 displayText
        if (typeof first !== 'string') return '—';
        const displayText = (first.length <= 30 && arr.length > 1) ? `${first} | ${arr[1]}` : first;
        if (arr.length <= 1) return <span className={styles.tablePreviewText}>{displayText}</span>;
        return (
          <Popover
            trigger={mobile ? 'click' : 'hover'}
            placement={mobile ? 'bottomLeft' : 'leftTop'}
            autoAdjustOverflow={{ adjustX: false, adjustY: true }}
            overlayInnerStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-hover)',
              borderRadius: 8,
              padding: 0,
              maxHeight: 400,
              overflowY: 'auto',
            }}
            content={
              <div className={styles.previewPopover}>
                {arr.map((text, i) => (
                  <div key={i} className={styles.previewItem}>
                    <pre className={styles.previewText}>{text}</pre>
                  </div>
                ))}
              </div>
            }
          >
            <span className={styles.tablePreviewTextClickable} style={{ textDecoration: mobile ? 'underline dotted #666' : 'none' }}>{displayText}</span>
          </Popover>
        );
      },
    },
    ...(!mobile ? [{
      title: t('ui.logTurns'),
      dataIndex: 'turns',
      key: 'turns',
      width: 80,
      render: (v) => <Tag className={styles.tableTag}>{v || 0}</Tag>,
    }] : []),
    {
      title: t('ui.logSize'),
      dataIndex: 'size',
      key: 'size',
      width: 90,
      render: (v) => <Tag className={styles.tableTag}>{formatSize(v)}</Tag>,
    },
    {
      title: t('ui.logActions'),
      key: 'actions',
      width: mobile ? 160 : 180,
      render: (_, log) => (
        <span className={styles.tableActionsCell}>
          <Button size="small" type="primary" onClick={(e) => { e.stopPropagation(); onOpenLog(log.file); }}>
            {t('ui.openLog')}
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={(e) => { e.stopPropagation(); onDownloadLog(log.file); }}>
            {t('ui.downloadLog')}
          </Button>
        </span>
      ),
    },
  ], [mobile, selectedLogs, onToggleSelect, onOpenLog, onDownloadLog]);

  return (
    <Table
      size="small"
      dataSource={logs}
      columns={columns}
      rowKey="file"
      pagination={false}
      scroll={mobile ? { x: 'max-content', y: 'calc(100vh - 160px)' } : { y: 400 }}
      onRow={(log) => ({
        onClick: () => {
          const checked = !selectedLogs.has(log.file);
          onToggleSelect(log.file, checked);
        },
        style: { cursor: 'pointer' },
      })}
    />
  );
}

export default LogTable;
