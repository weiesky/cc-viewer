import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Spin, Popconfirm, Popover } from 'antd';
import { uploadFileAndGetPath } from '../terminal/TerminalPanel';
import { apiUrl } from '../../utils/apiUrl';
import { isMobile, isPad } from '../../env';
import { t, getLang } from '../../i18n';
import ImageLightbox from '../common/ImageLightbox';
import ConfirmRemoveButton from '../common/ConfirmRemoveButton';
import styles from './ChatInputBar.module.css';
import chrome from '../common/sharedChrome.module.css';
import { AgentTeamIcon, UltraplanIcon, UploadIcon, TrashIcon, SPARKLE_MASK_STYLE, ULTRAPLAN_MASK_STYLE } from '../common/quickMenuIcons';
import QuickAutoApproveRows from '../common/QuickAutoApproveRows';
import { createQuickMenuHoverIntent } from '../../utils/quickMenuHoverIntent';

const SpeechRec = typeof window !== 'undefined' && window.isSecureContext
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

// Desktop textarea vertical metrics (must stay in sync with ChatInputBar.module.css):
// padding 12px top + 4px bottom, line-height 21px (14 * 1.5).
const FOCUS_VPAD = 16;
const LINE_H = 21;
const MIN_LINES = 1;
const MAX_LINES = 6;
const FOCUS_LINES = 2;

// Shared autosize helper: measures the content box (scrollHeight minus vertical padding)
// so an empty textarea snaps to exactly one line; `focused` pads short content up to two lines.
// Mobile (isMobile && !isPad) keeps the legacy total-box behavior (different padding/font metrics).
export function resizeChatTextarea(ta, { focused = false } = {}) {
  if (!ta) return;
  ta.style.height = 'auto';
  if (isMobile && !isPad) {
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    return;
  }
  const content = Math.min(Math.max(ta.scrollHeight - FOCUS_VPAD, LINE_H * MIN_LINES), LINE_H * MAX_LINES);
  ta.style.height = (focused ? Math.max(content, LINE_H * FOCUS_LINES) : content) + 'px';
}

const SPEECH_LANG_MAP = {
  zh: 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-US', ko: 'ko-KR',
  ja: 'ja-JP', de: 'de-DE', es: 'es-ES', fr: 'fr-FR',
  it: 'it-IT', da: 'da-DK', pl: 'pl-PL', ru: 'ru-RU',
  ar: 'ar-SA', no: 'nb-NO', 'pt-BR': 'pt-BR', th: 'th-TH',
  tr: 'tr-TR', uk: 'uk-UA',
};

function ChatInputBar({ inputRef, inputEmpty, inputSuggestion, terminalVisible, onKeyDown, onChange, onSend, onStop, onSuggestionClick, onUploadPath, presetItems, onPresetSend, onOpenPresetModal, onOpenUltraPlan, onClearContext, isStreaming, pendingImages, onRemovePendingImage, uploadingItems, sendDeferred, onUploadStart, onUploadEnd, setContextBarSlot, autoApproveSeconds, onAutoApproveChange, planAutoApproveSeconds, onPlanAutoApproveChange, onClearContextNow, ultraplanPopover, agentTeamEnabled }) {
  const [plusOpen, setPlusOpen] = useState(false);
  // 桌面四芒星菜单的级联展开行（与终端工具栏同款交互）：null | 'perm' | 'plan' | 'agentteam'
  const [quickExpanded, setQuickExpanded] = useState(null);
  // latest-value ref：hover-intent 的延迟提交需要现场读最新展开行（见 utils/quickMenuHoverIntent）
  const quickExpandedRef = useRef(quickExpanded);
  quickExpandedRef.current = quickExpanded;
  const qmHoverRef = useRef(null);
  if (!qmHoverRef.current) {
    qmHoverRef.current = createQuickMenuHoverIntent({
      getExpanded: () => quickExpandedRef.current,
      setExpanded: setQuickExpanded,
    });
  }
  const qmHover = qmHoverRef.current;
  useEffect(() => () => qmHover.cancel(), [qmHover]);
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const recRef = useRef(null);
  const anchorRef = useRef({ prefix: '', suffix: '' });
  const rootRef = useRef(null);
  // Desktop-only focus expand: focused empty/one-line input grows to two lines (animated via CSS).
  const [focusExpand, setFocusExpand] = useState(false);
  const focusExpandRef = useRef(false);

  const resizeInput = (focused) => {
    const ta = inputRef?.current;
    if (!ta) return;
    resizeChatTextarea(ta, { focused });
  };
  const applyFocusExpand = (on) => {
    focusExpandRef.current = on;
    setFocusExpand(on);
    resizeInput(on);
  };

  useEffect(() => () => {
    const rec = recRef.current;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try { rec.abort(); } catch {}
      recRef.current = null;
    }
  }, []);

  // 把 ChatInputBar 顶部到视口底部的距离写到 document CSS 变量 --chat-input-bar-height。
  // 用于移动端 .panelGlobal（Mobile.jsx 全局渲染，不在 .inputStack 内）动态上浮。
  //
  // 必须使用 getBoundingClientRect() 而非 offsetHeight，因为 mobileChatInner 在手机端
  // 有 zoom:0.6 / scale(0.6) 缩放，而 .panelGlobal 在缩放容器外用 viewport px 定位。
  // getBoundingClientRect 已包含所有 transform/zoom 效果，属视口坐标。
  //
  // 视口高度必须用 visualViewport.height（iOS Safari 键盘开启时 window.innerHeight
  // 不会变，interactive-widget=resizes-content 在 WebKit 不生效，只有 visualViewport
  // 才反映真实可视区）。fallback 到 innerHeight 是为了不支持 visualViewport 的环境。
  //
  // useLayoutEffect 同步首次写入避免首帧竞态；只监听 visualViewport.resize（iOS 键盘升降），
  // 不监听 scroll —— scroll 在 iOS 动量滚动期间每帧触发，会让面板随惯性抖动。
  //
  // 依赖 [terminalVisible]：terminalVisible=true 时本组件早期 return null/chip，
  // <div ref={rootRef}> 不再渲染，rootRef.current 变成 null。若依赖留空 []，
  // 旧 effect 的 cleanup 不会触发，闭包里的 el 仍指向已脱离 DOM 的旧元素；后续
  // visualViewport.resize（开 Terminal 时 transform transition / iOS 键盘 / 浏览器
  // 工具栏抖动均会触发）调用 setVar，对脱离 DOM 的元素 getBoundingClientRect() 返回
  // {top:0,...}，让 distFromBottom = vh（≈ 800px），写入 --chat-input-bar-height: 800px，
  // 把 .panelGlobal 的 bottom 顶到 812px 飞出屏幕。改为 [terminalVisible] 后，切换时
  // 旧 listener 正确 disconnect，新 effect 拿到当前 rootRef；null 时清除 CSS 变量让
  // .panelGlobal 回退 fallback 200px（max() 兜底 56px），即 Terminal 模式下 modal
  // 自然贴底 212px。
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) {
      document.documentElement.style.removeProperty('--chat-input-bar-height');
      return;
    }
    // 折算祖先 zoom：Android WebView 在 zoom 容器内 getBoundingClientRect() 给的是 zoom 前 layout
    // 坐标，乘 parentZoom 才是视觉坐标；Chrome/Safari/iPad（zoom=1 或 pad-mode 覆盖回 1）天然
    // parentZoom=1，乘 1 等价于不动。每次 setVar 重读，支持运行时 mobile↔pad 切换。
    const findParentZoom = () => {
      let p = el.parentElement;
      while (p) {
        const z = parseFloat(getComputedStyle(p).zoom);
        if (z && z > 0 && z !== 1) return z;
        p = p.parentElement;
      }
      return 1;
    };
    const setVar = () => {
      // 防御 stale el：极端情况下 RO / vv callback 可能在 el 卸载后的下一轮派发仍触发。
      // isConnected 兜底 detached 节点；w=h=0 兜底 display:none 祖先（attached 但无 layout box）。
      if (!el.isConnected) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const visualTop = rect.top * findParentZoom();
      const distFromBottom = vh - visualTop;
      // 拒绝异常量测（rect.top ≥ vh 让 distFromBottom ≤ 0）；正常小输入栏 ≥ 50px 远高于阈值。
      if (distFromBottom < 5) return;
      document.documentElement.style.setProperty('--chat-input-bar-height', distFromBottom + 'px');
    };
    setVar();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(setVar);
      ro.observe(el);
    }
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', setVar);
    }
    window.addEventListener('resize', setVar);
    return () => {
      if (ro) ro.disconnect();
      if (vv) {
        vv.removeEventListener('resize', setVar);
      }
      window.removeEventListener('resize', setVar);
    };
  }, [terminalVisible]);

  useEffect(() => {
    if (terminalVisible && recRef.current) {
      try { recRef.current.abort(); } catch {}
    }
  }, [terminalVisible]);

  const startRecording = () => {
    if (!SpeechRec || recRef.current) return;
    const ta = inputRef?.current;
    if (!ta) return;
    const pos = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
    anchorRef.current = { prefix: ta.value.slice(0, pos), suffix: ta.value.slice(pos) };

    let rec;
    try { rec = new SpeechRec(); } catch (err) {
      console.error('[CC Viewer] SpeechRecognition init failed:', err);
      return;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = SPEECH_LANG_MAP[getLang()] || 'en-US';

    rec.onresult = (event) => {
      const t2 = inputRef?.current;
      if (!t2) return;
      const { prefix, suffix } = anchorRef.current;
      // 外部(Tab补全/发送/ClearContext)改过 textarea.value 就放弃合并，避免把已发送的内容写回
      if (!t2.value.startsWith(prefix) || !t2.value.endsWith(suffix)) {
        try { rec.abort(); } catch {}
        return;
      }
      let interim = '';
      let finalAcc = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const transcript = r[0]?.transcript ?? '';
        if (r.isFinal) finalAcc += transcript;
        else interim += transcript;
      }
      t2.value = prefix + finalAcc + suffix;
      resizeChatTextarea(t2, { focused: focusExpandRef.current });
      setInterimText(interim);
      onChange?.({ target: t2 });
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        try { alert(t('ui.chatInput.voicePermissionDenied')); } catch {}
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('[CC Viewer] SpeechRecognition error:', event.error);
      }
    };
    rec.onend = () => {
      setRecording(false);
      setInterimText('');
      recRef.current = null;
    };

    try {
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (err) {
      console.error('[CC Viewer] SpeechRecognition start failed:', err);
    }
  };

  const stopRecording = () => {
    try { recRef.current?.stop(); } catch {}
  };

  const toggleRecording = () => {
    if (recRef.current) stopRecording(); else startRecording();
  };

  const handleTextareaInput = (e) => {
    if (recRef.current && e.nativeEvent?.inputType && !e.nativeEvent?.isComposing) {
      try { recRef.current.abort(); } catch {}
    }
    onChange?.(e);
  };

  // 统一上传:上传一开始就登记在途占位(onUploadStart),resolve/reject 都结束占位(onUploadEnd)。
  // 这样「上传未完成时按发送」能被 ChatView 的守卫感知并缓发,图绝不漏发。objectURL 所有权移交 ChatView。
  const runUpload = async (file) => {
    const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let previewUrl = null;
    try { if (file.type?.startsWith('image/')) previewUrl = URL.createObjectURL(file); } catch {}
    onUploadStart?.(id, file.name, previewUrl);
    try {
      const path = await uploadFileAndGetPath(file);
      onUploadPath?.(path);
      onUploadEnd?.(id, path);
    } catch (err) {
      console.error('[CC Viewer] Upload failed:', err);
      onUploadEnd?.(id, null);
    }
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        await runUpload(file);
        return;
      }
    }
  };

  // 关闭 [+] 菜单的统一出口：清 hover-intent 定时器 + 收起级联展开行
  const closePlusMenu = () => {
    qmHover.cancel();
    setQuickExpanded(null);
    setPlusOpen(false);
  };

  // 「上传文件」菜单项：桌面/移动两个菜单分支共用
  const handleUploadPick = () => {
    closePlusMenu();
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await runUpload(file);
    };
    input.click();
  };

  if (terminalVisible) {
    if (!inputSuggestion) return null;
    return (
      <div className={styles.suggestionChip} onClick={onSuggestionClick}>
        <span className={styles.suggestionChipText}>{inputSuggestion}</span>
        <span className={styles.suggestionChipAction}>↵</span>
      </div>
    );
  }

  return (
    <div className={styles.chatInputBar} ref={rootRef}>
      <div className={styles.chatInputWrapper}>
        <div className={styles.chatTextareaWrap}>
          {((pendingImages && pendingImages.length > 0) || (uploadingItems && uploadingItems.length > 0)) && (
            <div className={styles.imagePreviewStrip}>
              {pendingImages.map((img, i) => {
                const fileName = img.path.split('/').pop() || img.path;
                const isImage = /\.(png|jpe?g|gif|svg|bmp|webp|avif|ico|icns)$/i.test(fileName);
                const src = apiUrl(`/api/file-raw?path=${encodeURIComponent(img.path)}`);
                return isImage ? (
                  <div key={img.path} className={styles.imagePreviewItem}>
                    <img
                      src={src}
                      className={styles.imagePreviewThumb}
                      alt={fileName}
                      role="button"
                      tabIndex={0}
                      onClick={() => setLightbox({ src, alt: fileName })}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox({ src, alt: fileName }); } }}
                    />
                    <ConfirmRemoveButton
                      title={t('ui.chatInput.confirmRemoveImage')}
                      onConfirm={() => onRemovePendingImage?.(i)}
                      className={styles.imagePreviewRemove}
                      ariaLabel={t('ui.chatInput.removeImage')}
                    >&times;</ConfirmRemoveButton>
                  </div>
                ) : (
                  <div key={img.path} className={styles.filePreviewChip}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className={styles.filePreviewName}>{fileName}</span>
                    <ConfirmRemoveButton
                      title={t('ui.chatInput.confirmRemoveFile')}
                      onConfirm={() => onRemovePendingImage?.(i)}
                      className={styles.filePreviewClose}
                      ariaLabel={t('ui.chatInput.removeImage')}
                    >&times;</ConfirmRemoveButton>
                  </div>
                );
              })}
              {uploadingItems && uploadingItems.map(item => (
                <div
                  key={item.id}
                  className={`${styles.imagePreviewItem} ${styles.imagePreviewUploading}`}
                  title={t('ui.chatInput.uploading')}
                  aria-label={t('ui.chatInput.uploading')}
                >
                  {item.previewUrl && (
                    <img src={item.previewUrl} className={styles.imagePreviewThumb} alt="" aria-hidden="true" />
                  )}
                  <div className={styles.imagePreviewSpinner}><Spin size="small" /></div>
                </div>
              ))}
            </div>
          )}
          <div className={styles.textareaWithGhost}>
            <textarea
              ref={inputRef}
              className={`${styles.chatTextarea}${focusExpand ? ` ${styles.chatTextareaFocused}` : ''}`}
              placeholder={inputSuggestion ? '' : t('ui.chatInput.placeholder')}
              rows={1}
              onKeyDown={onKeyDown}
              onInput={handleTextareaInput}
              onPaste={handlePaste}
              onFocus={() => applyFocusExpand(true)}
              onBlur={() => applyFocusExpand(false)}
            />
            {inputSuggestion && inputEmpty && (
              <div className={styles.ghostText}>{inputSuggestion}</div>
            )}
            {recording && interimText && (
              <div className={styles.interimPreview}>{interimText}</div>
            )}
          </div>
        </div>
        <div className={styles.chatInputBottom}>
          <div className={styles.chatInputBottomLeft}>
          <div className={styles.plusArea}>
            <button className={`${styles.plusBtn}${plusOpen ? ` ${styles.plusBtnOpen}` : ''}`} onClick={() => (plusOpen ? closePlusMenu() : setPlusOpen(true))} title={!isMobile ? t('ui.terminal.quickSettings') : t('ui.chatInput.more')}>
              {!isMobile ? <span className={styles.plusGlyph} style={SPARKLE_MASK_STYLE} aria-hidden="true" /> : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              )}
            </button>
            {plusOpen && (
              <>
              <div className={styles.plusOverlay} onClick={closePlusMenu} />
              <div className={`${styles.plusMenu}${!isMobile ? ` ${styles.plusMenuQuick}` : ''}`}>
                {!isMobile ? (
                  <>
                    {/* 桌面：与终端工具栏四芒星菜单同款级联结构（共享 QuickAutoApproveRows）。
                        改值必须走 AppBase handler（经 ChatView 钻取的 onAutoApproveChange /
                        onPlanAutoApproveChange），原因见组件内注释 */}
                    <QuickAutoApproveRows
                      autoApproveSeconds={autoApproveSeconds}
                      planAutoApproveSeconds={planAutoApproveSeconds}
                      onAutoApproveChange={onAutoApproveChange}
                      onPlanAutoApproveChange={onPlanAutoApproveChange}
                      expandedKey={quickExpanded}
                      onToggle={setQuickExpanded}
                      onHoverEnter={qmHover.enter}
                      onHoverLeave={qmHover.leave}
                    />
                    {/* AgentTeam ▸：自定义快捷方式 + 预设列表。AgentTeam 启动时默认开启；
                        仅当用户显式关闭（export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0）时整组隐藏 */}
                    {agentTeamEnabled && (
                      <div
                        className={`${chrome.quickMenuGroup} ${quickExpanded === 'agentteam' ? chrome.quickMenuGroupOpen : ''}`}
                        onMouseEnter={() => qmHover.enter('agentteam')}
                        onMouseLeave={() => qmHover.leave('agentteam')}
                      >
                        <button className={chrome.quickMenuRow} onClick={() => setQuickExpanded(quickExpanded === 'agentteam' ? null : 'agentteam')}>
                          <span className={chrome.quickMenuRowIcon}><AgentTeamIcon /></span>
                          <span className={chrome.quickMenuLabel}>{t('ui.terminal.agentTeam')}</span>
                          <span className={chrome.quickMenuCaret}>▸</span>
                        </button>
                        <div className={chrome.quickMenuSubWrap}>
                          <div className={chrome.quickMenuSub}>
                            {onOpenPresetModal && (
                              <button className={`${styles.plusMenuItem} ${styles.plusMenuItemMuted} ${styles.quickMenuPresetItem}`} onClick={() => { closePlusMenu(); onOpenPresetModal(); }}>
                                {t('ui.terminal.customShortcuts')}
                              </button>
                            )}
                            {(presetItems || []).map(item => {
                              const isBuiltinRaw = item.builtinId && !item.modified;
                              const name = isBuiltinRaw ? t(item.teamName) : item.teamName;
                              const desc = isBuiltinRaw ? t(item.description) : item.description;
                              return (
                                <button key={item.id} className={`${styles.plusMenuItem} ${styles.quickMenuPresetItem}`} onClick={() => { closePlusMenu(); onPresetSend?.(desc); }} title={desc}>
                                  {name || desc}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* 移动端：保持原平铺菜单，仅 UltraPlan 移出为输入栏独立按钮 */}
                    {presetItems && presetItems.length > 0 && onOpenPresetModal && (
                      <button className={`${styles.plusMenuItem} ${styles.plusMenuItemMuted}`} onClick={() => { closePlusMenu(); onOpenPresetModal(); }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                        <span className={styles.presetLabel}>{t('ui.terminal.customShortcuts')}</span>
                      </button>
                    )}
                    {presetItems && presetItems.length > 0 && presetItems.map(item => {
                      const isBuiltinRaw = item.builtinId && !item.modified;
                      const name = isBuiltinRaw ? t(item.teamName) : item.teamName;
                      const desc = isBuiltinRaw ? t(item.description) : item.description;
                      return (
                        <button key={item.id} className={styles.plusMenuItem} onClick={() => {
                          closePlusMenu();
                          onPresetSend?.(desc);
                        }} title={desc}>
                          <AgentTeamIcon />
                          <span className={styles.presetLabel}>{name || desc}</span>
                        </button>
                      );
                    })}
                    {onClearContext && (
                      <button className={styles.plusMenuItem} onClick={() => { closePlusMenu(); onClearContext(); }}>
                        <TrashIcon />
                        <span>{t('ui.chatInput.clearContext')}</span>
                      </button>
                    )}
                    <button className={styles.plusMenuItem} onClick={handleUploadPick}>
                      <UploadIcon />
                      <span>{t('ui.terminal.upload')}</span>
                    </button>
                  </>
                )}
              </div>
              </>
            )}
          </div>
          {/* UltraPlan / 上传 / 清空上下文平铺为输入栏独立圆钮（顺序与终端工具栏一致）；
              移动端按需求只外置 UltraPlan，上传/清空仍留在 [+] 平铺菜单内。
              桌面 ultraplanPopover 由 ChatView 组装（终端同款 UltraplanPanel + 守卫），
              按钮点击走 onOpenUltraPlan 开、onOpenChange 只关——镜像终端单向模式 */}
          {onOpenUltraPlan && (ultraplanPopover ? (
            <Popover
              trigger="click"
              placement="top"
              overlayClassName="ccv-ultraplan-popover"
              open={ultraplanPopover.open}
              onOpenChange={ultraplanPopover.onOpenChange}
              overlayInnerStyle={ultraplanPopover.overlayInnerStyle}
              content={ultraplanPopover.content}
            >
              <button className={`${styles.plusBtn}${ultraplanPopover.open ? ` ${styles.plusBtnUltraOpen}` : ''}`} title="UltraPlan" onClick={onOpenUltraPlan}>
                <span className={styles.plusGlyph} style={ULTRAPLAN_MASK_STYLE} aria-hidden="true" />
              </button>
            </Popover>
          ) : (
            <button className={styles.plusBtn} title="UltraPlan" onClick={onOpenUltraPlan}>
              <UltraplanIcon />
            </button>
          ))}
          {!isMobile && (
            <button className={styles.plusBtn} title={t('ui.terminal.upload')} onClick={handleUploadPick}>
              <UploadIcon />
            </button>
          )}
          {!isMobile && onClearContextNow && (() => {
            // 与终端工具栏清空按钮同款 Popconfirm 气泡确认（非居中 Modal）：
            // i18n 是单句 "X？Y。" 结构，按 ? / ？ 拆成 title + description 以换行呈现
            const confirmFull = t('ui.chatInput.clearContextConfirm');
            const qIdx = Math.max(confirmFull.indexOf('？'), confirmFull.indexOf('?'));
            const confirmTitle = qIdx > 0 ? confirmFull.slice(0, qIdx + 1) : confirmFull;
            const confirmDesc = qIdx > 0 ? confirmFull.slice(qIdx + 1).trim() : null;
            return (
              <Popconfirm
                title={confirmTitle}
                description={confirmDesc}
                okText={t('ui.chatInput.clearContext')}
                cancelText={t('ui.common.confirmCancel')}
                okButtonProps={{ danger: true }}
                placement="top"
                onConfirm={onClearContextNow}
              >
                <button className={styles.plusBtn} title={t('ui.chatInput.clearContext')}>
                  <TrashIcon />
                </button>
              </Popconfirm>
            );
          })()}
          {SpeechRec && (
            <button
              type="button"
              className={`${styles.micBtn}${recording ? ` ${styles.micBtnRecording}` : ''}`}
              onClick={toggleRecording}
              title={t(recording ? 'ui.chatInput.voiceStop' : 'ui.chatInput.voiceStart')}
              aria-label={t(recording ? 'ui.chatInput.voiceStop' : 'ui.chatInput.voiceStart')}
              aria-pressed={recording}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
          )}
          </div>
          {/* 中段：血条 portal slot；终端关闭 + 非纯移动端时挂在左/右控件之间，
              flex-basis 200 + flex-shrink 1 自适应填充至 200px 上限；AppHeader 通过 createPortal 把 LiveTagPopover 渲染进来 */}
          {!(isMobile && !isPad) && !terminalVisible && setContextBarSlot && (
            <div className={styles.ctxBarSlot} ref={setContextBarSlot} />
          )}
          <div className={styles.chatInputBottomRight}>
          <div className={styles.chatInputHint}>
            {(isMobile && !isPad)
              ? null
              : (inputSuggestion && inputEmpty ? t('ui.chatInput.hintTab') : t('ui.chatInput.hintEnter'))}
          </div>
          <div className={styles.sendBtnWrap}>
            {isStreaming && onStop ? (
              <button
                type="button"
                className={styles.sendBtn}
                onClick={onStop}
                title={t('ui.chatInput.stop')}
                aria-label={t('ui.chatInput.stop')}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
                </svg>
              </button>
            ) : sendDeferred ? (
              <button
                type="button"
                className={`${styles.sendBtn} ${styles.sendBtnDisabled}`}
                disabled
                title={t('ui.chatInput.uploading')}
                aria-label={t('ui.chatInput.uploading')}
              >
                <Spin size="small" />
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.sendBtn} ${inputEmpty && !(pendingImages?.length) ? styles.sendBtnDisabled : ''}`}
                onClick={onSend}
                disabled={inputEmpty && !(pendingImages?.length)}
                title={t('ui.chatInput.send')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
          </div>
        </div>
      </div>
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

export default ChatInputBar;
