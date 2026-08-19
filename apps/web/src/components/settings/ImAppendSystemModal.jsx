import React, { useState, useEffect } from 'react';
import { Modal, Input, Spin, Button, Popconfirm, message } from 'antd';
import { apiUrl } from '../../utils/apiUrl';
import { imTr as _tr } from '../../utils/imTr';

// 「模型性格定义」编辑器：读/写该 IM 工作目录下的 CC_APPEND_SYSTEM.md（启动 claude 时注入为
// --append-system-prompt-file）。叠加在「通讯软件集成」配置弹窗之上（antd Modal 走 portal 自动堆叠，
// 不关闭下层）；保存/取消后回到配置弹窗。该文件仅在 worker 启动时读取一次，故保存后提示「下次重启该 IM 生效」。
export default function ImAppendSystemModal({ open, platform, onClose }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open || !platform) return undefined;
    let cancelled = false;
    setLoading(true);
    fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/append-system`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
      .then((d) => { if (!cancelled) setContent(typeof d.content === 'string' ? d.content : ''); })
      .catch(() => { if (!cancelled) message.error(_tr('ui.imRecord.loadFailed', null, 'Load failed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, platform]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/append-system`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      message.success(_tr('ui.im.personaSaved', null, 'Saved — takes effect after you restart this IM'));
      onClose();
    } catch (e) {
      message.error(_tr('ui.im.saveFailed', null, 'Save failed') + (e?.message ? `: ${e.message}` : ''));
    } finally {
      setSaving(false);
    }
  };

  // 恢复默认：拉取当前语言的预置文本（?default=1，绕过磁盘文件）载入编辑框，不落盘——由用户点保存才生效。
  const restoreDefault = async () => {
    setRestoring(true);
    try {
      const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/append-system?default=1`));
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      const d = await r.json();
      setContent(typeof d.content === 'string' ? d.content : '');
      message.success(_tr('ui.im.personaRestored', null, 'Loaded the default preset — review and save'));
    } catch (e) {
      message.error(_tr('ui.im.restoreFailed', null, 'Restore failed') + (e?.message ? `: ${e.message}` : ''));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={save}
      okText={_tr('ui.im.save', null, 'Save')}
      cancelText={_tr('ui.cancel', null, 'Cancel')}
      confirmLoading={saving}
      okButtonProps={{ disabled: loading }}
      width={680}
      destroyOnClose
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>{_tr('ui.im.persona', null, 'Model personality')}</span>
          <Popconfirm
            title={_tr('ui.im.restoreDefaultConfirm', null, 'Replace the current text with the default preset? (takes effect after you save)')}
            okText={_tr('ui.ok', null, 'OK')}
            cancelText={_tr('ui.cancel', null, 'Cancel')}
            onConfirm={restoreDefault}
            placement="bottomLeft"
            disabled={saving || restoring || loading}
          >
            <Button size="small" type="link" loading={restoring} disabled={saving || loading} style={{ padding: 0, height: 'auto', fontWeight: 400 }}>
              {_tr('ui.im.restoreDefault', null, 'Restore default')}
            </Button>
          </Popconfirm>
        </div>
      )}
      styles={{ content: { background: 'var(--bg-elevated)' }, header: { background: 'var(--bg-elevated)' } }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><Spin /></div>
      ) : (
        <Input.TextArea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoSize={{ minRows: 16, maxRows: 28 }}
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
        />
      )}
    </Modal>
  );
}
