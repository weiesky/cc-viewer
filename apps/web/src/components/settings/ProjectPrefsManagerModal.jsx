import React from 'react';
import { Modal, Collapse, Spin, Tag, Empty } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { isMobile } from '../../env';
import ConfirmRemoveButton from '../common/ConfirmRemoveButton';
import PreferencesForm from './PreferencesForm';
import styles from './ProjectPrefsManagerModal.module.css';

// 本机(127.0.0.1)管理入口：列出所有「项目独立配置」fork，可逐项编辑（复用 PreferencesForm 控件）与删除。
// 纯组件 + 自取数据：open 时拉 /api/project-prefs；编辑 POST /update {project,patch}；删除 POST /delete {project}。
// 删完最后一项后调 onChanged（父级 refreshAllPrefs，让"配置管理"入口随 _projectPrefsKeys 清空而隐藏）并关闭。
export default class ProjectPrefsManagerModal extends React.Component {
  state = { loading: false, projects: {}, error: null };

  componentDidUpdate(prevProps) {
    if (this.props.open && !prevProps.open) this._load();
  }

  _load = () => {
    this.setState({ loading: true, error: null });
    fetch(apiUrl('/api/project-prefs'))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then(data => this.setState({ loading: false, projects: data.projects || {} }))
      .catch(() => this.setState({ loading: false, error: 'load' }));
  };

  // 乐观更新本地视图（顶层浅 merge；approvalModal 子树浅合并，与服务端 applyPrefsPatch 口径一致）。
  _patch = (dir, partial) => {
    this.setState(prev => {
      const cur = prev.projects[dir] || { prefs: {} };
      const prefs = { ...cur.prefs, ...partial };
      if (partial.approvalModal) {
        const curAM = cur.prefs.approvalModal || {};
        prefs.approvalModal = { ...curAM, ...partial.approvalModal };
        // voicePack 深合并：否则切 soundEnabled 时本地乐观视图会把 events/volume 截断（服务端有深合并，
        // 重开弹窗即恢复，但乐观视图也应一致）。
        if (partial.approvalModal.voicePack) {
          prefs.approvalModal.voicePack = { ...(curAM.voicePack || {}), ...partial.approvalModal.voicePack };
        }
      }
      return { projects: { ...prev.projects, [dir]: { ...cur, prefs } } };
    });
    fetch(apiUrl('/api/project-prefs/update'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: dir, patch: partial }),
    }).then(r => { if (!r.ok) this._load(); }).catch(() => this._load()); // 失败回滚乐观视图，重拉服务端真值
  };

  _delete = (dir) => {
    fetch(apiUrl('/api/project-prefs/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: dir }),
    }).then(r => {
      if (!r.ok) { this._load(); return; } // 服务端拒绝(403/500)时不要乐观删行/关窗，重拉校准
      this.setState(prev => {
        const next = { ...prev.projects };
        delete next[dir];
        return { projects: next };
      }, () => {
        this.props.onChanged && this.props.onChanged();
        if (Object.keys(this.state.projects).length === 0) this.props.onClose && this.props.onClose();
      });
    }).catch(() => this._load());
  };

  render() {
    const { open, onClose } = this.props;
    const { loading, projects, error } = this.state;
    const entries = Object.entries(projects);
    const items = entries.map(([dir, info]) => ({
      key: dir,
      label: (
        <div className={styles.panelHeader}>
          <span className={styles.projName}>{info.name || dir}</span>
          {info.isCurrent && <Tag color="blue">{t('ui.projectPrefsManage.currentTag')}</Tag>}
          <span className={styles.projPath}>{info.dir || dir}</span>
        </div>
      ),
      extra: (
        <span onClick={(e) => e.stopPropagation()}>
          <ConfirmRemoveButton
            title={t('ui.projectPrefsManage.deleteConfirm', { name: info.name || dir })}
            ariaLabel={t('ui.projectPrefsManage.delete')}
            onConfirm={() => this._delete(dir)}
            className={styles.delBtn}
          >
            <DeleteOutlined />
          </ConfirmRemoveButton>
        </span>
      ),
      children: <PreferencesForm values={info.prefs} onPatch={(p) => this._patch(dir, p)} />,
    }));

    return (
      <Modal
        title={t('ui.projectPrefsManage.title')}
        open={open}
        onCancel={onClose}
        footer={null}
        width={isMobile ? 'calc(100vw - 8px)' : 'min(720px, calc(100vw - 80px))'}
        zIndex={1100}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '12px 16px', ...(isMobile ? { zoom: 0.6 } : {}) } }}
      >
        {loading ? (
          <div className={styles.center}><Spin /></div>
        ) : error ? (
          <div className={styles.center}>{t('ui.projectPrefsManage.empty')}</div>
        ) : entries.length === 0 ? (
          <Empty description={t('ui.projectPrefsManage.empty')} />
        ) : (
          <>
            <div className={styles.count}>{t('ui.projectPrefsManage.count', { count: entries.length })}</div>
            <Collapse items={items} defaultActiveKey={entries.length === 1 ? [entries[0][0]] : []} />
          </>
        )}
      </Modal>
    );
  }
}
