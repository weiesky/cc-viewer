import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch, Slider, Select, Button, message, Tooltip } from 'antd';
import { PlayCircleOutlined, UploadOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { previewEvent, stopPreview, unlockAudio } from '../../utils/voicePackPlayer';
import { EVENT_KEYS, DEFAULT_BINDINGS } from '@ccv/core/voice-pack-events';
import styles from './VoicePackSettings.module.css';

// User-visible list — order matters (rendered top to bottom). EVENT_KEYS is the
// single source of truth(: was duplicated in 5+ files).
const EVENT_LIST = EVENT_KEYS;

const _tr = (key, params, fallback) => {
  try {
    const r = t(key, params);
    return (r && r !== key) ? r : fallback;
  } catch { return fallback; }
};

/**
 * Voice-pack configuration panel.
 *
 * Props:
 *   - prefs: voicePack state { enabled, volume, events: {...} }
 *   - onChange: deep-merge handler (AppBase.handleVoicePackChange)
 *
 * Self-contained: fetches the user-audio list from /api/voice-pack/list on mount
 * and after every upload/delete, so other tabs that change the list stay in sync
 * the next time this panel re-mounts. The list is keyed by audio id (uuid).
 */
export default function VoicePackSettings({ prefs, onChange, embedded = false }) {
  const safePrefs = prefs || {};
  // embedded 模式下父级（合并后的"审批提示音"开关）已经 gate 了组件是否渲染，
  // 内部强制视为 enabled=true 避免 state 短暂不一致时（如 hydrate 迁移瞬间）出现空区域。
  const enabled = embedded ? true : safePrefs.enabled === true;
  const volume = typeof safePrefs.volume === 'number' ? safePrefs.volume : 0.3;
  const events = safePrefs.events || {};

  const [userAudio, setUserAudio] = useState([]);
  // bundledPacks: array of { id, displayName, placeholder, events: [...] } from
  // /api/voice-pack/list. Drives the dropdown's bundled section so adding a new
  // pack on the server side surfaces automatically without front-end edits.
  const [bundledPacks, setBundledPacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(apiUrl('/api/voice-pack/list'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setUserAudio(Array.isArray(data.userAudio) ? data.userAudio : []);
      // Prefer new bundledPacks shape; fall back to legacy defaultPack /
      // defaultPackPlaceholder fields if an older server is still on the wire.
      if (Array.isArray(data.bundledPacks) && data.bundledPacks.length > 0) {
        setBundledPacks(data.bundledPacks);
      } else {
        setBundledPacks([{
          id: 'default',
          displayName: _tr('ui.voicePack.binding.default', null, 'Default (built-in)'),
          placeholder: !!data.defaultPackPlaceholder,
          events: Array.isArray(data.defaultPack) ? data.defaultPack : [],
        }]);
      }
    } catch (e) {
      // Silently degrade — only show toast on user-initiated actions, not background fetch.
      console.warn('[voicePack] list failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Bind any user gesture inside this panel to autoplay unlock (one-shot).
  // Most reliable trigger is the first switch toggle or preview click.
  const tryUnlock = useCallback(() => { try { unlockAudio(); } catch { /* ignore */ } }, []);

  const handleEnabledChange = (next) => {
    tryUnlock();
    onChange && onChange({ enabled: !!next });
  };

  const handleVolumeChange = (next) => {
    onChange && onChange({ volume: Math.max(0, Math.min(1, Number(next) || 0)) });
  };

  const handleBindingChange = (eventKey, value) => {
    // 'disabled' UI option maps to null on the wire (player skips events whose binding is null).
    const wire = value === 'disabled' ? null : value;
    onChange && onChange({ events: { [eventKey]: wire } });
  };

  const handlePreview = (eventKey) => {
    tryUnlock();
    // Build a synthetic prefs blob that uses the *current* binding for this event,
    // so preview reflects what the user just selected without waiting for a server round-trip.
    const previewPrefs = { ...safePrefs, volume };
    previewEvent(eventKey, previewPrefs);
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      message.error(_tr('ui.voicePack.uploadTooLarge', null, 'File too large (max 2MB)'));
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(apiUrl('/api/voice-pack/upload'), { method: 'POST', body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (r.status === 415) {
          message.error(_tr('ui.voicePack.uploadBadFormat', null, 'Unsupported format (mp3/wav/ogg/m4a only)'));
        } else if (r.status === 413) {
          message.error(_tr('ui.voicePack.uploadTooLarge', null, 'File too large (max 2MB)'));
        } else {
          message.error(body.error || _tr('ui.voicePack.uploadFailed', null, 'Upload failed'));
        }
        return;
      }
      message.success(_tr('ui.voicePack.uploadSuccess', null, 'Uploaded'));
      await fetchList();
    } catch (err) {
      message.error(_tr('ui.voicePack.uploadFailed', null, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAudio = async (id) => {
    stopPreview();
    try {
      const r = await fetch(apiUrl(`/api/voice-pack/delete/${encodeURIComponent(id)}`), { method: 'DELETE' });
      if (!r.ok) {
        message.error(_tr('ui.voicePack.deleteFailed', null, 'Delete failed'));
        return;
      }
      // Local optimistic update for the events table — any event that referenced the
      // freshly-deleted id falls back to the static DEFAULT_BINDINGS (not locale-aware).
      // 用 schema 字面量而非 locale-aware 默认 — 删除 uploaded audio 是局部清理动作,
      // 不该把用户曾经手动选过的 pack 再 re-seed 成 locale 默认（zh 用户手动切回 butler
      // 后再删自定义音,不应突然回到 sanguo）。
      const patchEvents = {};
      for (const k of EVENT_LIST) {
        if (events[k] === id) patchEvents[k] = DEFAULT_BINDINGS[k];
      }
      if (Object.keys(patchEvents).length > 0 && onChange) {
        onChange({ events: patchEvents });
      }
      await fetchList();
    } catch {
      message.error(_tr('ui.voicePack.deleteFailed', null, 'Delete failed'));
    }
  };

  // Build select options as antd OptGroup-style nested options.
  // Order: Bundled (default + sanguo + …) → Uploaded → Disabled. Disabled lives
  // at the bottom since it's the destructive-ish action.
  const audioOptions = useMemo(() => {
    const placeholderSuffix = _tr('ui.voicePack.binding.placeholder', null, 'placeholder');
    const bundledOptions = bundledPacks.map((pack) => {
      // Per-pack i18n key first (ui.voicePack.pack.<id>), then server-provided
      // displayName, then the pack id as last-resort.
      const i18nLabel = _tr(`ui.voicePack.pack.${pack.id}`, null, '');
      const baseLabel = i18nLabel || pack.displayName || pack.id;
      const label = pack.placeholder ? `${baseLabel} · ${placeholderSuffix}` : baseLabel;
      return { value: pack.id, label };
    });
    const uploadedOptions = userAudio.map((a) => ({
      value: a.id,
      label: `📁 ${a.originalName}`,
    }));
    const groups = [{
      label: _tr('ui.voicePack.group.bundled', null, 'Bundled'),
      options: bundledOptions,
    }];
    if (uploadedOptions.length > 0) {
      groups.push({
        label: _tr('ui.voicePack.group.uploaded', null, 'Uploaded'),
        options: uploadedOptions,
      });
    }
    groups.push({
      label: _tr('ui.voicePack.group.other', null, 'Other'),
      options: [{ value: 'disabled', label: _tr('ui.voicePack.binding.disabled', null, 'Disabled') }],
    });
    return groups;
  }, [userAudio, bundledPacks]);

  return (
    <div className={styles.container}>
      {!embedded && (
        <div className={styles.headerRow}>
          <span className={styles.headerLabel}>{_tr('ui.voicePack.title', null, 'Voice pack')}</span>
          <Switch checked={enabled} onChange={handleEnabledChange} />
        </div>
      )}

      {enabled && (
        <div className={styles.collapseArea}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{_tr('ui.voicePack.volume', null, 'Volume')}</span>
            <div className={styles.sliderWrap}>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={handleVolumeChange}
                tooltip={{ formatter: (v) => `${Math.round((v || 0) * 100)}%` }}
              />
            </div>
          </div>

          <div className={styles.eventsList}>
            {EVENT_LIST.map((eventKey) => {
              const binding = events[eventKey];
              const selectValue = binding === null || binding === undefined
                ? 'disabled'
                : binding; // 'default' | 'sanguo' | <uuid>
              const eventHint = _tr(`ui.voicePack.eventHint.${eventKey}`, null, '');
              const labelText = _tr(`ui.voicePack.event.${eventKey}`, null, eventKey);
              // Move per-event explanatory text (e.g. turnEnd's 30s cooldown wording)
              // into a hover tooltip — inline `· hint` text was overflowing the
              // settings panel width.
              const labelEl = eventHint ? (
                <Tooltip title={eventHint} placement="topLeft">
                  <span className={`${styles.eventLabel} ${styles.eventLabelHelp}`}>{labelText}</span>
                </Tooltip>
              ) : (
                <span className={styles.eventLabel}>{labelText}</span>
              );
              return (
                <div key={eventKey} className={styles.eventRow}>
                  {labelEl}
                  <Select
                    value={selectValue}
                    options={audioOptions}
                    onChange={(v) => handleBindingChange(eventKey, v)}
                    size="small"
                    className={styles.eventSelect}
                  />
                  <Tooltip title={_tr('ui.voicePack.preview', null, 'Preview')}>
                    <Button
                      size="small"
                      icon={<PlayCircleOutlined />}
                      disabled={selectValue === 'disabled'}
                      onClick={() => handlePreview(eventKey)}
                    />
                  </Tooltip>
                </div>
              );
            })}
          </div>

          <div className={styles.uploadRow}>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,.mp3,.wav,.ogg,.m4a"
              style={{ display: 'none' }}
              onChange={handleFileChosen}
            />
            <Button
              size="small"
              className={styles.uploadBtn}
              icon={<UploadOutlined />}
              loading={uploading}
              onClick={handleUploadClick}
            >
              {_tr('ui.voicePack.upload', null, 'Upload audio')}
            </Button>
            {/* Format/size note moved into a hover tooltip on this info icon —
                inline span pushed the button row onto a second line in narrow panels. */}
            <Tooltip title={_tr('ui.voicePack.uploadHint', null, 'mp3/wav/ogg/m4a · max 2MB')} placement="topLeft">
              <InfoCircleOutlined className={styles.uploadHintIcon} />
            </Tooltip>
          </div>

          {userAudio.length > 0 && (
            <div className={styles.uploadedList}>
              <div className={styles.uploadedTitle}>
                {_tr('ui.voicePack.uploadedTitle', null, 'Uploaded audio')}
              </div>
              {userAudio.map((a) => (
                <div key={a.id} className={styles.uploadedRow}>
                  <span className={styles.uploadedName} title={a.originalName}>
                    {a.originalName}
                  </span>
                  <span className={styles.uploadedMeta}>
                    {(a.size / 1024).toFixed(1)} KB
                  </span>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDeleteAudio(a.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
