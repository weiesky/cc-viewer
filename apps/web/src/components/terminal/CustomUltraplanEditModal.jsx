import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Popconfirm, Spin, message } from 'antd';
import { t, getLang } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { renderMarkdown } from '../../utils/markdown';
import PresetExpertPickerModal from './PresetExpertPickerModal';
import styles from './CustomUltraplanEditModal.module.css';

export default function CustomUltraplanEditModal({ open, initial, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [docHtml, setDocHtml] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  // 折叠左栏(参考文档),让右栏编辑区独占全宽;跨弹窗持久化。
  // try/catch 与 TerminalPanel/AppBase 的 localStorage 读写一致:Safari 隐私模式 / 配额超限会抛
  // SecurityError|QuotaExceededError;不裹会让 useState initializer 抛错直接挂掉整个弹窗渲染。
  const [docCollapsed, setDocCollapsed] = useState(() => {
    try { return localStorage.getItem('cc-viewer-custom-expert-doc-collapsed') === 'true'; }
    catch { return false; }
  });
  const docRef = useRef(null);
  // 「载入模版」弹窗开关。
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initial?.title || '');
      // 新建时预填示例模板供"抄作业并优化";编辑已有专家(有 id)保留其原内容。
      setContent(initial?.id ? (initial.content || '') : t('ui.ultraplan.customContentTemplate'));
    }
  }, [open, initial]);

  // 折叠状态持久化。与 TerminalPanel.jsx / AppBase.jsx 的 localStorage 写入约定一致,裹 try/catch:
  // Safari 隐私模式 / 配额超限会让 setItem 抛错,不裹的话会冒到 React commit 作未捕获错误。
  useEffect(() => {
    try { localStorage.setItem('cc-viewer-custom-expert-doc-collapsed', String(docCollapsed)); }
    catch { /* localStorage 不可用时降级到内存状态即可 */ }
  }, [docCollapsed]);

  // 左栏:用与 ConceptHelp 相同的 /api/concept 请求(此处内联),把使用说明文档常驻显示供"抄作业"。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDocHtml('');
    setDocLoading(true);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/concept?lang=${getLang()}&doc=CustomUltraplanExpert`));
        const md = res.ok ? await res.text() : '';
        if (!cancelled) setDocHtml(md ? renderMarkdown(md) : '');
      } catch (_) {
        if (!cancelled) setDocHtml('');
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // 依赖 getLang():弹窗开着时切换语言需重新拉对应语种文档(切语言不刷新页面)。
  }, [open, getLang()]);

  // 文档渲染后,给每个代码块右上角加"复制"按钮(包一层相对定位容器避免随横向滚动跑掉)。
  useEffect(() => {
    // 折叠改用 CSS 过渡(docPanel 不再卸载),按钮一次注入长期复用;
    // 折叠态下 docPanel 整体 opacity:0 + flex-basis:0 + pointer-events:none,按钮不可见也不可点。
    const root = docRef.current;
    if (!root || !docHtml) return;
    const cleanups = [];
    root.querySelectorAll('pre').forEach((pre) => {
      // mermaid 代码块会被全局 observer 异步 replaceWith 成图,跳过以免复制按钮被孤立。
      if (pre.querySelector('code.language-mermaid')) return;
      if (pre.dataset.copyAttached) return;
      pre.dataset.copyAttached = '1';

      const wrap = document.createElement('div');
      wrap.className = styles.codeWrap;
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = styles.copyBtn;
      btn.textContent = t('ui.copy');
      const onClick = () => {
        const code = pre.querySelector('code');
        const text = (code ? code.textContent : pre.textContent) || '';
        // navigator.clipboard 在非安全上下文(局域网明文 HTTP)为 undefined——此时用 ?.
        // 会让后续 .then 抛未捕获 TypeError(.catch 挂不上),故先判存在再调用。
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(text)
          .then(() => { message.success(t('ui.copySuccess')); })
          .catch(() => {});
      };
      btn.addEventListener('click', onClick);
      wrap.appendChild(btn);
      cleanups.push(() => btn.removeEventListener('click', onClick));
    });
    // 注入的 wrap/button DOM 由 React 在重渲染(docHtml 变化)或卸载(destroyOnClose)时随
    // dangerouslySetInnerHTML 子树整体替换掉,这里只需解绑监听器避免悬挂引用。
    return () => cleanups.forEach((fn) => fn());
  }, [docHtml]);

  const canSave = title.trim().length > 0 && content.trim().length > 0;
  const isEdit = !!initial?.id;

  const handleSave = () => {
    if (!canSave) return;
    const id = isEdit ? initial.id : `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onSave({ id, title: title.trim(), content: content.trim() });
  };

  const handleDelete = () => {
    if (!isEdit) return;
    onDelete(initial.id);
  };

  // 从预设专家弹窗「载入」:覆盖名称+内容。仅当编辑器处于「全新且未改动」(标题空 + 内容仍是
  // 预填样板壳)时直接覆盖;否则(已编辑既有专家 / 已手输内容)先弹确认,防止误删用户成果。
  const handlePresetLoad = ({ title: presetTitle, content: presetContent }) => {
    const apply = () => {
      setTitle(presetTitle);
      setContent(presetContent);
      setPresetPickerOpen(false);
    };
    const pristine = title.trim() === ''
      && content.trim() === t('ui.ultraplan.customContentTemplate').trim();
    if (pristine) { apply(); return; }
    Modal.confirm({
      title: t('ui.ultraplan.presetOverwriteConfirm'),
      okText: t('ui.ultraplan.presetLoad'),
      cancelText: t('ui.ultraplan.customCancel'),
      zIndex: 1400, // 高于预设弹窗(1300)与编辑器(1200)
      onOk: apply,
    });
  };

  const footer = (
    <div className={styles.footer}>
      <div className={styles.footerLeft}>
        {isEdit && (
          <Popconfirm
            title={t('ui.ultraplan.customDeleteConfirm')}
            okText={t('ui.ultraplan.customDelete')}
            cancelText={t('ui.ultraplan.customCancel')}
            onConfirm={handleDelete}
          >
            <Button danger>{t('ui.ultraplan.customDelete')}</Button>
          </Popconfirm>
        )}
      </div>
      <div className={styles.footerRight}>
        <Button onClick={onClose}>{t('ui.ultraplan.customCancel')}</Button>
        <Button type="primary" disabled={!canSave} onClick={handleSave}>
          {isEdit ? t('ui.ultraplan.customSave') : t('ui.ultraplan.customCreate')}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      title={isEdit ? t('ui.ultraplan.customEditTitle') : t('ui.ultraplan.customCreateTitle')}
      open={open}
      onCancel={onClose}
      footer={footer}
      width="min(1100px, calc(100vw - 80px))"
      zIndex={1200}
      destroyOnClose
      styles={{ content: { background: 'var(--bg-elevated)', border: '1px solid var(--border-light)' }, header: { background: 'var(--bg-elevated)', borderBottom: 'none' } }}
    >
      <div className={styles.split}>
        {/* 始终挂载,折叠/展开靠 CSS 过渡:flex-basis 50%↔0 + padding/border 渐变 + opacity 淡入淡出,
            把手凭 margin-left:-20px 始终贴在 docPanel 右边界上,会随之平滑滑入/滑出。 */}
        <div
          className={`chat-md ${styles.docPanel} ${docCollapsed ? styles.docCollapsed : ''}`}
          ref={docRef}
          aria-hidden={docCollapsed}
        >
          {docLoading
            ? <div className={styles.docLoading}><Spin /></div>
            : <div dangerouslySetInnerHTML={{ __html: docHtml }} />}
        </div>
        {/* 折叠把手:借鉴 ChatView 的 .terminalToggle。Terminal 在右、本面板在左,chevron 方向相对反转:
            展开时 `<`(点击向左收回),折叠时 `>`(点击向右拉出),与图二参考一致。 */}
        <div
          className={styles.docToggle}
          onClick={() => setDocCollapsed(v => !v)}
          title={docCollapsed ? t('ui.ultraplan.expandDoc') : t('ui.ultraplan.collapseDoc')}
        >
          <svg viewBox="0 0 8 24" width="8" height="24">
            {docCollapsed
              ? <path d="M4 8 L7 12 L4 16" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              : <path d="M4 8 L1 12 L4 16" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            }
          </svg>
        </div>
        <div className={styles.editPanel}>
          <div className={styles.field}>
            <input
              className={styles.titleInput}
              placeholder={t('ui.ultraplan.customTitlePlaceholder')}
              value={title}
              maxLength={30}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
            <Button className={styles.presetBtn} onClick={() => setPresetPickerOpen(true)}>
              {t('ui.ultraplan.presetAdd')}
            </Button>
          </div>
          <div className={styles.fieldGrow}>
            <textarea
              className={styles.contentTextarea}
              placeholder={t('ui.ultraplan.customContentPlaceholder')}
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          </div>
        </div>
      </div>
      <PresetExpertPickerModal
        open={presetPickerOpen}
        onLoad={handlePresetLoad}
        onClose={() => setPresetPickerOpen(false)}
      />
    </Modal>
  );
}
