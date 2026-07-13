import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Radio, Select, Tag, message } from 'antd';
import { EditOutlined, DeleteOutlined, PlusOutlined, ImportOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { isMobile } from '../../env';
import { apiUrl, appendToken } from '../../utils/apiUrl';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import ConceptHelp from '../common/ConceptHelp';
import styles from './ProxyModal.module.css';
import appStyles from '../../App.module.css';
import MobileDrawerCloseButton from '../mobile/MobileDrawerCloseButton';

// 代理热切换 Modal —— PC + mobile 共用。
// 风格:半受控(proxyProfiles/activeProxyId 是父级跨组件共享数据 → props 注入;
// editingProxy/editForm 仅本 modal 用 → 内部 state)。受控风格判定原则见 PluginModal.jsx 头注释。
// 不持有 proxy 数据本身（来自 AppBase state，通过 props 注入）；
// 只持有交互 state：editingProxy（'__new__' / id / null）+ editForm（name/baseURL/apiKey/effort + 4 个模型字段）。
// open false→true / true→false 双向重置 editingProxy 与 editForm,避免重开残留上次表单。
//
// 删除确认改为受控 Modal（deleteConfirmTarget state）替代 Modal.confirm —— 后者 portal 到 body
// 不受父 modal 关闭联动控制 (defensive review P2-2),且在 mobile zoom:0.6 容器下不缩放。
const EMPTY_FORM = {
  name: '', baseURL: '', apiKey: '', effort: 'max',
  // 模型字段直接沿用 Claude Code 环境变量名；ANTHROPIC_MODEL=主模型(fable/mythos/未识别家族)，
  // 其余三项为扩展配置(按 body.model 家族 opus/sonnet/haiku 匹配替换)。空 = 该家族不改写。
  ANTHROPIC_MODEL: '',
  ANTHROPIC_DEFAULT_OPUS_MODEL: '',
  ANTHROPIC_DEFAULT_SONNET_MODEL: '',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
};

// output_config.effort 可选值（对应 CLAUDE_CODE_EFFORT_LEVEL）；空串 = 不注入，透传原始请求。
const EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'];

// 扩展模型字段（env 变量名直接作为 label）。ANTHROPIC_MODEL 单列在前，非扩展项。
const EXTENDED_MODEL_FIELDS = ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'];

// profile 行/标签展示的代表模型：主模型优先，其次任一扩展家族字段，再回退老 activeModel（旧数据）。
export function profileDisplayModel(p) {
  if (!p) return '';
  return p.ANTHROPIC_MODEL
    || p.ANTHROPIC_DEFAULT_OPUS_MODEL
    || p.ANTHROPIC_DEFAULT_SONNET_MODEL
    || p.ANTHROPIC_DEFAULT_HAIKU_MODEL
    || p.activeModel
    || '';
}

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
  const [importing, setImporting] = useState(false);

  // 从 cc-switch 导入：POST /api/ccswitch-import（local-only），merge 进 profile.json。
  // 成功后主动重新 GET /api/proxy-profiles 刷新列表（不依赖 SSE——SSE proxy_profile
  // 事件在 profile:null 时不触发重新 GET，本地有时序问题，直接 fetch 最可靠）。
  const handleImportFromCcSwitch = async () => {
    setImporting(true);
    try {
      const resp = await fetch(appendToken(apiUrl('/api/ccswitch-import')), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setActive: false }),
      });
      const data = await resp.json();
      if (data.error && data.imported === 0 && data.updated === 0) {
        message.error(t('ui.proxy.ccswitchImportFail') + (data.error ? ': ' + data.error : ''));
      } else {
        message.success(t('ui.proxy.ccswitchImported', { imported: data.imported || 0, updated: data.updated || 0 }));
        // 主动重新拉取 profile 列表刷新 UI（导入是列表变化，SSE profile:null 不触发重 GET）
        try {
          const pr = await fetch(appendToken(apiUrl('/api/proxy-profiles')));
          const pd = await pr.json();
          if (pd.profiles && onProxyProfileChange) {
            onProxyProfileChange({ active: pd.active, profiles: pd.profiles });
          }
        } catch { /* 刷新失败不阻塞，SSE 兜底 */ }
      }
    } catch (err) {
      message.error(t('ui.proxy.ccswitchImportFail'));
    } finally {
      setImporting(false);
    }
  };

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

  // setEditForm 必须用 prev callback,否则多字段会被单字段更新覆盖丢字段
  const updateField = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleStartEdit = (p) => {
    setEditingProxy(p.id);
    setEditForm({
      name: p.name || '',
      baseURL: p.baseURL || '',
      apiKey: p.apiKey || '',
      effort: p.effort || '',
      // 旧数据迁移：老 profile 只有 activeModel（整体替换）→ 预填到 ANTHROPIC_MODEL
      ANTHROPIC_MODEL: p.ANTHROPIC_MODEL || p.activeModel || '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: p.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: p.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: p.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
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
    const updated = {
      id: editingProxy === '__new__' ? `proxy_${Date.now()}` : editingProxy,
      name: editForm.name.trim(),
      baseURL: editForm.baseURL.trim(),
      apiKey: editForm.apiKey.trim(),
      effort: editForm.effort || '',
      ANTHROPIC_MODEL: (editForm.ANTHROPIC_MODEL || '').trim(),
      ANTHROPIC_DEFAULT_OPUS_MODEL: (editForm.ANTHROPIC_DEFAULT_OPUS_MODEL || '').trim(),
      ANTHROPIC_DEFAULT_SONNET_MODEL: (editForm.ANTHROPIC_DEFAULT_SONNET_MODEL || '').trim(),
      ANTHROPIC_DEFAULT_HAIKU_MODEL: (editForm.ANTHROPIC_DEFAULT_HAIKU_MODEL || '').trim(),
    };
    let newProfiles;
    if (editingProxy === '__new__') {
      newProfiles = [...profiles, updated];
    } else {
      // 直接以 updated 覆盖（不 spread 旧 p）—— 顺带清掉老 models/activeModel 遗留字段
      newProfiles = profiles.map(p => p.id === editingProxy ? { ...updated, id: p.id } : p);
    }
    onProxyProfileChange({ active: activeId, profiles: newProfiles });
    setEditingProxy(null);
  };

  const titleNode = (
    <span>
      {t('ui.proxySwitch')}{' '}
      <ConceptHelp doc="ProxySwitch" zIndex={1100} />
    </span>
  );

  // 仅当「Default(内置)」走官方 Anthropic 端点(api.anthropic.com，即 Max 订阅 OAuth 场景)时
  // 才提示「Max 用户请勿使用」；用户已切到第三方/自建端点则无此风险，隐藏告警。
  const showMaxWarning = /api\.anthropic\.com/i.test(defaultConfig?.origin || '');

  const bodyNode = (
    <div>
      {showMaxWarning && <div className={styles.proxyWarning}>⚠️ {t('ui.proxy.maxWarning')}</div>}
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
                      {profileDisplayModel(p) ? ` · ${profileDisplayModel(p)}` : ''}
                      {p.effort ? ` · effort: ${p.effort}` : ''}
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

        <Button block type="dashed" icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={handleStartNew}>
          {t('ui.proxy.addProxy')}
        </Button>
        <Button block type="dashed" icon={<ImportOutlined />} style={{ marginTop: 8 }} loading={importing} onClick={handleImportFromCcSwitch}>
          {t('ui.proxy.ccswitchImport')}
        </Button>
        <div className={styles.proxyEditHint}>{t('ui.proxy.ccswitchImportHint')}</div>
      </div>
  );

  // 编辑/新增表单 —— 二级弹窗(独立 Modal,浮于主弹窗之上),不再内联挤在列表下方。
  // 受控:open 绑定 editingProxy;父关时由 useEffect 联动重置 editingProxy → 一并关闭。
  const editModal = (
    <Modal
      title={editingProxy === '__new__' ? t('ui.proxy.addProxy') : t('ui.proxy.editProxy')}
      open={editingProxy !== null}
      onCancel={handleCancelEdit}
      onOk={handleSave}
      okText={t('ui.proxy.save')}
      cancelText={t('ui.proxy.cancel')}
      styles={{ body: isMobile ? { zoom: 0.6 } : {} }}
    >
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
        <label>ANTHROPIC_MODEL</label>
        <Input size="small" value={editForm.ANTHROPIC_MODEL} onChange={e => updateField('ANTHROPIC_MODEL', e.target.value)} placeholder="model_name" />
      </div>
      <div className={styles.proxyEditHint}>{t('ui.proxy.modelMapHint')}</div>
      {EXTENDED_MODEL_FIELDS.map(f => (
        <div className={styles.proxyEditRow} key={f}>
          <label>{f}</label>
          <Input size="small" value={editForm[f]} onChange={e => updateField(f, e.target.value)} placeholder="model_name" />
        </div>
      ))}
      <div className={styles.proxyEditRow}>
        <label>{t('ui.proxy.effort')}</label>
        <Select size="small" className={styles.fullWidthSelect} value={editForm.effort || ''} onChange={v => updateField('effort', v)} allowClear onClear={() => updateField('effort', '')}>
          <Select.Option value="">{t('ui.proxy.effortDefault')}</Select.Option>
          {EFFORT_OPTIONS.map(e => (
            <Select.Option key={e} value={e}>{`effort: ${e}`}</Select.Option>
          ))}
        </Select>
      </div>
    </Modal>
  );

  const deleteConfirmModal = (
    /* 受控 Modal,父关时通过 useEffect 联动关闭,避免孤儿态 */
    <Modal
      title={t('ui.proxy.deleteProxy')}
      open={deleteConfirmTarget !== null}
      onCancel={handleDeleteCancel}
      onOk={handleDeleteConfirm}
      okText={t('ui.common.confirmYes')}
      cancelText={t('ui.common.confirmCancel')}
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
        {editModal}
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
        styles={{ body: isMobile ? { zoom: 0.6 } : {}, mask: BLUR_MASK_STYLE }}
      >
        {bodyNode}
      </Modal>
      {editModal}
      {deleteConfirmModal}
    </>
  );
}
