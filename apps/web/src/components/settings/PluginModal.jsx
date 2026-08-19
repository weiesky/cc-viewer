import React, { useState, useEffect, useRef, useContext } from 'react';
import { Modal, Button, Switch, Input, message } from 'antd';
import { ApiOutlined, PlusOutlined, ReloadOutlined, DeleteOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { isMobile } from '../../env';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import { SettingsContext } from '../../contexts/SettingsContext';
import styles from './PluginModal.module.css';
import sharedChrome from '../common/sharedChrome.module.css';
import appStyles from '../../App.module.css';
import MobileDrawerCloseButton from '../mobile/MobileDrawerCloseButton';

// 插件管理 Modal —— PC + mobile 共用。
// 包含 3 段嵌套 modal：主面板 / 删除确认 / CDN 安装。
// state 全部内部化（pluginsList / pluginsDir / cdnUrl / deleteTarget 等）。
// 仅 open/onClose 控制外层显隐；子 modal 由内部 state 管理。
//
// ─── 项目内 Modal 受控风格判定原则 ────────────────────────────────────────────
// 三种风格并存,各自适用场景:
//
//   1) self-contained  (PluginModal / ProcessModal)
//      数据 *只* 在 modal 内消费,父级不读;fetch / state machine 全在组件内。
//      调用方仅需 <X open={...} onClose={...} />,代码面最小。
//
//   2) 半受控          (ProxyModal)
//      数据来自父级(AppBase)且 *父级其它地方也读* (如工具栏 chip 显示 active proxy);
//      数据走 props 注入避免散点 useState;但 UI 交互态(editingProxy/editForm)仍内部持。
//      调用方需透传数据 props + 上报 callback。
//
//   3) dumb 受控       (SkillsManagerModal / MemoryDetailModal)
//      数据是 *跨组件共享的权威源* (_fsSkills 同时供 popover chip 与 modal,
//      _memoryDetail 由 popover 链接点击驱动);state + handlers 全在父级。
//      调用方完全控制,modal 只渲染。
//
// 加新 modal 时按"数据消费范围"选风格即可,不必抛硬币。
// ─────────────────────────────────────────────────────────────────────────────
//
// 文件上传：使用 useRef + 隐藏 <input type="file"> 的 React 原生方式（替代原 createElement 黑魔法）。
// 关键：onChange 处理完后必须 inputRef.current.value = '' 重置，否则同一文件二次选择不触发。
export default function PluginModal({ open, onClose }) {
  const context = useContext(SettingsContext);
  const fileInputRef = useRef(null);

  const [pluginsList, setPluginsList] = useState([]);
  const [pluginsDir, setPluginsDir] = useState('');
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [cdnModalVisible, setCdnModalVisible] = useState(false);
  const [cdnUrl, setCdnUrl] = useState('');
  const [cdnLoading, setCdnLoading] = useState(false);

  const fetchPlugins = () => {
    return fetch(apiUrl('/api/plugins'))
      .then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(data => {
        setPluginsList(data.plugins || []);
        setPluginsDir(data.pluginsDir || '');
      })
      .catch(() => {});
  };

  // open false→true 触发 fetch；关时不清 pluginsList（与原 AppHeader 等价）
  useEffect(() => {
    if (open) fetchPlugins();
  }, [open]);

  // 父 modal 关闭时联动关闭子 modal（删除确认 / CDN 安装），避免外层关了内层确认仍在屏的孤儿态。
  // 与 ProcessModal:43 / ProxyModal:36 同模式。pluginsList 不在此清(关后重开 fetchPlugins 会重新填)。
  useEffect(() => {
    if (!open) {
      setDeleteConfirmVisible(false);
      setDeleteTarget(null);
      setCdnModalVisible(false);
      setCdnUrl('');
      setCdnLoading(false);
    }
  }, [open]);

  const handleTogglePlugin = (name, enabled) => {
    // 等 SettingsProvider 完成首次 fetch,避免冷启动 RMW 把已持久化的 disabledPlugins 兜底成 []
    context._prefsReady.then(() => {
      // 守卫：default context 的 updatePreferences 是 no-op,直接 return 防止静默丢更新
      if (typeof context.updatePreferences !== 'function') return;
      const prefs = context.preferences || {};
      let disabledPlugins = Array.isArray(prefs.disabledPlugins) ? [...prefs.disabledPlugins] : [];
      if (enabled) {
        disabledPlugins = disabledPlugins.filter(n => n !== name);
      } else {
        if (!disabledPlugins.includes(name)) disabledPlugins.push(name);
      }
      return context.updatePreferences({ disabledPlugins })
        .then(() => fetch(apiUrl('/api/plugins/reload'), { method: 'POST' }))
        .then(r => {
          if (!r.ok) throw new Error(r.status);
          return r.json();
        })
        .then(data => {
          setPluginsList(data.plugins || []);
          setPluginsDir(data.pluginsDir || '');
        });
    }).catch(() => {});
  };

  const handleDeletePlugin = (file, name) => {
    setDeleteTarget({ file, name });
    setDeleteConfirmVisible(true);
  };

  const handleDeletePluginConfirm = () => {
    const file = deleteTarget?.file;
    if (!file) return;
    setDeleteConfirmVisible(false);
    setDeleteTarget(null);
    fetch(apiUrl(`/api/plugins?file=${encodeURIComponent(file)}`), { method: 'DELETE' })
      .then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(data => {
        if (data.plugins) {
          setPluginsList(data.plugins);
          setPluginsDir(data.pluginsDir || '');
        }
      })
      .catch(() => {});
  };

  const handleReloadPlugins = () => {
    fetch(apiUrl('/api/plugins/reload'), { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(data => {
        setPluginsList(data.plugins || []);
        setPluginsDir(data.pluginsDir || '');
      })
      .catch(() => {});
  };

  const handleAddPlugin = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const fileHandles = e.target.files;
    // 关键: 处理后重置 input.value,允许同一文件再次选择触发 onChange
    const resetInput = () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    if (!fileHandles || fileHandles.length === 0) {
      resetInput();
      return;
    }
    for (const f of fileHandles) {
      if (!f.name.endsWith('.js') && !f.name.endsWith('.mjs')) {
        message.error(t('ui.plugins.invalidFile'));
        resetInput();
        return;
      }
    }
    // FileReader 读取所有文件以 JSON 发送
    const readPromises = Array.from(fileHandles).map(f => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: f.name, content: reader.result });
        reader.onerror = () => reject(new Error(`Failed to read ${f.name}`));
        reader.readAsText(f);
      });
    });
    Promise.all(readPromises).then(files => {
      return fetch(apiUrl('/api/plugins/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
    }).then(r => {
      if (!r.ok) {
        return r.text().then(text => {
          try { return JSON.parse(text); } catch { throw new Error(t('ui.plugins.serverError', { status: r.status })); }
        });
      }
      return r.json();
    }).then(data => {
      if (data.error) {
        message.error(t('ui.plugins.addFailed', { reason: data.error }));
      } else if (data.plugins) {
        setPluginsList(data.plugins);
        setPluginsDir(data.pluginsDir || '');
        message.success(t('ui.plugins.addSuccess'));
      }
    }).catch(err => {
      message.error(err.message);
    }).finally(() => {
      resetInput();
    });
  };

  const handleShowCdnModal = () => {
    setCdnUrl('');
    setCdnLoading(false);
    setCdnModalVisible(true);
  };

  const handleCdnUrlChange = (e) => {
    setCdnUrl(e.target.value);
  };

  const handleCdnInstall = () => {
    if (!cdnUrl.trim()) {
      message.error(t('ui.plugins.cdnUrlRequired'));
      return;
    }
    try {
      new URL(cdnUrl);
    } catch {
      message.error(t('ui.plugins.cdnInvalidUrl'));
      return;
    }
    setCdnLoading(true);
    fetch(apiUrl('/api/plugins/install-from-url'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: cdnUrl.trim() }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          message.error(t('ui.plugins.cdnInstallFailed', { reason: data.error }));
        } else {
          message.success(t('ui.plugins.cdnInstallSuccess'));
          if (data.plugins) {
            setPluginsList(data.plugins);
            setPluginsDir(data.pluginsDir || '');
          }
          setCdnModalVisible(false);
          setCdnUrl('');
        }
      })
      .catch(err => {
        message.error(t('ui.plugins.cdnInstallFailed', { reason: err.message || 'Network error' }));
      })
      .finally(() => {
        setCdnLoading(false);
      });
  };

  const handleCdnCancel = () => {
    setCdnModalVisible(false);
    setCdnUrl('');
    setCdnLoading(false);
  };

  const titleNode = (
    <span><ApiOutlined className={sharedChrome.titleIcon} />{t('ui.pluginManagement')}</span>
  );

  const footerNode = (
    <div className={styles.pluginModalFooter}>
      <div className={styles.pluginModalFooterLeft}>
        <Button icon={<PlusOutlined />} onClick={handleAddPlugin}>{t('ui.plugins.add')}</Button>
        <Button icon={<CloudDownloadOutlined />} onClick={handleShowCdnModal}>{t('ui.plugins.cdnInstall')}</Button>
      </div>
      <Button icon={<ReloadOutlined />} onClick={handleReloadPlugins}>{t('ui.plugins.reload')}</Button>
    </div>
  );

  const bodyNode = (
    <>
      {pluginsDir && (
        <div className={styles.pluginDirHint}>
          <span className={styles.pluginDirLabel}>{t('ui.plugins.pluginsDir')}:</span>{' '}
          <code
            className={styles.pluginDirPath}
            onClick={() => {
              navigator.clipboard.writeText(pluginsDir)
                .then(() => { message.success(t('ui.copied')); })
                .catch(() => {});
            }}
          >
            {pluginsDir}
          </code>
        </div>
      )}
      {pluginsList.length === 0 ? (
        <div className={styles.pluginEmpty}>
          <div className={styles.pluginEmptyTitle}>{t('ui.plugins.empty')}</div>
          <div className={styles.pluginEmptyHint}>{t('ui.plugins.emptyHint')}</div>
        </div>
      ) : (
        <div className={styles.pluginList}>
          {pluginsList.map(p => (
            <div key={p.file} className={styles.pluginItem}>
              <div className={styles.pluginInfo}>
                <span className={styles.pluginName}>{p.name}</span>
                <span className={styles.pluginFile}>{p.file}</span>
                {p.hooks.length > 0 && (
                  <span className={styles.pluginHooks}>
                    {p.hooks.map(h => <span key={h} className={styles.pluginHookTag}>{h}</span>)}
                  </span>
                )}
              </div>
              <div className={styles.pluginActions}>
                <Switch
                  size="small"
                  checked={p.enabled}
                  onChange={(checked) => handleTogglePlugin(p.name, checked)}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDeletePlugin(p.file, p.name)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const deleteConfirmModal = (
    /* 删除确认 */
    <Modal
      title={t('ui.plugins.delete')}
      open={deleteConfirmVisible}
      onCancel={() => { setDeleteConfirmVisible(false); setDeleteTarget(null); }}
      onOk={handleDeletePluginConfirm}
      okType="danger"
      okText="OK"
      cancelText="Cancel"
      styles={{ body: isMobile ? { zoom: 0.6 } : {} }}
    >
      <p>{deleteTarget ? t('ui.plugins.deleteConfirm', { name: deleteTarget.name }) : ''}</p>
    </Modal>
  );

  const cdnInstallModal = (
    /* CDN 安装 */
    <Modal
      title={<span><CloudDownloadOutlined className={sharedChrome.titleIcon} />{t('ui.plugins.cdnInstall')}</span>}
      open={cdnModalVisible}
      onCancel={handleCdnCancel}
      onOk={handleCdnInstall}
      confirmLoading={cdnLoading}
      okText={t('ui.plugins.cdnInstallBtn')}
      cancelText={t('ui.cancel')}
      width={480}
      styles={{ body: isMobile ? { zoom: 0.6 } : {} }}
    >
      <div>
        <div className={styles.cdnUrlLabel}>{t('ui.plugins.cdnUrl')}</div>
        <Input
          placeholder={t('ui.plugins.cdnUrlPlaceholder')}
          value={cdnUrl}
          onChange={handleCdnUrlChange}
          onPressEnter={handleCdnInstall}
          className={styles.cdnInput}
        />
      </div>
    </Modal>
  );

  const hiddenFileInput = (
    /* 隐藏 file input —— 通过 ref 触发 click;onChange 后重置 value 防同文件二次失效 */
    <input
      ref={fileInputRef}
      type="file"
      accept=".js,.mjs"
      multiple
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
  );

  if (isMobile) {
    return (
      <>
        {hiddenFileInput}
        <div className={`${appStyles.mobileDrawerOverlay} ${open ? appStyles.mobileDrawerOverlayVisible : ''}`}>
          <div className={appStyles.mobileLogMgmtHeader}>
            <span className={appStyles.mobileLogMgmtTitle}>{titleNode}</span>
            <MobileDrawerCloseButton onClose={onClose} />
          </div>
          <div className={appStyles.mobileDrawerInner}>
            <div className={styles.pluginModalScroll}>
              {bodyNode}
              <div className={styles.pluginModalFooterBar}>
                {footerNode}
              </div>
            </div>
          </div>
        </div>
        {deleteConfirmModal}
        {cdnInstallModal}
      </>
    );
  }

  return (
    <>
      {hiddenFileInput}
      <Modal
        title={titleNode}
        open={open}
        onCancel={onClose}
        footer={footerNode}
        width={560}
        styles={{ body: isMobile ? { zoom: 0.6 } : {}, mask: BLUR_MASK_STYLE }}
      >
        {bodyNode}
      </Modal>
      {deleteConfirmModal}
      {cdnInstallModal}
    </>
  );
}
