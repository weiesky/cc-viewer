import React, { memo, useMemo } from 'react';
import { Popover, Tag } from 'antd';
import { t } from '../../i18n';
import CachePopoverContent from './CachePopoverContent';
import styles from './LiveTagPopover.module.css';

// 静态 overlayInnerStyle 提到模块顶层 const,避免每次 render 创建新字面量。
const POPOVER_OVERLAY_STYLE = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-hover)',
  borderRadius: 8,
  padding: '8px 8px',
};

function LiveTagPopover({
  isLocalLog,
  localLogFile,
  cachePopoverOpen,
  onOpenChange,
  requests,
  serverCachedContent,
  contextPercent,
  contextTokens,
  ctxColor,
  onSkillImported,
  fsSkills,
  memory,
  memoryRefreshing,
  claudeMd,
  calibrationModel,
  onCalibrationModelChange,
  onOpenMemoryDetail,
  onOpenClaudeMd,
  onOpenSkillsModal,
  onRefreshMemory,
  onToolsCatalogOpenChange,
  projectName,
}) {
  // 用 CSS 变量替代 inline style 字面量,稳定 ctxColor / contextPercent 时 triggerStyle 引用不变。
  const triggerStyle = useMemo(() => ({
    '--ctx-color': ctxColor,
    '--ctx-percent': `${contextPercent}%`,
  }), [ctxColor, contextPercent]);

  if (isLocalLog) {
    return (
      <Tag className={`${styles.liveTag} ${styles.liveTagHistory}`}>
        <span className={styles.liveTagText}>{t('ui.historyLog', { file: localLogFile })}</span>
      </Tag>
    );
  }

  return (
    <Popover
      content={cachePopoverOpen ? (
        <CachePopoverContent
          requests={requests}
          serverCachedContent={serverCachedContent}
          contextPercent={contextPercent}
          contextTokens={contextTokens}
          fsSkills={fsSkills}
          memory={memory}
          memoryRefreshing={memoryRefreshing}
          claudeMd={claudeMd}
          calibrationModel={calibrationModel}
          onCalibrationModelChange={onCalibrationModelChange}
          onOpenMemoryDetail={onOpenMemoryDetail}
          onOpenClaudeMd={onOpenClaudeMd}
          onOpenSkillsModal={onOpenSkillsModal}
          onSkillImported={onSkillImported}
          onRefreshMemory={onRefreshMemory}
          onToolsCatalogOpenChange={onToolsCatalogOpenChange}
        />
      ) : <div className={styles.cachePopoverPlaceholder} />}
      trigger="hover"
      placement="topRight"
      overlayInnerStyle={POPOVER_OVERLAY_STYLE}
      open={cachePopoverOpen}
      onOpenChange={onOpenChange}
    >
      <span className={styles.liveTag} style={triggerStyle}>
        <span className={styles.liveTagFill} />
        <span className={styles.liveTagContent}>
          <span className={styles.liveTagText}>
            {contextTokens > 0
              ? `${(contextTokens / 1000).toFixed(1)}K (${contextPercent}%)`
              : `${contextPercent}%`}
          </span>
        </span>
      </span>
    </Popover>
  );
}

export default memo(LiveTagPopover);
