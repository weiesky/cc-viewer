import React, { useMemo } from 'react';
import { formatTokenCount, computeTokenStats, computeCacheRebuildStats, computeToolUsageStats, computeSkillUsageStats } from '../utils/helpers';
import { classifyRequest } from '../utils/requestType';
import ConceptHelp from './ConceptHelp';
import { t } from '../i18n';
import headerStyles from './AppHeader.module.css';
import styles from './MobileStats.module.css';

const REASON_KEYS = ['ttl', 'system_change', 'tools_change', 'model_change', 'msg_truncated', 'msg_modified', 'key_change'];
const I18N_MAP = {
  ttl: 'cacheLoss.ttl', system_change: 'cacheLoss.systemChange', tools_change: 'cacheLoss.toolsChange',
  model_change: 'cacheLoss.modelChange', msg_truncated: 'cacheLoss.msgTruncated', msg_modified: 'cacheLoss.msgModified', key_change: 'cacheLoss.keyChange',
};

export default function MobileStats({ requests = [], visible, onClose }) {
  const { byModel, models, toolStats, skillStats, cacheStats, activeReasons, totalCount, totalCache, hasCacheStats, subAgentEntries, hasSubAgentStats, teammateEntries, hasTeammateStats, isEmpty } = useMemo(() => {
    const byModel = computeTokenStats(requests);
    const models = Object.keys(byModel);
    const toolStats = computeToolUsageStats(requests);
    const skillStats = computeSkillUsageStats(requests);
    const cacheStats = computeCacheRebuildStats(requests);

    const activeReasons = REASON_KEYS.filter(k => cacheStats[k].count > 0);
    const totalCount = activeReasons.reduce((sum, k) => sum + cacheStats[k].count, 0);
    const totalCache = activeReasons.reduce((sum, k) => sum + cacheStats[k].cacheCreate, 0);
    const hasCacheStats = activeReasons.length > 0;

    const subAgentCounts = {};
    const teammateCounts = {};
    for (let i = 0; i < requests.length; i++) {
      const cls = classifyRequest(requests[i], requests[i + 1]);
      if (cls.type === 'SubAgent') {
        const label = cls.subType || 'Other';
        subAgentCounts[label] = (subAgentCounts[label] || 0) + 1;
      } else if (cls.type === 'Teammate') {
        const label = cls.subType || 'Teammate';
        teammateCounts[label] = (teammateCounts[label] || 0) + 1;
      }
    }
    const subAgentEntries = Object.entries(subAgentCounts).sort((a, b) => b[1] - a[1]);
    const hasSubAgentStats = subAgentEntries.length > 0;
    const teammateEntries = Object.entries(teammateCounts).sort((a, b) => b[1] - a[1]);
    const hasTeammateStats = teammateEntries.length > 0;

    const isEmpty = models.length === 0 && toolStats.length === 0 && !hasCacheStats && !hasSubAgentStats && !hasTeammateStats && skillStats.length === 0;

    return { byModel, models, toolStats, skillStats, cacheStats, activeReasons, totalCount, totalCache, hasCacheStats, subAgentEntries, hasSubAgentStats, teammateEntries, hasTeammateStats, isEmpty };
  }, [requests]);

  if (!visible) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('ui.tokenStats')}</span>
        <button className={styles.closeBtn} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className={styles.content}>
        {isEmpty ? (
          <div className={styles.empty}>—</div>
        ) : (
          <>
            {/* 1. Skill Usage Stats */}
            {skillStats.length > 0 && (
              <div className={headerStyles.modelCard}>
                <div className={headerStyles.modelName}>{t('ui.skillUsageStats')}</div>
                <table className={headerStyles.statsTable}>
                  <thead>
                    <tr>
                      <td className={`${headerStyles.th} ${styles.thLeft}`}>Skill</td>
                      <td className={headerStyles.th}>{t('ui.cacheRebuild.count')}</td>
                    </tr>
                  </thead>
                  <tbody>
                    {skillStats.map(([name, count]) => (
                      <tr key={name} className={headerStyles.rowBorder}>
                        <td className={headerStyles.label}>{name}</td>
                        <td className={headerStyles.td}>{count}</td>
                      </tr>
                    ))}
                    {skillStats.length > 1 && (
                      <tr className={headerStyles.rebuildTotalRow}>
                        <td className={headerStyles.label}>Total</td>
                        <td className={headerStyles.td}>{skillStats.reduce((s, e) => s + e[1], 0)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 2. SubAgent Stats */}
            {hasSubAgentStats && (
              <div className={headerStyles.modelCard}>
                <div className={headerStyles.modelName}>{t('ui.subAgentStats')}</div>
                <table className={headerStyles.statsTable}>
                  <thead>
                    <tr>
                      <td className={`${headerStyles.th} ${styles.thLeft}`}>SubAgent</td>
                      <td className={headerStyles.th}>{t('ui.cacheRebuild.count')}</td>
                    </tr>
                  </thead>
                  <tbody>
                    {subAgentEntries.map(([name, count]) => (
                      <tr key={name} className={headerStyles.rowBorder}>
                        <td className={headerStyles.label}>{name} <ConceptHelp doc={`SubAgent-${name}`} /></td>
                        <td className={headerStyles.td}>{count}</td>
                      </tr>
                    ))}
                    {subAgentEntries.length > 1 && (
                      <tr className={headerStyles.rebuildTotalRow}>
                        <td className={headerStyles.label}>Total</td>
                        <td className={headerStyles.td}>{subAgentEntries.reduce((s, e) => s + e[1], 0)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 2.5 Teammate Stats */}
            {hasTeammateStats && (
              <div className={headerStyles.modelCard}>
                <div className={headerStyles.modelName}>Teammate</div>
                <table className={headerStyles.statsTable}>
                  <thead>
                    <tr>
                      <td className={`${headerStyles.th} ${styles.thLeft}`}>Name</td>
                      <td className={headerStyles.th}>{t('ui.cacheRebuild.count')}</td>
                    </tr>
                  </thead>
                  <tbody>
                    {teammateEntries.map(([name, count]) => (
                      <tr key={name} className={headerStyles.rowBorder}>
                        <td className={headerStyles.label}>{name}</td>
                        <td className={headerStyles.td}>{count}</td>
                      </tr>
                    ))}
                    {teammateEntries.length > 1 && (
                      <tr className={headerStyles.rebuildTotalRow}>
                        <td className={headerStyles.label}>Total</td>
                        <td className={headerStyles.td}>{teammateEntries.reduce((s, e) => s + e[1], 0)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 3. Tool Usage Stats */}
            {toolStats.length > 0 && (
              <div className={headerStyles.modelCard}>
                <div className={headerStyles.modelName}>{t('ui.toolUsageStats')}</div>
                <table className={headerStyles.statsTable}>
                  <thead>
                    <tr>
                      <td className={`${headerStyles.th} ${styles.thLeft}`}>Tool</td>
                      <td className={headerStyles.th}>{t('ui.cacheRebuild.count')}</td>
                    </tr>
                  </thead>
                  <tbody>
                    {toolStats.map(([name, count]) => (
                      <tr key={name} className={headerStyles.rowBorder}>
                        <td className={headerStyles.label}>{name} <ConceptHelp doc={`Tool-${name}`} /></td>
                        <td className={headerStyles.td}>{count}</td>
                      </tr>
                    ))}
                    {toolStats.length > 1 && (
                      <tr className={headerStyles.rebuildTotalRow}>
                        <td className={headerStyles.label}>Total</td>
                        <td className={headerStyles.td}>{toolStats.reduce((s, e) => s + e[1], 0)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 4. MainAgent Cache Rebuild Stats */}
            {hasCacheStats && (
              <div className={headerStyles.modelCard}>
                <div className={headerStyles.modelName}>MainAgent<ConceptHelp doc="MainAgent" /> {t('ui.cacheRebuildStats')}<ConceptHelp doc="CacheRebuild" /></div>
                <table className={`${headerStyles.statsTable} ${styles.fixedTable}`}>
                  <colgroup>
                    <col className={styles.colWide} />
                    <col className={styles.colNarrow} />
                    <col className={styles.colNarrow} />
                  </colgroup>
                  <thead>
                    <tr>
                      <td className={`${headerStyles.th} ${styles.thLeft}`}>{t('ui.cacheRebuild.reason')}</td>
                      <td className={headerStyles.th}>{t('ui.cacheRebuild.count')}</td>
                      <td className={headerStyles.th}>{t('ui.cacheRebuild.cacheCreate')}</td>
                    </tr>
                  </thead>
                  <tbody>
                    {activeReasons.map(k => (
                      <tr key={k} className={headerStyles.rowBorder}>
                        <td className={`${headerStyles.label} ${styles.ellipsisCell}`} title={t(`ui.${I18N_MAP[k]}`)}>{t(`ui.${I18N_MAP[k]}`)}</td>
                        <td className={headerStyles.td}>{cacheStats[k].count}</td>
                        <td className={headerStyles.td}>{formatTokenCount(cacheStats[k].cacheCreate)}</td>
                      </tr>
                    ))}
                    {activeReasons.length > 1 && (
                      <tr className={headerStyles.rebuildTotalRow}>
                        <td className={headerStyles.label}>Total</td>
                        <td className={headerStyles.td}>{totalCount}</td>
                        <td className={headerStyles.td}>{formatTokenCount(totalCache)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 5. Token/Cache Stats per Model */}
            {models.map((model) => {
              const s = byModel[model];
              const totalInput = s.input + s.cacheCreation + s.cacheRead;
              const cacheHitRate = totalInput > 0 ? ((s.cacheRead / totalInput) * 100).toFixed(1) : '0.0';
              return (
                <div key={model} className={headerStyles.modelCard}>
                  <div className={headerStyles.modelName}>{model}</div>
                  <table className={headerStyles.statsTable}>
                    <tbody>
                      <tr>
                        <td className={headerStyles.label}>Token</td>
                        <td className={headerStyles.th}>input</td>
                        <td className={headerStyles.th}>output</td>
                      </tr>
                      <tr className={headerStyles.rowBorder}>
                        <td className={headerStyles.label}></td>
                        <td className={headerStyles.td}>{formatTokenCount(totalInput)}</td>
                        <td className={headerStyles.td}>{formatTokenCount(s.output)}</td>
                      </tr>
                      <tr>
                        <td className={headerStyles.label}>Cache</td>
                        <td className={headerStyles.th}>create</td>
                        <td className={headerStyles.th}>read</td>
                      </tr>
                      <tr className={headerStyles.rowBorder}>
                        <td className={headerStyles.label}></td>
                        <td className={headerStyles.td}>{formatTokenCount(s.cacheCreation)}</td>
                        <td className={headerStyles.td}>{formatTokenCount(s.cacheRead)}</td>
                      </tr>
                      <tr>
                        <td className={headerStyles.label}>{t('ui.hitRate')}</td>
                        <td colSpan={2} className={headerStyles.td}>{cacheHitRate}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
