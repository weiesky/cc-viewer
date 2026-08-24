import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, Input, Switch, Spin, message } from 'antd';
import { t, getLang } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { renderMarkdown } from '../../utils/markdown';
import { reportSwallowed } from '../../utils/errorReport';
import { collectModelSuggestions } from '../../utils/modelSuggestions';
import { isBuiltinEntryDisabled, builtinTargetScope, builtinToggleScopes, isBuiltinShadowed } from '../../utils/builtinPromptTabs';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import ModelPromptTabs from './ModelPromptTabs';
import styles from './SystemTextModal.module.css';

// 「系统提示词修改」模态（偏好设置 → 专家设置）。self-contained：打开时自取、保存时自存。
// 页签化：
//   - Default 页签 = 原有行为：写当前工作区 CC_SYSTEM.md(覆盖)/CC_APPEND_SYSTEM.md(追加)，
//     两模式互斥、存空即禁用；
//   - 模型页签 = 按模型定制条目(全局 <LOG_DIR>/system_prompt/ 或工作区 <ws>/system_prompt/)，
//     启动时按「当前生效配置解析出的模型 id」大小写不敏感子串匹配，命中即整体取代 Default；
//   - 内置页签 = 随包 preset 的默认生效层(builtin-model-prompts.js)：用户条目未命中时按同语义
//     注入；编辑保存 = 物化为选定 scope 的用户覆盖条目(成功后换 key 转普通页签，目标已有同名
//     用户条目时拦截并提示 shadowed)；页签 × = 禁用/启用切换(墓碑 .builtin-disabled.json，
//     启用时双 scope 墓碑一次全清)；禁用态页签只读、以「已禁用」徽标与 ↺ 提示重启用。
// 均由 ccv 在下次启动 claude 时注入为 --system-prompt-file / --append-system-prompt-file。

const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; // 与 server/lib/model-system-prompts.js 严格一致

const EMPTY_DRAFT = { text: '', mode: 'append' };
const tabKeyOf = (scope, name) => `${scope}:${name}`;

export default function SystemTextModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);   // markdown 预览开关：开=渲染预览，关=编辑
  const [dir, setDir] = useState(null);
  const [active, setActive] = useState(true);
  const [globalDir, setGlobalDir] = useState(null);
  const [entries, setEntries] = useState([]);      // [{ name, scope }] 页签顺序
  const [snapshots, setSnapshots] = useState({});  // { key: {text, mode} } 服务端真值
  const [drafts, setDrafts] = useState({});        // { key: {text, mode} } 编辑草稿
  const [persisted, setPersisted] = useState({});  // { key: true } 服务端已存在(区分新建未保存页签)
  const [activeKey, setActiveKey] = useState('default');
  const [presets, setPresets] = useState([]);      // 内置系统提示词预设 [{id,title,description,match,defaultMode,text}]
  const [builtinScope, setBuiltinScope] = useState({}); // 内置页签的物化/墓碑目标作用域 { key: 'global'|'workspace' }(默认 global)
  const [modelSuggestions, setModelSuggestions] = useState([]); // 「+ 添加模型」名称输入建议(本地已配置模型)
  const [variablesDoc, setVariablesDoc] = useState(''); // ${...} 变量参数文档(markdown)
  const [docOpen, setDocOpen] = useState(false);   // 参数文档二级弹窗开关
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false; // 关闭/卸载后丢弃在途响应，避免对已卸载组件 setState
    setPreview(false); // 每次打开默认回到编辑态
    setActiveKey('default');
    setVariablesDoc(''); // 清空上次的文档，避免本次拉取失败时残留旧内容
    setDocOpen(false);
    setLoading(true);
    // 三个 GET 各自失败互不拖累(allSettled)：system-text/model-prompts 任一失败提示 loadError；
    // presets 失败为非致命(下拉降级为隐藏/仅空白)，不弹 loadError。
    Promise.allSettled([
      fetch(apiUrl('/api/expert/system-text')).then((r) => r.json()),
      fetch(apiUrl('/api/expert/model-prompts')).then((r) => r.json()),
      fetch(apiUrl(`/api/expert/system-prompt-presets?lang=${encodeURIComponent(getLang())}`)).then((r) => r.json()),
      fetch(apiUrl('/api/proxy-profiles')).then((r) => r.json()),
      fetch(apiUrl('/api/claude-settings')).then((r) => r.json()),
    ]).then(([sysR, mpR, presetR, profR, csR]) => {
      if (cancelled) return;
      const snaps = {};
      const pers = {};
      const list = [];
      if (sysR.status === 'fulfilled' && sysR.value && !sysR.value.error) {
        const d = sysR.value;
        snaps.default = { text: d.text || '', mode: d.mode === 'override' ? 'override' : 'append' };
        setDir(d.dir || null);
        setActive(!!d.active);
        pers.default = true;
      } else {
        // Default 状态未知：禁用其编辑，避免盲目覆盖。
        snaps.default = { ...EMPTY_DRAFT };
        setDir(null);
        setActive(false);
        message.error(t('ui.expert.systemText.loadError'));
      }
      if (mpR.status === 'fulfilled' && mpR.value && !mpR.value.error) {
        const d = mpR.value;
        setGlobalDir(d.globalDir || null);
        for (const scope of ['global', 'workspace']) {
          for (const e of (d[scope] || [])) {
            const key = tabKeyOf(scope, e.name);
            list.push({ name: e.name, scope });
            snaps[key] = { text: e.text || '', mode: e.mode === 'override' ? 'override' : 'append' };
            pers[key] = true;
          }
        }
        // 内置 preset 条目（默认生效层）：persisted=true（非新建页签），disabled 携带
        // 双 scope 墓碑标志；页签与用户条目同名体系，用户文件在列表前段、天然压过内置。
        for (const e of (d.builtin || [])) {
          const key = tabKeyOf('builtin', e.name);
          list.push({ name: e.name, scope: 'builtin', disabled: e.disabled || {} });
          snaps[key] = { text: e.text || '', mode: e.mode === 'override' ? 'override' : 'append' };
          pers[key] = true;
        }
        // 默认选中「当前生效模型命中的条目」页签(服务端经 resolveSpawnModel+matchModelPrompt
        // 算出，含 k3→KIMI 别名与内置层命中)；无命中或条目在两次目录扫描间被删 → 保持开头的 default 重置。
        const mk = d.matched;
        const matchKey = mk && typeof mk.name === 'string' && (mk.scope === 'global' || mk.scope === 'workspace' || mk.scope === 'builtin')
          ? tabKeyOf(mk.scope, mk.name)
          : null;
        if (matchKey && list.some((e) => tabKeyOf(e.scope, e.name) === matchKey)) setActiveKey(matchKey);
      } else {
        setGlobalDir(null);
        message.error(t('ui.expert.systemText.loadError'));
      }
      // 预设为非致命：失败/异常只记录(reportSwallowed，因丢失预设会降级 UI)，不打断加载。
      if (presetR.status === 'fulfilled' && presetR.value && !presetR.value.error && Array.isArray(presetR.value.presets)) {
        setPresets(presetR.value.presets);
        setVariablesDoc(typeof presetR.value.variablesDoc === 'string' ? presetR.value.variablesDoc : '');
      } else {
        setPresets([]);
        setVariablesDoc('');
        reportSwallowed('systemPromptPresets.fetch', presetR.reason || new Error(presetR.value?.error || 'presets_unavailable'));
      }
      // 名称建议源同为非致命：失败腿只记录并以 null 传入，输入框退化为无建议的纯输入。
      // 守卫形状与 preset 腿一致 —— 401/500 会 resolve 成 {error} 而非 reject。
      const profOk = profR.status === 'fulfilled' && profR.value && !profR.value.error;
      const csOk = csR.status === 'fulfilled' && csR.value && !csR.value.error;
      if (!profOk) reportSwallowed('modelSuggestions.proxyProfiles', profR.reason || new Error(profR.value?.error || 'proxy_profiles_unavailable'));
      if (!csOk) reportSwallowed('modelSuggestions.claudeSettings', csR.reason || new Error(csR.value?.error || 'claude_settings_unavailable'));
      setModelSuggestions(collectModelSuggestions(profOk ? profR.value : null, csOk ? csR.value : null));
      setEntries(list);
      setSnapshots(snaps);
      setDrafts(JSON.parse(JSON.stringify(snaps)));
      setPersisted(pers);
    }).finally(() => {
      if (cancelled) return;
      setLoading(false);
      // Focus the editor on open (focus on a disabled field is a no-op): the focused
      // border turns theme-primary, matching how UltraPlan looks when it opens.
      setTimeout(() => textareaRef.current?.focus?.(), 0);
    });
    return () => { cancelled = true; };
  }, [open]);

  const draft = drafts[activeKey] || EMPTY_DRAFT;
  const isDirty = useCallback((key) => {
    const d = drafts[key];
    const s = snapshots[key];
    if (!d || !s) return false;
    return d.text !== s.text || d.mode !== s.mode;
  }, [drafts, snapshots]);
  const allKeys = ['default', ...entries.map((e) => tabKeyOf(e.scope, e.name))];
  const dirtyKeys = allKeys.filter(isDirty);
  // 内置条目辅助：有效禁用态/目标作用域/切换 scope 列表/shadowed 判定均来自
  // utils/builtinPromptTabs.js 纯函数（规则集中、可单测；本组件内不另维护第二份）。
  const builtinEntryOf = (key) => entries.find((e) => e.scope === 'builtin' && tabKeyOf(e.scope, e.name) === key);
  const materializeScope = (key) => builtinTargetScope(builtinScope[key], active);
  // 某页签是否可编辑：内置禁用态页签不可编辑（防残留草稿经 OK 静默物化、击穿墓碑意图）；
  // 全局作用域随时可编；Default 与工作区作用域需有活动工作区。
  const editable = (key) => {
    if (key.startsWith('builtin:')) return !isBuiltinEntryDisabled(builtinEntryOf(key));
    return key === 'default' || key.startsWith('workspace:') ? active : true;
  };
  const saveableDirty = dirtyKeys.filter(editable);

  const setDraft = (patch) => {
    setDrafts((prev) => ({ ...prev, [activeKey]: { ...(prev[activeKey] || EMPTY_DRAFT), ...patch } }));
  };

  const selectTab = (key) => {
    setActiveKey(key);
    setPreview(false); // 切页签回到编辑态
  };

  // 「+ 添加模型」：校验(与服务端规则一致)后本地建页签；返回错误文案或 null。
  // presetId 命中内置预设时，用其原始模板文本(占位符保持字面量)预填草稿；快照仍为空，
  // 故新页签读作 dirty、可被 handleSave 保存。
  const handleAdd = (name, scope, presetId) => {
    if (!MODEL_NAME_RE.test(name) || /_APPEND$/i.test(name)) return t('ui.expert.systemText.invalidName');
    if (name.toLowerCase() === 'default') return t('ui.expert.systemText.reservedName');
    const canonical = name.toUpperCase();
    if (entries.some((e) => e.scope === scope && e.name.toUpperCase() === canonical)) {
      return t('ui.expert.systemText.duplicateName');
    }
    if (scope === 'workspace' && !active) return t('ui.expert.systemText.noWorkspace');
    const preset = presetId ? presets.find((p) => p.id === presetId) : null;
    const seeded = preset
      ? { text: preset.text || '', mode: preset.defaultMode === 'override' ? 'override' : 'append' }
      : { ...EMPTY_DRAFT };
    const key = tabKeyOf(scope, canonical);
    setEntries((prev) => [...prev, { name: canonical, scope }]);
    setSnapshots((prev) => ({ ...prev, [key]: { ...EMPTY_DRAFT } })); // 快照留空 → 有预填即为 dirty
    setDrafts((prev) => ({ ...prev, [key]: seeded }));
    setActiveKey(key);
    setPreview(false);
    setTimeout(() => textareaRef.current?.focus?.(), 0); // 新页签即刻可输入(添加后的编辑入口)
    return null;
  };

  const removeTabLocal = (key) => {
    setEntries((prev) => prev.filter((e) => tabKeyOf(e.scope, e.name) !== key));
    setSnapshots((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setDrafts((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setPersisted((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setActiveKey((cur) => (cur === key ? 'default' : cur));
  };

  // 内置页签保存成功后换 key：builtin:NAME → <物化 scope>:NAME（entries/snapshots/drafts/
  // persisted 全套迁移 + activeKey 同步；目标页签因 shadowed 前置过滤必不存在，纯移动）。
  const migrateBuiltinKey = (fromKey, targetScope) => {
    const name = fromKey.slice(fromKey.indexOf(':') + 1);
    const toKey = tabKeyOf(targetScope, name);
    setEntries((prev) => {
      const without = prev.filter((e) => tabKeyOf(e.scope, e.name) !== fromKey);
      if (without.some((e) => tabKeyOf(e.scope, e.name) === toKey)) return without;
      return [...without, { name, scope: targetScope }];
    });
    setSnapshots((prev) => {
      const n = { ...prev };
      n[toKey] = { ...(drafts[fromKey] || EMPTY_DRAFT) }; // 真值 = 刚保存的草稿
      delete n[fromKey];
      return n;
    });
    setDrafts((prev) => { const n = { ...prev }; n[toKey] = prev[fromKey] || EMPTY_DRAFT; delete n[fromKey]; return n; });
    setPersisted((prev) => { const n = { ...prev }; n[toKey] = true; delete n[fromKey]; return n; });
    setBuiltinScope((prev) => { const n = { ...prev }; delete n[fromKey]; return n; });
    setActiveKey((cur) => (cur === fromKey ? toKey : cur));
  };

  // 内置条目的禁用/启用：即时 POST（不进 dirty/OK 流）。禁用写入当前所选作用域的墓碑；
  // 启用按「实际墓碑所在作用域」逐一清除（workspace/global 双墓碑一次全清）——否则
  // 跨会话后内存态 scope 回落 global，workspace 墓碑永远无法经 UI 清除（死路）。
  // 切换后重置草稿为真值，清掉切换前的残留 dirty（禁用后 editable=false 但 OK 仍看 dirty 计数）。
  const handleBuiltinToggle = (name) => {
    const key = tabKeyOf('builtin', name);
    const entry = builtinEntryOf(key);
    const nowDisabled = !isBuiltinEntryDisabled(entry); // 目标态
    const scopes = builtinToggleScopes(entry, nowDisabled, materializeScope(key));
    if (!scopes.length) return; // 状态已一致（并发双击等），无操作
    Promise.all(scopes.map((scope) => fetch(apiUrl('/api/expert/model-prompts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: nowDisabled ? 'disable-builtin' : 'enable-builtin', scope, name }),
    }).then((r) => r.json()))).then((rs) => {
      if (rs.some((d) => d && d.error)) { message.error(t('ui.expert.systemText.deleteError')); return; }
      setEntries((prev) => prev.map((e) => (tabKeyOf(e.scope, e.name) === key
        ? { ...e, disabled: nowDisabled ? { ...(e.disabled || {}), [scopes[0]]: true } : {} }
        : e)));
      setDrafts((prev) => ({ ...prev, [key]: { ...(snapshots[key] || EMPTY_DRAFT) } }));
      message.success(t('ui.expert.systemText.saved'));
    }).catch(() => message.error(t('ui.expert.systemText.deleteError')));
  };

  // 页签「×」删除：内置页签改走禁用/启用切换（墓碑语义，绝不发空文本删除）；
  // 未持久化的页签仅本地移除；已持久化的立即 POST 空文本(=删除条目)。
  const handleDelete = (name, scope) => {
    if (scope === 'builtin') { handleBuiltinToggle(name); return; }
    const key = tabKeyOf(scope, name);
    if (!persisted[key]) { removeTabLocal(key); return; }
    fetch(apiUrl('/api/expert/model-prompts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, name, text: '' }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.error) { message.error(t('ui.expert.systemText.deleteError')); return; }
        removeTabLocal(key);
        message.success(t('ui.expert.systemText.deleted'));
      })
      .catch(() => message.error(t('ui.expert.systemText.deleteError')));
  };

  // OK = 保存全部可保存的脏页签。新建且仍为空的页签跳过(无操作)；模型页签存空 = 删除条目；
  // 内置页签 = 物化（POST 到选定 scope 生成用户覆盖条目，成功后换 key 转为普通页签）；
  // 目标 scope 已有同名用户条目的内置页签跳过并提示（merge 语义：绝不静默覆盖用户文件）。
  const handleSave = () => {
    const shadowedBuiltins = [];
    const ops = saveableDirty
      .filter((key) => !(key !== 'default' && !persisted[key] && !(drafts[key]?.text || '').trim()))
      // 内置页签空文本直接跳过：空物化会经服务端 cleared 分支换 key 出一个幽灵页签；
      // 清空内置不等于删除（内置不可删），用户意图只能是「不物化」。
      .filter((key) => !(key.startsWith('builtin:') && !(drafts[key]?.text || '').trim()))
      .filter((key) => {
        if (!key.startsWith('builtin:')) return true;
        const name = key.slice(key.indexOf(':') + 1);
        // shadowed 判定看 entries 全集（不止 persisted）：会话内新建的同名用户页签同样拦截，
        // 杜绝两条并发 POST 打同一 scope:name 目标的覆盖竞态。
        const targetKey = tabKeyOf(materializeScope(key), name);
        if (isBuiltinShadowed(entries, targetKey)) {
          shadowedBuiltins.push(name);
          return false;
        }
        return true;
      })
      .map((key) => {
        const d = drafts[key] || EMPTY_DRAFT;
        // 物化目标 scope 在构建期捕获并随 op 带回：保存期间用户翻转开关也不会让
        // 「写盘作用域」与「UI 迁移目标」分叉。
        const targetScope = key.startsWith('builtin:') ? materializeScope(key) : null;
        const body = key === 'default'
          ? { mode: d.mode, text: d.text }
          : key.startsWith('builtin:')
            ? { scope: targetScope, name: key.slice(key.indexOf(':') + 1), mode: d.mode, text: d.text }
            : { scope: key.slice(0, key.indexOf(':')), name: key.slice(key.indexOf(':') + 1), mode: d.mode, text: d.text };
        const url = key === 'default' ? '/api/expert/system-text' : '/api/expert/model-prompts';
        return fetch(apiUrl(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.json()).then((resp) => {
          if (resp && resp.error) throw new Error(resp.error);
          return { key, resp, targetScope };
        });
      });
    if (shadowedBuiltins.length) {
      message.warning(t('ui.expert.systemText.builtinShadowed', { name: shadowedBuiltins.join(', ') }));
    }
    // 全部被 shadowed 拦截时保持弹窗打开（用户需要看到提示并决定下一步），否则照旧关闭。
    if (!ops.length) {
      if (!shadowedBuiltins.length) { onClose && onClose(); }
      return;
    }
    setSaving(true);
    Promise.allSettled(ops).then((results) => {
      let failed = 0;
      const okOps = [];
      for (const r of results) {
        if (r.status === 'fulfilled') okOps.push(r.value); else failed += 1;
      }
      // 成功的先落账(内置页签换 key 物化/草稿升级为真值/清除的页签移除)，失败的保留脏态待重试。
      for (const { key, resp, targetScope } of okOps) {
        if (key.startsWith('builtin:')) {
          migrateBuiltinKey(key, targetScope || 'global');
        } else if (key !== 'default' && resp && resp.cleared) {
          removeTabLocal(key);
        } else {
          setSnapshots((prev) => ({ ...prev, [key]: { ...(drafts[key] || EMPTY_DRAFT) } }));
          setPersisted((prev) => ({ ...prev, [key]: !(key === 'default' && resp && resp.cleared) }));
        }
      }
      if (failed) { message.error(t('ui.expert.systemText.saveError')); return; }
      // 单一操作且是清除时沿用原有提示语；其余一律「已保存」。
      if (okOps.length === 1 && okOps[0].resp && okOps[0].resp.cleared) {
        message.success(t(okOps[0].key === 'default' ? 'ui.expert.systemText.cleared' : 'ui.expert.systemText.deleted'));
      } else {
        message.success(t('ui.expert.systemText.saved'));
      }
      onClose && onClose();
    }).finally(() => setSaving(false));
  };

  const handleCancel = () => {
    if (saveableDirty.length) {
      Modal.confirm({
        title: t('ui.expert.systemText.discardTitle'),
        okText: t('ui.common.confirmYes'),
        cancelText: t('ui.common.confirmCancel'),
        centered: true,
        zIndex: 1200,
        onOk: () => { onClose && onClose(); },
      });
      return;
    }
    onClose && onClose();
  };

  const curEditable = editable(activeKey);
  const isGlobalTab = activeKey.startsWith('global:');
  const isBuiltinTab = activeKey.startsWith('builtin:');
  // 参数文档只在其内容变化时重渲染 markdown(避免主编辑器每次按键都重解析 ~6KB)。
  const docHtml = useMemo(() => (variablesDoc ? renderMarkdown(variablesDoc) : ''), [variablesDoc]);

  return (
    <>
    <Modal
      title={(
        <span className={styles.titleRow}>
          {t('ui.expert.systemText')}
          {/* Title doc button: click-only (no hover tooltip — a hover affordance made it read
              as non-clickable). Opens the parameter-docs popup, whose top now carries the
              feature blurb that used to live in the tooltip, so it stays reachable even when
              variablesDoc failed to load. */}
          <span
            className={styles.paramDocBtn}
            role="button"
            tabIndex={0}
            onClick={() => setDocOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDocOpen(true); } }}
          >{t('ui.expert.systemText.paramDocTitle')}</span>
        </span>
      )}
      open={open}
      onCancel={handleCancel}
      onOk={handleSave}
      okText={t('ui.save')}
      cancelText={t('ui.cancel')}
      okButtonProps={{ loading: saving, disabled: loading || saveableDirty.length === 0 }}
      width="min(900px, 92vw)"
      zIndex={1100}
      styles={{ mask: BLUR_MASK_STYLE }}
    >
      <Spin spinning={loading}>
        <ModelPromptTabs
          entries={entries}
          activeKey={activeKey}
          dirtyKeys={dirtyKeys}
          workspaceEnabled={active}
          disabled={loading || saving}
          presets={presets}
          suggestedModels={modelSuggestions}
          onSelect={selectTab}
          onAdd={handleAdd}
          onDelete={handleDelete}
        />
        {/* The editor card immediately follows the tab strip (sibling, zero gap) —
            the active tab's -1px overlaps the card's top edge for a seamless join */}
        <div className={styles.editorBox}>
          {preview ? (
            <div className={styles.previewBox}>
              {draft.text
                ? <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.text) }} />
                : <div className={styles.previewEmpty}>{t('ui.expert.systemText.placeholder')}</div>}
            </div>
          ) : (
            <Input.TextArea
              ref={textareaRef}
              value={draft.text}
              onChange={(e) => setDraft({ text: e.target.value })}
              placeholder={t('ui.expert.systemText.placeholder')}
              autoSize={{ minRows: 14, maxRows: 28 }}
              disabled={!curEditable}
            />
          )}
        </div>
        <div className={styles.modeRow}>
          <div className={styles.modeLeft}>
            <Switch
              checked={draft.mode === 'override'}
              onChange={(v) => setDraft({ mode: v ? 'override' : 'append' })}
              checkedChildren={t('ui.expert.systemText.override')}
              unCheckedChildren={t('ui.expert.systemText.append')}
              disabled={!curEditable}
            />
            {draft.mode === 'override' && (
              <span className={styles.overrideWarn}>{t('ui.expert.systemText.overrideWarn')}</span>
            )}
            {isBuiltinTab && (
              <span className={styles.builtinScopeRow}>
                <span className={styles.previewLabel}>{t('ui.expert.systemText.scopeLabel')}</span>
                <Switch
                  checked={materializeScope(activeKey) === 'workspace'}
                  onChange={(v) => setBuiltinScope((prev) => ({ ...prev, [activeKey]: v ? 'workspace' : 'global' }))}
                  checkedChildren={t('ui.expert.systemText.scopeWorkspace')}
                  unCheckedChildren={t('ui.expert.systemText.scopeGlobal')}
                  disabled={!active || saving}
                />
              </span>
            )}
          </div>
          <div className={styles.modeRight}>
            <span className={styles.previewLabel}>{t('ui.expert.systemText.preview')}</span>
            <Switch checked={preview} onChange={setPreview} disabled={!curEditable} />
          </div>
        </div>
        {curEditable ? (
          <div className={styles.hint}>
            <div className={styles.dirLine}>
              {isBuiltinTab
                ? t('ui.expert.systemText.builtinDirHint', {
                    // 提示跟随物化作用域 Switch：global → 全局目录；workspace → 工作区 system_prompt/
                    dir: materializeScope(activeKey) === 'workspace' ? `${dir || ''}/system_prompt` : (globalDir || ''),
                  })
                : isGlobalTab
                  ? t('ui.expert.systemText.dirHintGlobal', { dir: globalDir || '' })
                  : t('ui.expert.systemText.dirHint', {
                      // Default 页签写工作区根;模型页签写工作区的 system_prompt/ 子目录
                      dir: activeKey === 'default' ? (dir || '') : `${dir || ''}/system_prompt`,
                    })}
            </div>
            {isBuiltinTab && <div>{t('ui.expert.systemText.builtinEditHint')}</div>}
            <div>{t('ui.expert.systemText.note')}</div>
          </div>
        ) : isBuiltinTab ? (
          // 内置禁用态的不可编辑原因是墓碑，不是无工作区 —— 给出可操作的指引。
          <div className={styles.warn}>{t('ui.expert.systemText.builtinDisabledHint')}</div>
        ) : (
          <div className={styles.warn}>{t('ui.expert.systemText.noWorkspace')}</div>
        )}
      </Spin>
    </Modal>

    {/* 参数文档二级弹窗：渲染 ${...} 变量参考(只读)。 */}
    <Modal
      open={docOpen}
      title={t('ui.expert.systemText.paramDocTitle')}
      onCancel={() => setDocOpen(false)}
      footer={null}
      width="min(760px, 92vw)"
      zIndex={1300}
    >
      {/* Feature blurb relocated from the old title-"?" hover tooltip; plain JSX text
          (auto-escaped), deliberately NOT concatenated into the sanitized markdown HTML. */}
      <p className={styles.docIntro}>{t('ui.expert.help')}</p>
      {docHtml ? (
        <div
          className={`${styles.docBox} chat-md`}
          dangerouslySetInnerHTML={{ __html: docHtml }}
        />
      ) : null}
    </Modal>
    </>
  );
}
