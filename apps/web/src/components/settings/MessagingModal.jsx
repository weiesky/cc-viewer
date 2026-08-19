import React, { useState, useEffect } from 'react';
import { Modal } from 'antd';
import DialogueIcon from '../common/DialogueIcon';
import { imTr as _tr } from '../../utils/imTr';
import ImPlatformSettings from './ImPlatformSettings';
import { IM_PLATFORMS } from './imPlatforms';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import styles from './MessagingModal.module.css';

// IM tool tabs derived from the platform registry (imPlatforms.js); the tab strip renders
// automatically. Add a platform there and it appears here.
const TOOLS = IM_PLATFORMS.map((p) => ({
  id: p.id, labelKey: p.labelKey, fallback: p.fallback,
  Icon: p.icon, color: p.color,
  render: () => <ImPlatformSettings descriptor={p} />,
}));

/**
 * "Messaging" entry from the header menu. Lists available IM tools as a Chrome-style tab
 * strip on top and renders the selected tool's settings in the panel below. Extensible:
 * drop another entry into TOOLS. Tab design mirrors the UltraPlan expert tabs.
 */
export default function MessagingModal({ open, onClose, initialTool }) {
  const [selected, setSelected] = useState(initialTool || TOOLS[0].id);
  // When opened from a specific entry point (e.g. the header status chip), jump to that IM.
  useEffect(() => { if (open && initialTool) setSelected(initialTool); }, [open, initialTool]);
  const active = TOOLS.find((x) => x.id === selected) || TOOLS[0];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      destroyOnClose
      // Modal body 取 --bg-elevated,内部 toolBody 取 --bg-container,二者对比让
      // active tab "拉出贴合下方面板" 的 Chrome 标签观感在明暗主题都成立(对照 UltraPlan)。
      // header 同步取 --bg-elevated,否则 light 下标题栏(antd 默认 #FFF)会与 body(#F9F9F9)错色。
      styles={{ content: { background: 'var(--bg-elevated)' }, header: { background: 'var(--bg-elevated)' }, mask: BLUR_MASK_STYLE }}
      title={<span><DialogueIcon style={{ marginInlineEnd: 8 }} />{_tr('ui.messaging.title', null, 'Messaging Integrations')}</span>}
    >
      <div className={styles.tabRow}>
        {TOOLS.map((tool) => {
          const isActive = selected === tool.id;
          const Icon = tool.Icon;
          return (
            <button
              key={tool.id}
              type="button"
              className={`${styles.tabBtn}${isActive ? ` ${styles.tabBtnActive}` : ''}`}
              onClick={() => setSelected(tool.id)}
            >
              {/* Brand color on the active tab (icon + title kept in sync); grey when inactive. */}
              <Icon size={16} style={{ color: isActive ? tool.color : 'var(--text-tertiary, #999)' }} />
              <span style={isActive ? { color: tool.color } : undefined}>{_tr(tool.labelKey, null, tool.fallback)}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.toolBody}>
        {active.render()}
      </div>
    </Modal>
  );
}
