import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Radio, Select, Tag, message } from 'antd';
import { EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import { isMobile } from '../env';
import OpenFolderIcon from './OpenFolderIcon';
import ConceptHelp from './ConceptHelp';
import styles from './AppHeader.module.css';
import appStyles from '../App.module.css';
import MobileDrawerCloseButton from './MobileDrawerCloseButton';

// 代理热切换 Modal —— PC + mobile 共用。
// 风格:半受控(proxyProfiles/activeProxyId 是父级跨组件共享数据 → props 注入;
// editingProxy/editForm 仅本 modal 用 → 内部 state)。受控风格判定原则见 PluginModal.jsx 头注释。
// 不持有 proxy 数据本身（来自 AppBase state，通过 props 注入）；
// 只持有交互 state：editingProxy（'__new__' / id / null）+ editForm 5-field 对象。
// open false→true / true→false 双向重置 editingProxy 与 editForm,避免重开残留上次表单。
//
// 删除确认改为受控 Modal（deleteConfirmTarget state）替代 Modal.confirm —— 后者 portal 到 body
// 不受父 modal 关闭联动控制 (defensive review P2-2),且在 mobile zoom:0.6 容器下不缩放。
const EMPTY_FORM = { name: '', baseURL: '', apiKey: '', models: '', activeModel: '' };

export default function ProxyModal({
  open,
  onClose,
  proxyProfiles,
  activeProxyId,
  defaultConfig,
  onProxyProfileChange,
}) {
  const [editingProxy, setEditingProxy] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);

  // open 变化时 reset 表单状态 + 删除确认。等价于原 AppHeader.jsx:1935 onCancel 里 setState({editingProxy:null})
  useEffect(() => {
    if (!open) {
      setEditingProxy(null);
      setEditForm(EMPTY_FORM);
      setDeleteConfirmTarget(null);
    }
  }, [open]);

  const profiles = proxyProfiles || [];
  const activeId = activeProxyId || 'max';

  // setEditForm 必须用 prev callback,否则 5 字段会被单字段更新覆盖丢字段
  const updateField = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleStartEdit = (p) => {
    setEditingProxy(p.id);
    setEditForm({
      name: p.name || '',
      baseURL: p.baseURL || '',
      apiKey: p.apiKey || '',
      models: (p.models || []).join(', '),
      activeModel: p.activeModel || '',
    });
  };

  const handleStartNew = () => {
    setEditingProxy('__new__');
    setEditForm(EMPTY_FORM);
  };

  const handleCancelEdit = () => {
    setEditingProxy(null);
  };

  // 删除确认改受控 Modal:点击删除按钮 → 弹确认 modal,父 modal 关时联动关闭
  const handleDeleteProxy = (p) => {
    setDeleteConfirmTarget(p);
  };

  const handleDeleteConfirm = () => {
    if (!deleteConfirmTarget) return;
    const newProfiles = profiles.filter(x => x.id !== deleteConfirmTarget.id);
    const newActive = activeId === deleteConfirmTarget.id ? 'max' : activeId;
    onProxyProfileChange({ active: newActive, profiles: newProfiles });
    setDeleteConfirmTarget(null);
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmTarget(null);
  };

  const handleActivate = (p) => {
    if (p.id !== activeId) {
      onProxyProfileChange({ active: p.id, profiles });
    }
  };

  const handleSave = () => {
    if (!editForm.name?.trim() || !editForm.baseURL?.trim() || !editForm.apiKey?.trim()) {
      message.warning(t('ui.proxy.requiredFields'));
      return;
    }
    const models = (editForm.models || '').split(',').map(m => m.trim()).filter(Boolean);
    const updated = {
      id: editingProxy === '__new__' ? `proxy_${Date.now()}` : editingProxy,
      name: editForm.name.trim(),
      baseURL: editForm.baseURL.trim(),
      apiKey: editForm.apiKey.trim(),
      models,
      activeModel: editForm.activeModel || models[0] || '',
    };
    let newProfiles;
    if (editingProxy === '__new__') {
      newProfiles = [...profiles, updated];
    } else {
      newProfiles = profiles.map(p => p.id === editingProxy ? { ...p, ...updated, id: p.id } : p);
    }
    onProxyProfileChange({ active: activeId, profiles: newProfiles });
    setEditingProxy(null);
  };

  const titleNode = (
    <span>
      <OpenFolderIcon apiEndpoint={apiUrl('/api/open-profile-dir')} title={t('ui.proxy.openConfigDir')} size={16} />
      {' '}{t('ui.proxySwitch')}{' '}
      <ConceptHelp doc="ProxySwitch" zIndex={1100} />
    </span>
  );

  const bodyNode = (
    <div>
      <div className={styles.proxyWarning}>⚠️ {t('ui.proxy.maxWarning')}</div>
      <div className={styles.proxyList}>
          {profiles.map(p => (
            <div key={p.id} className={`${styles.proxyItem} ${p.id === activeId ? styles.proxyItemActive : ''}`}>
              <div className={styles.proxyItemMain} onClick={() => handleActivate(p)}>
                <Radio checked={p.id === activeId} style={{ marginRight: 8 }} />
                <div className={styles.proxyItemInfo}>
                  <div className={styles.proxyItemNameRow}>
                    <span className={styles.proxyItemName}>{p.name}</span>
                    {p.id === 'max' && <Tag className={styles.proxyBuiltinTag}>{t('ui.proxy.builtin')}</Tag>}
                  </div>
                  {p.id === 'max' && defaultConfig && (
                    <div className={styles.proxyItemDetail}>
                      {(() => { try { return new URL(defaultConfig.origin).host; } catch { return defaultConfig.origin; } })()}
                      {defaultConfig.authType ? ` · ${defaultConfig.authType}` : ''}
                      {defaultConfig.apiKey ? ` · ${defaultConfig.apiKey}` : ''}
                      {defaultConfig.model ? ` · ${defaultConfig.model}` : ''}
                    </div>
                  )}
                  {p.id !== 'max' && p.baseURL && (
                    <div className={styles.proxyItemDetail}>
                      {(() => { try { return new URL(p.baseURL).host; } catch { return p.baseURL; } })()}
                      {p.activeModel ? ` · ${p.activeModel}` : (p.models?.length ? ` · ${p.models[0]}` : '')}
                    </div>
                  )}
                </div>
              </div>
              {p.id !== 'max' && (
                <div className={styles.proxyItemActions}>
                  <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleStartEdit(p)} />
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteProxy(p)} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 编辑/新增表单 */}
        {editingProxy && (
          <div className={styles.proxyEditForm}>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.name')} <span className={styles.proxyRequired}>*</span></label>
              <Input size="small" value={editForm.name} onChange={e => updateField('name', e.target.value)} />
            </div>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.baseURL')} <span className={styles.proxyRequired}>*</span></label>
              <Input size="small" value={editForm.baseURL} onChange={e => updateField('baseURL', e.target.value)} placeholder="https://api.example.com" />
            </div>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.apiKey')} <span className={styles.proxyRequired}>*</span></label>
              <Input.Password size="small" value={editForm.apiKey} onChange={e => updateField('apiKey', e.target.value)} placeholder="sk-..." />
            </div>
            <div className={styles.proxyEditDivider} />
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.models')}</label>
              <Input size="small" value={editForm.models} onChange={e => updateField('models', e.target.value)} placeholder="model-1, model-2" />
            </div>
            <div className={styles.proxyEditRow}>
              <label>{t('ui.proxy.activeModel')}</label>
              <Select size="small" className={styles.fullWidthSelect} value={editForm.activeModel || undefined} onChange={v => updateField('activeModel', v)} placeholder={t('ui.proxy.activeModel')}>
                {(editForm.models || '').split(',').map(m => m.trim()).filter(Boolean).map(m => (
                  <Select.Option key={m} value={m}>{m}</Select.Option>
                ))}
              </Select>
            </div>
            <div className={styles.proxyEditBtns}>
              <Button size="small" icon={<CheckOutlined />} type="primary" onClick={handleSave}>{t('ui.proxy.save')}</Button>
              <Button size="small" icon={<CloseOutlined />} onClick={handleCancelEdit}>{t('ui.proxy.cancel')}</Button>
            </div>
          </div>
        )}

        {!editingProxy && (
          <Button block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={handleStartNew}>
            {t('ui.proxy.addProxy')}
          </Button>
        )}
      </div>
  );

  const deleteConfirmModal = (
    /* 受控 Modal,父关时通过 useEffect 联动关闭,避免孤儿态 */
    <Modal
      title={t('ui.proxy.deleteProxy')}
      open={deleteConfirmTarget !== null}
      onCancel={handleDeleteCancel}
      onOk={handleDeleteConfirm}
      okType="danger"
      styles={{ body: isMobile ? { zoom: 0.6 } : {} }}
    >
      {deleteConfirmTarget && t('ui.proxy.deleteConfirm', { name: deleteConfirmTarget.name })}
    </Modal>
  );

  if (isMobile) {
    return (
      <>
        <div className={`${appStyles.mobileDrawerOverlay} ${open ? appStyles.mobileDrawerOverlayVisible : ''}`}>
          <div className={appStyles.mobileLogMgmtHeader}>
            <span className={appStyles.mobileLogMgmtTitle}>{titleNode}</span>
            <MobileDrawerCloseButton onClose={onClose} />
          </div>
          <div className={appStyles.mobileDrawerInner}>
            <div className={styles.proxyModalScroll}>
              {bodyNode}
            </div>
          </div>
        </div>
        {deleteConfirmModal}
      </>
    );
  }

  return (
    <>
      <Modal
        title={titleNode}
        open={open}
        onCancel={onClose}
        footer={null}
        width={520}
        styles={{ body: isMobile ? { zoom: 0.6 } : {} }}
      >
        {bodyNode}
      </Modal>
      {deleteConfirmModal}
    </>
  );
}
