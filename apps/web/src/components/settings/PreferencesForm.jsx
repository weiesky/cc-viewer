import React from 'react';
import { Switch, Select, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { t, LANG_OPTIONS } from '../../i18n';
import { PERM_AUTO_APPROVE_OPTIONS, PLAN_AUTO_APPROVE_OPTIONS, autoApproveSelectOptions } from '../../utils/autoApproveOptions';
import styles from './PreferencesForm.module.css';

// 纯展示偏好控件，作用于传入的 values（某个项目的 fork），改动经 onPatch(partial) 上抛。
// 复用偏好抽屉的同一批 i18n key 与 antd 控件，但刻意排除：
//   - displayScale / 原生缩放：设备级设置，编辑他人项目无意义且会误改本机窗口
//   - logDir / claudeConfigDir：机器级路径，不可按项目分叉
//   - 任何 _ 前缀元字段：仅 GET 回包，不属偏好
// soundEnabled 与主 UI 一致地把 voicePack.enabled 一并对齐（合并迁移规则）。
function Row({ label, help, children }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>
        {label}
        {help && (
          <Tooltip title={help}>
            <QuestionCircleOutlined className={styles.help} />
          </Tooltip>
        )}
      </span>
      {children}
    </div>
  );
}

export default function PreferencesForm({ values = {}, onPatch }) {
  const v = values || {};
  const am = (v.approvalModal && typeof v.approvalModal === 'object') ? v.approvalModal : {};
  const patch = (p) => onPatch && onPatch(p);

  return (
    <div className={styles.form}>
      <Row label={t('ui.permission.autoApprove.setting')} help={t('ui.permission.autoApprove.help')}>
        <Select
          size="small"
          value={v.autoApproveSeconds || 0}
          onChange={(value) => patch({ autoApproveSeconds: value })}
          options={autoApproveSelectOptions(PERM_AUTO_APPROVE_OPTIONS, t)}
          style={{ width: 110 }}
        />
      </Row>
      <Row label={t('ui.approval.settings.planAutoApprove')} help={t('ui.approval.settings.planAutoApproveHelp')}>
        <Select
          size="small"
          value={am.planAutoApproveSeconds || 0}
          onChange={(value) => patch({ approvalModal: { planAutoApproveSeconds: value } })}
          options={autoApproveSelectOptions(PLAN_AUTO_APPROVE_OPTIONS, t)}
          style={{ width: 110 }}
        />
      </Row>
      <Row label={t('ui.approval.settings.modalEnabled')} help={t('ui.approval.settings.modalEnabled.help')}>
        <Switch checked={am.modalEnabled !== false} onChange={(c) => patch({ approvalModal: { modalEnabled: c } })} />
      </Row>
      <Row label={t('ui.approval.settings.soundEnabled')} help={t('ui.approval.settings.soundEnabled.help')}>
        <Switch checked={!!am.soundEnabled} onChange={(c) => patch({ approvalModal: { soundEnabled: c, voicePack: { enabled: c } } })} />
      </Row>
      <Row label={t('ui.expandThinking')} help={t('ui.expandThinking.help')}>
        <Switch checked={!!v.expandThinking} onChange={(c) => patch({ expandThinking: c })} />
      </Row>
      <Row label={t('ui.showFullToolContent')} help={t('ui.showFullToolContent.help')}>
        <Switch checked={!!v.showFullToolContent} onChange={(c) => patch({ showFullToolContent: c })} />
      </Row>
      {v.showFullToolContent && (
        <Row label={t('ui.collapseToolResults')}>
          <Switch checked={v.collapseToolResults !== false} onChange={(c) => patch({ collapseToolResults: c })} />
        </Row>
      )}
      <Row label={t('ui.themeColor')}>
        <Select
          size="small"
          value={v.themeColor || 'light'}
          onChange={(value) => patch({ themeColor: value })}
          options={[
            { label: t('ui.themeColor.dark'), value: 'dark' },
            { label: t('ui.themeColor.light'), value: 'light' },
          ]}
          style={{ width: 140 }}
        />
      </Row>
      <Row label={t('ui.languageSettings')}>
        <Select
          size="small"
          value={v.lang || 'en'}
          onChange={(value) => patch({ lang: value })}
          options={LANG_OPTIONS.map(o => ({ label: o.label, value: o.value }))}
          style={{ width: 140 }}
        />
      </Row>
    </div>
  );
}
