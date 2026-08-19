import React, { useState, useEffect } from 'react';
import { Modal, Button, Spin, Empty, message } from 'antd';
import { t, getLang } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { resolveLocalized } from '../../utils/resolveLocalized';
import styles from './PresetExpertPickerModal.module.css';

// ultraplan「载入模版」选择弹窗:左列表 + 右只读预览 + 载入按钮。
// 数据来自 GET /api/ultra-agents(扫包内置 ultraAgents/*.json)。title / description 在 JSON 协议层
// 内联本地化(纯字符串或 {lang: str} 对象),前端按 getLang() 用 resolveLocalized 解析、区域回退;
// content 是单语言字符串(无 i18n),原样使用。选中后点「载入」,把 { title:已解析串, content }
// 抛给父级(编辑器)覆盖填入。
// zIndex 1300:盖在自定义专家编辑弹窗(1200)之上;父弹窗 destroyOnClose 卸载时本组件随之卸载。
export default function PresetExpertPickerModal({ open, onLoad, onClose }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const lang = getLang();

  // 每次打开拉取列表(预设随包静态,失败给 toast)。cancelled 标志与 CustomUltraplanEditModal
  // 同款:避免请求未回时弹窗已关/卸载导致 setState on unmounted。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/ultra-agents'));
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        const list = Array.isArray(data?.agents) ? data.agents : [];
        setAgents(list);
        if (list.length) setSelectedId(list[0].id);
      } catch (_) {
        if (!cancelled) {
          setAgents([]);
          message.error(t('ui.ultraplan.presetLoadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const selected = agents.find(a => a.id === selectedId) || null;
  // content 是单语言字符串,直接用;resolveLocalized 仅作用于 title / description。
  const previewText = selected ? (selected.content || '') : '';

  const handleLoad = () => {
    if (!selected) return;
    onLoad({
      // 标题截断到 30,匹配编辑器输入框 maxLength,避免存入比 UI 允许更长的标题。
      title: resolveLocalized(selected.title, lang).slice(0, 30),
      content: selected.content || '',
    });
  };

  const footer = (
    <div className={styles.footer}>
      <Button onClick={onClose}>{t('ui.ultraplan.customCancel')}</Button>
      <Button type="primary" disabled={!selected} onClick={handleLoad}>
        {t('ui.ultraplan.presetLoad')}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t('ui.ultraplan.presetPickerTitle')}
      open={open}
      onCancel={onClose}
      footer={footer}
      width="min(900px, calc(100vw - 80px))"
      zIndex={1300}
      destroyOnHidden
      styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
    >
      {loading ? (
        <div className={styles.loading}><Spin /></div>
      ) : agents.length === 0 ? (
        <div className={styles.loading}>
          <Empty description={t('ui.ultraplan.presetEmpty')} />
        </div>
      ) : (
        <div className={styles.split}>
          <div className={styles.list}>
            {agents.map(a => {
              const title = resolveLocalized(a.title, lang);
              const desc = resolveLocalized(a.description, lang);
              return (
                <div
                  key={a.id}
                  className={`${styles.item} ${a.id === selectedId ? styles.itemActive : ''}`}
                  onClick={() => setSelectedId(a.id)}
                >
                  <div className={styles.itemTitle}>{title}</div>
                  {desc && <div className={styles.itemDesc}>{desc}</div>}
                </div>
              );
            })}
          </div>
          <div className={styles.previewPane}>
            <textarea
              className={styles.preview}
              value={previewText}
              readOnly
              placeholder={t('ui.ultraplan.presetPreviewPlaceholder')}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
