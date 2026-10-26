import React, { memo, useCallback, useMemo } from 'react';
import { Popover, Tag } from 'antd';
import { t } from '../../i18n';
import CachePopoverContent from './CachePopoverContent';
import { useSdkContextUsage } from './SdkContextUsageProvider';
import { mergeSdkContextBar } from '../../utils/contextUsageView';
import { contextSeverityColor } from '../../utils/formatters';
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
  const sdk = useSdkContextUsage();
  const merged = mergeSdkContextBar({ sdk, fallbackPercent: contextPercent, fallbackTokens: contextTokens });
  const effectiveColor = merged.sdkActive ? contextSeverityColor(merged.percent) : ctxColor;
  const triggerStyle = useMemo(() => ({
    '--ctx-color': effectiveColor,
    '--ctx-percent': `${merged.percent}%`,
  }), [effectiveColor, merged.percent]);
  const onTriggerKeyDown = useCallback((event) => {
    if (event.key === 'Escape') { onOpenChange(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenChange(!cachePopoverOpen);
    }
  }, [cachePopoverOpen, onOpenChange]);

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
      <span
        className={styles.liveTag}
        style={triggerStyle}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={cachePopoverOpen}
        aria-label={`${t('ui.contextUsage.title')}: ${merged.tokens > 0 ? `${merged.tokens} ` : ''}${merged.percent}%`}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.liveTagFill} />
        <span className={styles.liveTagContent}>
          <span className={styles.liveTagText}>
            {merged.tokens > 0
              ? `${(merged.tokens / 1000).toFixed(1)}K (${merged.percent}%)`
              : `${merged.percent}%`}
          </span>
        </span>
      </span>
    </Popover>
  );
}

export default memo(LiveTagPopover);
