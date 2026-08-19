import React, { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';
import SkillsManagerModal from './SkillsManagerModal';
import { apiUrl } from '../../utils/apiUrl';
import { imTr as _tr } from '../../utils/imTr';
import { skillKey } from '../../utils/skillsParser';

// 「${IM} SKILL 管理」的管理弹窗：加载该 IM 的 skills（GET /api/im/:platform/skills），复用 SkillsManagerModal
// 渲染启停开关；toggle → POST /api/im/:platform/skills/toggle、delete → POST .../skills/delete
//（乐观更新 + 失败回滚，参照 AppHeader.handleToggleSkill）。
// SkillsManagerModal 自带 zIndex 1100，会叠在配置弹窗之上、不关闭下层。reloadKey 变化（外部新增 skill 后）→ 重新拉取。
export default function ImSkillsModal({ open, platform, reloadKey, onClose }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState(() => new Set());
  // 请求序号：toggle/delete 后的静默重拉与 open/platform 切换可能并发，用「最新请求胜出」丢弃过期响应，
  // 避免快速切平台时旧响应覆盖新数据（取代原 cancelled 闭包，同时服务静默重拉）。
  const reqIdRef = useRef(0);

  // 拉取该平台 skills。silent=true 不翻整屏 Spin、不写 error——用于 toggle/delete 成功后的「静默对齐」：
  // 服务端 listSkills 会重算 duplicate 标记，删掉重复对一份后存活那行的 ⚠ 徽标才会消失（与共享控制器
  // reloadFsSkills 同语义；ImSkillsModal 是独立函数组件，无法并入控制器，故在此本地实现等价重拉）。
  const reload = useCallback(async (silent = false) => {
    if (!platform) return;
    const myId = ++reqIdRef.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/skills`));
      if (!r.ok) throw new Error(`http:${r.status}`);
      const d = await r.json();
      if (reqIdRef.current !== myId) return; // 已被更晚的请求取代，丢弃过期响应
      setSkills(Array.isArray(d.skills) ? d.skills : []);
    } catch (e) {
      if (reqIdRef.current !== myId) return;
      if (!silent) setError(String(e?.message || 'load_failed'));
      // silent 失败：保留当前（乐观）状态，不打断用户
    } finally {
      if (reqIdRef.current === myId && !silent) setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    if (!open || !platform) return;
    reload(false);
  }, [open, platform, reloadKey, reload]);

  const onToggle = async (skill) => {
    const enable = !skill.enabled;
    const key = skillKey(skill); // 含 path：同名同 source 的重复两份路径不同，不会串台
    if (toggling.has(key)) return;
    const same = (s) => skillKey(s) === key;
    setToggling((prev) => new Set(prev).add(key));
    setSkills((prev) => prev.map((s) => (same(s) ? { ...s, enabled: enable } : s))); // 乐观
    try {
      const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/skills/toggle`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: skill.name, enable }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error || `http:${r.status}`), { code: j.code }); }
      message.success(_tr('ui.im.skillsRestartHint', null, 'Updated — takes effect after you restart this IM'));
      reload(true); // 静默对齐权威态（含 duplicate 标记）
    } catch (e) {
      setSkills((prev) => prev.map((s) => (same(s) ? { ...s, enabled: !enable } : s))); // 回滚
      message.error(e?.code === 'DUPLICATE'
        ? _tr('ui.skillToggleDuplicate', { name: skill.name }, 'Same-named skill exists in both enabled and disabled dirs; remove one copy and retry')
        : _tr('ui.skillToggleFailed', { reason: e?.message || '' }, 'Toggle failed'));
    } finally {
      setToggling((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const onDelete = async (skill) => {
    const key = skillKey(skill);
    if (toggling.has(key)) return; // 防二次确认后连点重入；同时给该行删除按钮转圈
    setToggling((prev) => new Set(prev).add(key));
    try {
      const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/skills/delete`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: skill.name, enabled: skill.enabled }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error || `http:${r.status}`), { code: j.code }); }
      setSkills((prev) => prev.filter((s) => skillKey(s) !== key)); // 乐观移除
      message.success(_tr('ui.skillDeleteSuccess', { name: skill.name }, 'Permanently deleted'));
      reload(true); // 静默重拉：清掉删后存活孪生的 stale ⚠ 徽标
    } catch (e) {
      message.error(_tr('ui.skillDeleteFailed', { reason: e?.message || '' }, 'Delete failed'));
    } finally {
      setToggling((prev) => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  return (
    <SkillsManagerModal open={open} onClose={onClose} loading={loading} error={error} skills={skills} toggling={toggling} onToggle={onToggle} onDelete={onDelete} />
  );
}
