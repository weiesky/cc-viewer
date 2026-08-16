import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Segmented, Select, Modal, Tooltip, AutoComplete } from 'antd';
import { t } from '../../i18n';
import ConfirmRemoveButton from '../common/ConfirmRemoveButton';
import styles from './SystemTextModal.module.css';

const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; // 与父组件/服务端一致

// 大小写不敏感匹配：模型名包含完整 match 提示，或 match 提示以已输入名为前缀(部分输入)。
// 要求至少 2 个字符，避免单字符误命中(预设默认 override，误命中会整体替换提示词)。取首个命中。
function matchPreset(presets, name) {
  const n = (name || '').trim().toLowerCase();
  if (n.length < 2) return null;
  return presets.find((p) => {
    const m = (p.match || '').toLowerCase();
    return m && (n.includes(m) || m.startsWith(n));
  }) || null;
}

// 字段旁的「?」内联说明(hover/点击浮现 Tooltip)。
function FieldHelp({ text }) {
  return (
    <Tooltip title={text} trigger={['hover', 'click']} placement="topLeft">
      <span className={styles.helpBtn} aria-label={text}>?</span>
    </Tooltip>
  );
}

// Model tab strip inside the "Edit System Prompt" modal (strictly aligned with
// UltraPlanModal's Chrome-tab strip): a Default tab + one tab per model entry
// (scope badge / unsaved dot / hover delete ×) + an "+ Add model" button that
// opens a secondary Modal (name + scope + preset, each with a label and a "?").
// Pure presentational component: selection, entry list, and validation live in
// the parent (onAdd returns an error message or null).
export default function ModelPromptTabs({
  entries,          // [{ name, scope: 'global'|'workspace' }]
  activeKey,        // 'default' | `${scope}:${name}`
  dirtyKeys,        // 有未保存修改的 key 列表
  workspaceEnabled, // 是否有活动工作区(决定 Workspace 作用域可选与否)
  disabled,         // 加载中等全局禁用
  presets = [],     // 内置预设 [{id,title,description,match,defaultMode,text}]
  suggestedModels = [], // 名称输入建议候选(父组件拉取，已清洗去重)
  onSelect,         // (key) => void
  onAdd,            // (name, scope, presetId) => string|null 错误文案(null=成功,父组件已建tab)
  onDelete,         // (name, scope) => void
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addScope, setAddScope] = useState('global');
  const [addError, setAddError] = useState(null);
  const [pickedPreset, setPickedPreset] = useState(null); // 用户手动选择的预设 id；null=未手动选
  const [presetTouched, setPresetTouched] = useState(false);
  const nameRef = useRef(null);

  // antd Modal 会把焦点移到弹窗容器上，原生 autoFocus 常失效 → 打开后手动聚焦名称输入框。
  useEffect(() => {
    if (addOpen) setTimeout(() => nameRef.current?.focus?.(), 0);
  }, [addOpen]);

  // 关闭时重置(注意：故意不清空 addScope，作用域在多次打开间保持)。
  const resetAdd = () => {
    setAddName(''); setAddError(null); setPickedPreset(null); setPresetTouched(false);
  };
  const closeAdd = () => { setAddOpen(false); resetAdd(); };

  // 生效预设：用户手动选过则用其选择(含"空白"=null)；否则按名称自动匹配。
  const autoMatched = presetTouched ? null : matchPreset(presets, addName);
  const effectivePresetId = presetTouched ? pickedPreset : (autoMatched?.id || null);

  // 隐藏当前作用域已添加的名字(大小写不敏感；父组件条目名为大写规范化)，
  // 另一作用域的同名条目仍可见；切换作用域时随 addScope 重算。
  const nameOptions = useMemo(() => {
    const taken = new Set(entries.filter((e) => e.scope === addScope).map((e) => e.name.toLowerCase()));
    return suggestedModels.filter((m) => !taken.has(m.toLowerCase())).map((m) => ({ value: m }));
  }, [entries, addScope, suggestedModels]);

  const handleAdd = () => {
    const err = onAdd(addName.trim(), addScope, effectivePresetId);
    if (err) { setAddError(err); return; }
    resetAdd();
    setAddOpen(false);
  };

  // 选择预设：记为手动选择；名称为空且预设名合法时顺带回填名称(便于用户)。
  const onPickPreset = (id) => {
    setPresetTouched(true);
    setPickedPreset(id || null);
    if (id && !addName.trim()) {
      const p = presets.find((x) => x.id === id);
      const candidate = (p?.match || p?.id || '').trim();
      if (candidate && MODEL_NAME_RE.test(candidate)) { setAddName(candidate); setAddError(null); }
    }
  };

  const tabKey = (e) => `${e.scope}:${e.name}`;

  // 按 category 分组的下拉选项 + 置顶"空白"项。
  const presetGroups = presets.reduce((acc, p) => {
    (acc[p.category || 'Global'] || (acc[p.category || 'Global'] = [])).push(p);
    return acc;
  }, {});
  const presetOptions = [
    { value: '', label: t('ui.expert.systemText.presetNone') },
    ...Object.entries(presetGroups).map(([label, items]) => ({
      label,
      options: items.map((p) => ({ value: p.id, label: p.title })),
    })),
  ];

  return (
    <div className={styles.tabRow}>
      <button
        type="button"
        className={`${styles.tabBtn} ${activeKey === 'default' ? styles.tabActive : ''}`}
        onClick={() => onSelect('default')}
      >
        {t('ui.expert.systemText.tabDefault')}
        {dirtyKeys.includes('default') && <span className={styles.dirtyDot} />}
      </button>
      {entries.map((e) => {
        const key = tabKey(e);
        return (
          <span key={key} className={styles.tabWrap}>
            <button
              type="button"
              className={`${styles.tabBtn} ${activeKey === key ? styles.tabActive : ''}`}
              onClick={() => onSelect(key)}
              title={e.name}
            >
              <span className={styles.tabTitle}>{e.name}</span>
              <span className={styles.scopeBadge}>
                {t(e.scope === 'global' ? 'ui.expert.systemText.scopeGlobal' : 'ui.expert.systemText.scopeWorkspace')}
              </span>
              {dirtyKeys.includes(key) && <span className={styles.dirtyDot} />}
            </button>
            <ConfirmRemoveButton
              tag="span"
              className={styles.tabDelete}
              title={t('ui.expert.systemText.deleteTab', { name: e.name })}
              ariaLabel={t('ui.expert.systemText.deleteTab', { name: e.name })}
              onConfirm={() => onDelete(e.name, e.scope)}
              disabled={disabled}
            >
              ×
            </ConfirmRemoveButton>
          </span>
        );
      })}
      <button
        type="button"
        className={styles.addBtn}
        disabled={disabled}
        onClick={() => setAddOpen(true)}
      >
        + {t('ui.expert.systemText.addModel')}
      </button>

      <Modal
        open={addOpen}
        title={t('ui.expert.systemText.addModel')}
        onCancel={closeAdd}
        onOk={handleAdd}
        okText={t('ui.expert.systemText.addModelConfirm')}
        cancelText={t('ui.cancel')}
        okButtonProps={{ disabled: !addName.trim() }}
        zIndex={1300}
        width={440}
        destroyOnClose
      >
        <div className={styles.addModalBody}>
          <div className={styles.addModalField}>
            <span className={styles.fieldLabelRow}>
              {t('ui.expert.systemText.nameLabel')}
              <FieldHelp text={t('ui.expert.systemText.modelHelp')} />
            </span>
            <AutoComplete
              ref={nameRef}
              className={styles.addNameAutoComplete}
              value={addName}
              options={nameOptions}
              // AutoComplete 的 onChange 传值字符串，不是 event。
              onChange={(v) => { setAddName(v); setAddError(null); }}
              placeholder={t('ui.expert.systemText.addModelName')}
              filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
              // 回车绝不静默选中首项(也绝不提交 —— 这里故意没有 onPressEnter)。
              defaultActiveFirstOption={false}
              // 无建议时不出现任何下拉：与原纯输入框行为一致。
              notFoundContent={null}
              // 与下方预设 Select 同理：下拉渲染进弹窗内容节点，否则会被 zIndex-1300 的二级弹窗遮挡。
              getPopupContainer={(trigger) => trigger.parentNode}
            />
          </div>

          <div className={styles.addModalField}>
            <span className={styles.fieldLabelRow}>
              {t('ui.expert.systemText.scopeLabel')}
              <FieldHelp text={t('ui.expert.systemText.scopeHelp')} />
            </span>
            <Segmented
              value={addScope}
              onChange={setAddScope}
              options={[
                { label: t('ui.expert.systemText.scopeGlobal'), value: 'global' },
                { label: t('ui.expert.systemText.scopeWorkspace'), value: 'workspace', disabled: !workspaceEnabled },
              ]}
            />
          </div>

          {presets.length > 0 && (
            <div className={styles.addModalField}>
              <span className={styles.fieldLabelRow}>
                {t('ui.expert.systemText.presetLabel')}
                <FieldHelp text={t('ui.expert.systemText.presetHelp')} />
              </span>
              <Select
                className={styles.presetSelect}
                value={effectivePresetId || ''}
                onChange={onPickPreset}
                options={presetOptions}
                // 下拉渲染进弹窗内容节点，随弹窗滚动、避免定位错乱。
                getPopupContainer={(trigger) => trigger.parentNode}
              />
              {autoMatched && (
                <div className={styles.presetMatched}>
                  {t('ui.expert.systemText.presetMatched', { title: autoMatched.title })}
                </div>
              )}
            </div>
          )}

          {addError && <div className={styles.addError}>{addError}</div>}
        </div>
      </Modal>
    </div>
  );
}
