import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Empty, Typography, Popconfirm, message, Modal } from 'antd';
import { FolderOpenOutlined, DeleteOutlined, PlusOutlined, RocketOutlined, ClockCircleOutlined, DatabaseOutlined, CloseOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { formatSize } from '../../utils/formatters';
import DirBrowser from './DirBrowser';
import Loading from '../common/Loading';
import styles from './WorkspaceList.module.css';

const { Text, Title } = Typography;

// 「查看更多」截断阈值(2026-10-08):workspace 表格默认只显示前 N 行,末尾「查看更多」
// 展开剩余的。抽常量避免在 slice/length>N/length-N 三处重复硬编(参考 WebSearchResultsView
// 的 MOBILE_PREVIEW_COUNT 先例)。
const PREVIEW_ROWS = 5;

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

export default function WorkspaceList({ onLaunch, embedded = false }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  // Electron 多 tab 模式下点「+」时，main 会把本页以浮层叠在当前 tab 之上并推 mode='popup'；
  // 此时渲染半透明遮罩 + 居中卡片。非 Electron / Mobile 永远收不到该事件，保持整页。
  const [popup, setPopup] = useState(false);
// 「查看更多」展开态(2026-10-08):默认只显示前 PREVIEW_ROWS 行,点表格末尾的展开行才显示全部。
  // 前端不传 ?limit= —— 是有意的:隐藏行的 logCount 驱动 handleLaunch 的 auto -c 启发式
  // (item.logCount > 0 → 续接历史会话),必须随响应就位。后端 limit 参数留给将来的真分页;
  // 实测带缓存的全量富化 ~265ms,前端截断只是显示选择,不是性能优化。
  const [showAll, setShowAll] = useState(false);

  const fetchWorkspaces = () => {
    fetch(apiUrl('/api/workspaces'))
      .then(res => res.json())
      .then(data => {
        setWorkspaces(data.workspaces || []);
        setTotal(typeof data.total === 'number' ? data.total : (data.workspaces || []).length);
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

  const handleLaunch = (workspace) => {
    setLaunching(workspace.id);
    const extraArgs = [];
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

  const content = (
    <div
      className={popup ? `${styles.root} ${styles.popupCard}` : (embedded ? `${styles.root} ${styles.modalBody}` : styles.root)}
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
            <Loading />
          </div>
        ) : workspaces.length === 0 ? (
          <Empty
            description={<Text type="secondary">{t('ui.workspaces.empty')}</Text>}
            className={styles.emptyState}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>{t('ui.workspaces.colProject')}</th>
                  <th className={styles.th}>{t('ui.workspaces.colPath')}</th>
                  <th className={styles.th}>{t('ui.workspaces.colLastUsed')}</th>
                  <th className={styles.th}>{t('ui.workspaces.colLogs')}</th>
                  <th className={`${styles.th} ${styles.thActions}`}>{t('ui.workspaces.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? workspaces : workspaces.slice(0, PREVIEW_ROWS)).map(item => (
                  <tr key={item.id} className={styles.tr}>
                    <td className={styles.td}>
                      <Text strong className={styles.cellName}>{item.projectName}</Text>
                    </td>
                    <td className={styles.td}>
                      <Text type="secondary" className={styles.cellPath} title={item.path}>{item.path}</Text>
                    </td>
                    <td className={`${styles.td} ${styles.tdMeta}`}>
                      <ClockCircleOutlined style={{ marginRight: 4 }} />{timeAgo(item.lastUsed)}
                    </td>
                    <td className={`${styles.td} ${styles.tdMeta}`}>
                      {item.logCount > 0 && (
                        <span><DatabaseOutlined style={{ marginRight: 4 }} />{item.logCount} logs ({formatSize(item.totalSize)})</span>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.tdActions}`}>
                      <Button
                        type="primary"
                        size="small"
                        icon={<RocketOutlined />}
                        loading={launching === item.id}
                        onClick={() => handleLaunch(item)}
                      >
                        {t('ui.workspaces.launch')}
                      </Button>
                      <Popconfirm
                        title={t('ui.workspaces.confirmRemove')}
                        onConfirm={() => handleRemove(item.id)}
                        okText="Yes"
                        cancelText="No"
                      >
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                        />
                      </Popconfirm>
                    </td>
                  </tr>
                ))}
                {!showAll && workspaces.length > PREVIEW_ROWS && (
                  <tr className={`${styles.tr} ${styles.showMoreRow}`} onClick={() => setShowAll(true)}>
                    <td className={styles.td} colSpan={5}>
                      {t('ui.workspaces.showMore', { count: workspaces.length - PREVIEW_ROWS })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
