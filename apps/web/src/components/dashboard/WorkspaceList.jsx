import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Empty, Typography, Space, Card, Popconfirm, message, Spin, Modal, Tag } from 'antd';
import { FolderOpenOutlined, FolderOutlined, DeleteOutlined, PlusOutlined, RocketOutlined, ClockCircleOutlined, DatabaseOutlined, BranchesOutlined, CloseOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { formatSize } from '../../utils/formatters';
import styles from './WorkspaceList.module.css';

const { Text, Title } = Typography;

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
  const [dirs, setDirs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [homePath, setHomePath] = useState('');

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
          setDirs(data.dirs || []);
          setPathInput(data.current);
          // 无 path 参数时服务端返回的是 home 目录，记录下来用于面包屑显示 "~"
          if (!path) setHomePath(data.current);
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

  // 把当前路径拆成可逐级点击的面包屑；home 目录用 "~" 表示
  const buildCrumbs = () => {
    const cur = currentPath;
    if (!cur) return [];
    const underHome = homePath && (cur === homePath || cur.startsWith(homePath + '/'));
    const leadLabel = underHome ? '~' : '/';
    const leadPath = underHome ? homePath : '/';
    const restStr = underHome
      ? (cur === homePath ? '' : cur.slice(homePath.length + 1))
      : cur;
    const rest = restStr.split('/').filter(Boolean);
    const tokens = [{ type: 'crumb', label: leadLabel, path: leadPath }];
    let acc = leadPath;
    rest.forEach((name, i) => {
      acc = (acc === '/' ? '' : acc) + '/' + name;
      if (!(i === 0 && leadLabel === '/')) tokens.push({ type: 'sep' });
      tokens.push({ type: 'crumb', label: name, path: acc });
    });
    return tokens;
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
      {/* 当前路径（逐级可点击的面包屑）；逐级回退用面包屑即可，不再放「上一级」箭头按钮 */}
      <div className={styles.dirPathHeader}>
        <div className={styles.dirCurrentPath}>
          {buildCrumbs().map((tk, i) =>
            tk.type === 'sep' ? (
              <span key={i} className={styles.dirCrumbSep}>/</span>
            ) : (
              <span
                key={i}
                className={styles.dirCrumb}
                title={tk.path}
                onClick={() => browse(tk.path)}
              >
                {tk.label}
              </span>
            )
          )}
        </div>
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
                {t('ui.workspaces.launch')}
              </Button>
            </div>
          ))
        )}
      </div>

      {/* 也可以直接启动当前目录 */}
      <div className={styles.dirFooter}>
        <Button
          type="primary"
          ghost
          block
          icon={<FolderOpenOutlined />}
          onClick={() => onSelect(currentPath)}
        >
          {t('ui.workspaces.launchCurrent')} — {currentPath.split('/').pop() || currentPath}
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
  // Electron 多 tab 模式下点「+」时，main 会把本页以浮层叠在当前 tab 之上并推 mode='popup'；
  // 此时渲染半透明遮罩 + 居中卡片。非 Electron / Mobile 永远收不到该事件，保持整页。
  const [popup, setPopup] = useState(false);

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

  const closePopup = useCallback(() => {
    window.electronAPI?.closeWorkspacePopup?.();
  }, []);

  // 订阅工作区选择器模式（浮层 / 整页）。仅 Electron workspaceView 会收到。
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onWorkspaceMode) return undefined;
    const unsub = api.onWorkspaceMode((mode) => {
      const on = mode === 'popup';
      setPopup(on);
      document.body.classList.toggle('ccv-ws-popup', on);
      if (on) fetchWorkspaces(); // 每次开浮层刷新，纳入新增项目
    });
    api.requestWorkspaceMode?.(); // 挂载即同步当前模式，消除首帧竞态
    return () => {
      if (typeof unsub === 'function') unsub();
      document.body.classList.remove('ccv-ws-popup');
    };
  }, []);

  // 浮层模式下 Esc 关闭。
  useEffect(() => {
    if (!popup) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closePopup(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popup, closePopup]);

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

  const isElectron = !!window.electronAPI?.launchWorkspace;

  const content = (
    <div
      className={popup ? `${styles.root} ${styles.popupCard}` : styles.root}
      onClick={popup ? (e) => e.stopPropagation() : undefined}
    >
      {popup && (
        <Button
          type="text"
          className={styles.popupClose}
          icon={<CloseOutlined />}
          aria-label={t('ui.workspaces.closePopup')}
          onClick={closePopup}
        />
      )}
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
          <div className={styles.grid}>
            {workspaces.map(item => (
              <Card
                key={item.id}
                size="small"
                className={styles.card}
                hoverable
                onClick={() => handleLaunch(item, false)}
              >
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
                <div className={styles.cardActions}>
                  <Space size={8}>
                    <Button
                      type="primary"
                      icon={<RocketOutlined />}
                      loading={launching === item.id}
                      onClick={(e) => { e.stopPropagation(); handleLaunch(item, false); }}
                    >
                      {t(isElectron ? 'ui.workspaces.launch' : 'ui.workspaces.normalLaunch')}
                    </Button>
                    {!isElectron && (
                      <Button
                        icon={<RocketOutlined />}
                        loading={launching === item.id}
                        onClick={(e) => { e.stopPropagation(); handleLaunch(item, true); }}
                        style={{ background: '#d97706', borderColor: '#d97706', color: '#fff' }}
                      >
                        {t('ui.workspaces.skipPermLaunch')}
                      </Button>
                    )}
                  </Space>
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
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <DirBrowser
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onSelect={handleAddFromBrowser}
      />
    </div>
  );

  return popup ? (
    <div className={styles.scrim} onClick={closePopup}>{content}</div>
  ) : content;
}
