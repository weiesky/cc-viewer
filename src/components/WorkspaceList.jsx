import React, { useState, useEffect, useCallback } from 'react';
import { List, Button, Input, Empty, Typography, Space, Card, Popconfirm, message, Spin, Modal, Tag } from 'antd';
import { FolderOpenOutlined, FolderOutlined, DeleteOutlined, PlusOutlined, RocketOutlined, ClockCircleOutlined, DatabaseOutlined, ArrowUpOutlined, BranchesOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import styles from './WorkspaceList.module.css';

const { Text, Title } = Typography;

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('ui.workspaces.justNow');
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// 目录浏览器 Modal
function DirBrowser({ open, onClose, onSelect }) {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState(null);
  const [dirs, setDirs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pathInput, setPathInput] = useState('');

  const browse = useCallback((path) => {
    setLoading(true);
    const url = path ? `/api/browse-dir?path=${encodeURIComponent(path)}` : '/api/browse-dir';
    fetch(apiUrl(url))
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          message.error(data.error);
        } else {
          setCurrentPath(data.current);
          setParentPath(data.parent);
          setDirs(data.dirs || []);
          setPathInput(data.current);
        }
        setLoading(false);
      })
      .catch(() => {
        message.error('Failed to browse directory');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (open) browse('');
  }, [open, browse]);

  const handleGoTo = () => {
    const p = pathInput.trim();
    if (p) browse(p);
  };

  return (
    <Modal
      title={t('ui.workspaces.selectDir')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      styles={{ body: { padding: '12px 0' } }}
    >
      {/* 当前路径 + 上级按钮 */}
      <div className={styles.dirPathHeader}>
        <Button
          type="text"
          icon={<ArrowUpOutlined />}
          disabled={!parentPath}
          onClick={() => parentPath && browse(parentPath)}
          size="small"
        />
        <Text className={styles.dirCurrentPath}>
          <FolderOpenOutlined className={styles.dirFolderIcon} />
          {currentPath}
        </Text>
      </div>

      {/* 目录列表 */}
      <div className={styles.dirList}>
        {loading ? (
          <div className={styles.dirListCenter}><Spin /></div>
        ) : dirs.length === 0 ? (
          <div className={styles.dirListCenter}>
            <Text type="secondary">{t('ui.workspaces.emptyDir')}</Text>
          </div>
        ) : (
          dirs.map(dir => (
            <div
              key={dir.path}
              className={styles.dirItem}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div
                className={styles.dirItemInner}
                onClick={() => browse(dir.path)}
              >
                <FolderOutlined style={{ color: dir.hasGit ? 'var(--color-primary)' : 'var(--text-muted)', fontSize: 16, flexShrink: 0 }} />
                <Text className={styles.dirItemName}>
                  {dir.name}
                </Text>
                {dir.hasGit && (
                  <Tag color="blue" className={styles.dirGitTag}>
                    <BranchesOutlined style={{ marginRight: 2 }} />git
                  </Tag>
                )}
              </div>
              <Button
                type="primary"
                size="small"
                onClick={(e) => { e.stopPropagation(); onSelect(dir.path); }}
              >
                {t('ui.workspaces.select')}
              </Button>
            </div>
          ))
        )}
      </div>

      {/* 也可以选择当前目录 */}
      <div className={styles.dirFooter}>
        <Button
          type="primary"
          ghost
          block
          icon={<FolderOpenOutlined />}
          onClick={() => onSelect(currentPath)}
        >
          {t('ui.workspaces.selectCurrent')} — {currentPath.split('/').pop() || currentPath}
        </Button>
        <div className={styles.dirPathInputRow}>
          <Input
            size="small"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onPressEnter={handleGoTo}
            placeholder={t('ui.workspaces.pathPlaceholder')}
            className={styles.dirPathInput}
          />
          <Button size="small" onClick={handleGoTo}>{t('ui.workspaces.goTo')}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function WorkspaceList({ onLaunch }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  const fetchWorkspaces = () => {
    fetch(apiUrl('/api/workspaces'))
      .then(res => res.json())
      .then(data => {
        setWorkspaces(data.workspaces || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const handleAddFromBrowser = (path) => {
    setBrowseOpen(false);
    fetch(apiUrl('/api/workspaces/add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          message.error(data.error);
        } else {
          fetchWorkspaces();
        }
      })
      .catch(() => message.error('Failed to add workspace'));
  };

  const handleRemove = (id) => {
    fetch(apiUrl(`/api/workspaces/${id}`), { method: 'DELETE' })
      .then(res => res.json())
      .then(() => fetchWorkspaces())
      .catch(() => {});
  };

  const handleLaunch = (workspace, dangerousMode = false) => {
    setLaunching(workspace.id);
    const extraArgs = [];
    if (dangerousMode) extraArgs.push('--dangerously-skip-permissions');
    if (workspace.logCount > 0) extraArgs.push('-c');
    // Electron multi-tab mode: launch via IPC instead of server API
    if (window.electronAPI?.launchWorkspace) {
      window.electronAPI.launchWorkspace(workspace.path, extraArgs);
      setLaunching(null);
      return;
    }
    fetch(apiUrl('/api/workspaces/launch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspace.path, extraArgs }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          message.error(data.error);
          setLaunching(null);
        } else {
          onLaunch({ projectName: data.projectName, path: workspace.path });
        }
      })
      .catch(() => {
        message.error('Launch failed');
        setLaunching(null);
      });
  };

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <Title level={3} className={styles.headerTitle}>
            <FolderOpenOutlined className={styles.headerFolderIcon} />
            {t('ui.workspaces.title')}
          </Title>
          <Text type="secondary" className={styles.headerSubtitle}>{t('ui.workspaces.subtitle')}</Text>
        </div>

        <div className={styles.addButtonRow}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setBrowseOpen(true)}
            size="large"
          >
            {t('ui.workspaces.browse')}
          </Button>
        </div>

        {loading ? (
          <div className={styles.loadingCenter}>
            <Spin />
          </div>
        ) : workspaces.length === 0 ? (
          <Empty
            description={<Text type="secondary">{t('ui.workspaces.empty')}</Text>}
            className={styles.emptyState}
          />
        ) : (
          <List
            dataSource={workspaces}
            renderItem={item => (
              <Card
                key={item.id}
                size="small"
                className={styles.card}
                hoverable
                onClick={() => handleLaunch(item, false)}
              >
                <div className={styles.cardRow}>
                  <div className={styles.cardLeft}>
                    <div className={styles.cardNameRow}>
                      <Text strong className={styles.cardName}>{item.projectName}</Text>
                    </div>
                    <Text type="secondary" className={styles.cardPath}>{item.path}</Text>
                    <div className={styles.cardMeta}>
                      <span><ClockCircleOutlined style={{ marginRight: 4 }} />{timeAgo(item.lastUsed)}</span>
                      {item.logCount > 0 && (
                        <span><DatabaseOutlined style={{ marginRight: 4 }} />{item.logCount} logs ({formatSize(item.totalSize)})</span>
                      )}
                    </div>
                  </div>
                  <Space>
                    <Button
                      type="primary"
                      icon={<RocketOutlined />}
                      loading={launching === item.id}
                      onClick={(e) => { e.stopPropagation(); handleLaunch(item, false); }}
                    >
                      {t('ui.workspaces.normalLaunch')}
                    </Button>
                    <Button
                      icon={<RocketOutlined />}
                      loading={launching === item.id}
                      onClick={(e) => { e.stopPropagation(); handleLaunch(item, true); }}
                      style={{ background: '#d97706', borderColor: '#d97706', color: '#fff' }}
                    >
                      {t('ui.workspaces.skipPermLaunch')}
                    </Button>
                    <Popconfirm
                      title={t('ui.workspaces.confirmRemove')}
                      onConfirm={(e) => { e?.stopPropagation(); handleRemove(item.id); }}
                      onCancel={(e) => e?.stopPropagation()}
                      okText="Yes"
                      cancelText="No"
                    >
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </Space>
                </div>
              </Card>
            )}
          />
        )}
      </div>

      <DirBrowser
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onSelect={handleAddFromBrowser}
      />
    </div>
  );
}
