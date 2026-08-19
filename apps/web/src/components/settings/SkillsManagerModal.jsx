import React from 'react';
import { Modal, Switch, Spin, Tooltip } from 'antd';
import { DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { isMobile } from '../../env';
import { skillKey, skillOrderKey } from '../../utils/skillsParser';
import ConfirmRemoveButton from '../common/ConfirmRemoveButton';
import styles from './SkillsManagerModal.module.css';
import headerStyles from '../common/sharedChrome.module.css';

// 纯展示 Modal：状态与 toggle 处理在父级（AppHeader / Mobile）。
// 抽出动机：AppHeader / Mobile 都要在 cache popover 抽屉里挂"管理"入口，
// 渲染 ~80 行 JSX 不值得复制；toggle/open 状态管理依旧由父级保留（与既有 reloadFsSkills 重复模式一致）。
//
// Props 契约：
//  - open / onClose：Modal 显隐控制
//  - loading / error / skills / toggling：父级 _skillsModal 切片直接透传
//  - onToggle(skill)：用户点 Switch 时触发；父级负责乐观 + 回滚 + reloadFsSkills
// 错误文案映射逻辑内置（reason→可读文本），不再要求父级实现 errorLabelFor。

// 把 reloadFsSkills 的 reason code 映射成可读文案（与之前父级 getSkillsLoadErrorLabel 同实现）。
function reasonToLabel(reason) {
  if (!reason || reason === 'stale' || reason === 'local_log') return '';
  const mHttp = /^http:(\d+)$/.exec(reason);
  if (mHttp) return t('ui.skillsLoadError.http', { status: mHttp[1] });
  if (reason === 'network') return t('ui.skillsLoadError.network');
  return reason;
}

export default function SkillsManagerModal({
  open = false,
  onClose,
  loading = false,
  error = null,
  skills = [],
  toggling,
  onToggle,
  onDelete,
}) {
  const togglingSet = toggling instanceof Set ? toggling : new Set();
  const userOrProject = skills.filter(s => s.source === 'user' || s.source === 'project');
  const pluginSkills = skills.filter(s => s.source === 'plugin');
  const builtinSkills = skills.filter(s => s.source === 'builtin');

  return (
    <Modal
      title={t('ui.skillManagerTitle')}
      open={open}
      onCancel={onClose}
      footer={null}
      // 移动端贴边（两侧各 4px），PC 维持 1200/80 cap；移动端 body zoom: 0.6 与抽屉同步避免文字偏大
      width={isMobile ? 'calc(100vw - 8px)' : 'min(1200px, calc(100vw - 80px))'}
      zIndex={1100}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 20px', ...(isMobile ? { zoom: 0.6 } : {}) } }}
    >
      {loading ? (
        <div className={styles.skillsEmpty}><Spin /></div>
      ) : error ? (
        <div className={styles.skillsEmpty}>{t('ui.skillsLoadFailed', { reason: reasonToLabel(error) || error })}</div>
      ) : skills.length === 0 ? (
        <div className={styles.skillsEmpty}>{t('ui.noSkillsLoaded')}</div>
      ) : (
        <>
          {/* 只把 user / project（可切换）放 card 列表；plugin + builtin 折叠到底部 chip 行 */}
          {userOrProject.length > 0 && (
            <div className={styles.skillsList}>
              {userOrProject.map((s) => {
                // skillKey 含 path：togglingSet 查找用——同名重复两份 path 不同，点一个不会两个一起转圈。
                const key = skillKey(s);
                const isToggling = togglingSet.has(key);
                // React 渲染 key 用 toggle 稳定的 skillOrderKey（开关后整卡片不 remount/不闪烁，配合 orderMap 原地保位）。
                // 仅「重复态」两行会撞同名 → enabled 后缀消歧（重复行开关被服务端 DUPLICATE 挡住、状态不变，后缀稳定）。
                const rowKey = s.duplicate ? `${skillOrderKey(s)}::${s.enabled ? 'on' : 'off'}` : skillOrderKey(s);
                return (
                  <div key={rowKey} className={`${styles.skillCard} ${!s.enabled ? styles.skillCardDisabled : ''}`}>
                    <div className={styles.skillCardHeader}>
                      <div className={styles.skillCardTitleRow}>
                        <span className={`${styles.skillSourceBadge} ${styles['skillSource_' + s.source]}`}>
                          {t('ui.skillSource.' + s.source)}
                        </span>
                        <div className={styles.skillCardName}>{s.name}</div>
                        {s.duplicate && (
                          <Tooltip title={t('ui.skillDuplicateBadge')}>
                            <span className={styles.skillDuplicateBadge}>⚠</span>
                          </Tooltip>
                        )}
                      </div>
                      <div className={styles.skillCardActions}>
                        <Switch size="small" checked={s.enabled} loading={isToggling} onChange={() => onToggle && onToggle(s)} />
                        {onDelete && (
                          <ConfirmRemoveButton
                            title={t('ui.skillDeleteConfirm', { name: s.name })}
                            ariaLabel={t('ui.skillDeleteConfirm', { name: s.name })}
                            onConfirm={() => onDelete(s)}
                            className={styles.skillDeleteBtn}
                            disabled={isToggling}
                          >
                            {isToggling ? <LoadingOutlined /> : <DeleteOutlined />}
                          </ConfirmRemoveButton>
                        )}
                      </div>
                    </div>
                    {s.description && <div className={styles.skillCardDesc}>{s.description}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {/* Plugin：不可单独禁用（要走 `claude plugin disable <name>` CLI），折叠成 chip 行；每 chip tooltip 带 plugin 名 */}
          {pluginSkills.length > 0 && (
            <div className={styles.skillsReadonlySection}>
              <div className={styles.skillsReadonlyLabel}>{t('ui.skillsPluginLabel')}</div>
              <div className={headerStyles.toolChipGrid}>
                {pluginSkills.map((s, i) => {
                  // pluginName 现在返 "name@marketplace"（pluginKey），tooltip 显示时剥后缀
                  const pluginDisplay = (s.pluginName || '').split('@')[0];
                  return (
                    <Tooltip key={`plugin-${s.name}-${i}`} title={t('ui.skillCannotDisablePlugin', { plugin: pluginDisplay })}>
                      <span className={headerStyles.cacheToolChip}>{s.name}</span>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}
          {/* Builtin：同样折叠为 chip 行，tooltip 解释"硬编码无法禁用" */}
          {builtinSkills.length > 0 && (
            <div className={styles.skillsReadonlySection}>
              <div className={styles.skillsReadonlyLabel}>{t('ui.skillsBuiltinLabel')}</div>
              <div className={headerStyles.toolChipGrid}>
                {builtinSkills.map(s => (
                  <Tooltip key={s.name} title={t('ui.skillCannotDisableBuiltin')}>
                    <span className={headerStyles.cacheToolChip}>{s.name}</span>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
