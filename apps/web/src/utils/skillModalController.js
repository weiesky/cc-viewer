// Skill 管理弹窗的「开关 / 永久删除」共享控制器。
// AppHeader 与 Mobile 是同形态的类组件（同样的 state._skillsModal / state._fsSkills、
// this.setState、this.reloadFsSkills()），原本各持一份逐字相同的 handler，极易漂移
// （评审已发现 Mobile 漏了一条镜像注释）。这里抽成以组件实例为 host 的纯函数，两端只留一行委派。
// ImSkillsModal 是函数组件 + IM 端点 + _tr 文案，状态形态不同，刻意不并入。
import { message } from 'antd';
import { apiUrl } from './apiUrl';
import { t } from '../i18n';
import { skillKey, skillOrderKey } from './skillsParser';

// 把 reload 的权威结果按当前显示顺序（skillOrderKey 保位）合并回 _skillsModal.skills。
// skillOrderKey 只取 source+name（开关/删除都不改它），所以行原地不动；modal 没见过的新条目排末尾。
export function mergePreservingOrder(prevSkills, resultSkills) {
  const orderMap = new Map(prevSkills.map((s, i) => [skillOrderKey(s), i]));
  return [...resultSkills].sort((a, b) => {
    const ai = orderMap.get(skillOrderKey(a));
    const bi = orderMap.get(skillOrderKey(b));
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}

// 切换 skill 启用状态：乐观翻 Switch + 失败回滚 + reload 保位对齐。
export async function handleSkillToggle(host, skill) {
  const key = skillKey(skill);
  if (host.state._skillsModal?.toggling?.has(key)) return;
  const enable = !skill.enabled;
  // 用 skillKey（含 path）匹配——同名同 source 的重复两份路径不同，只翻被点那行，不牵连孪生。
  const flipEnabled = (target) => (s) => (skillKey(s) === key) ? { ...s, enabled: target } : s;
  host.setState(prev => {
    const next = new Set(prev._skillsModal.toggling); next.add(key);
    return { _skillsModal: { ...prev._skillsModal, toggling: next, skills: prev._skillsModal.skills.map(flipEnabled(enable)) } };
  });
  try {
    const r = await fetch(apiUrl('/api/skills/toggle'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: skill.source, name: skill.name, enable }),
    });
    const data = await r.json();
    if (!r.ok) {
      host.setState(prev => ({ _skillsModal: { ...prev._skillsModal, skills: prev._skillsModal.skills.map(flipEnabled(!enable)) } }));
      if (data.code === 'DUPLICATE') message.error(t('ui.skillToggleDuplicate', { name: skill.name }));
      else message.error(t('ui.skillToggleFailed', { reason: data.error || 'unknown' }));
      return;
    }
    // 乐观翻 _fsSkills（popover chip 源）里这条的 enabled——reload 失败也能立即反映用户动作；
    // reload 成功会用权威数据覆盖。
    host.setState(prev => ({
      _fsSkills: Array.isArray(prev._fsSkills)
        ? prev._fsSkills.map(s => (skillKey(s) === key) ? { ...s, enabled: enable } : s)
        : prev._fsSkills,
    }));
    const result = await host.reloadFsSkills();
    if (result.ok) {
      host.setState(prev => ({ _skillsModal: { ...prev._skillsModal, skills: mergePreservingOrder(prev._skillsModal.skills, result.skills) } }));
    }
  } catch (e) {
    host.setState(prev => ({ _skillsModal: { ...prev._skillsModal, skills: prev._skillsModal.skills.map(flipEnabled(!enable)) } }));
    message.error(t('ui.skillToggleFailed', { reason: e.message }));
  } finally {
    host.setState(prev => {
      const next = new Set(prev._skillsModal.toggling); next.delete(key);
      return { _skillsModal: { ...prev._skillsModal, toggling: next } };
    });
  }
}

// 永久删除单个 skill：成功后乐观移除该行 + reload 保位对齐。
// reload 合并回 _skillsModal.skills 很关键：否则删掉「重复对」其中一份后，存活那行仍带旧
// duplicate ⚠ 徽标，要等关弹窗重开才消失（listSkills 重算后该标记自然清掉）。
export async function handleSkillDelete(host, skill) {
  const key = skillKey(skill);
  // 复用 toggling Set 作「该行操作进行中」标记：防二次确认后的连点重入，
  // 并让 SkillsManagerModal 在删除期间给删除按钮转圈 + 禁用同行 Switch（与 toggle 一致的忙态反馈）。
  if (host.state._skillsModal?.toggling?.has(key)) return;
  host.setState(prev => {
    const next = new Set(prev._skillsModal.toggling); next.add(key);
    return { _skillsModal: { ...prev._skillsModal, toggling: next } };
  });
  try {
    const r = await fetch(apiUrl('/api/skills/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: skill.source, name: skill.name, enabled: skill.enabled }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      message.error(t('ui.skillDeleteFailed', { reason: data.error || 'unknown' }));
      return;
    }
    message.success(t('ui.skillDeleteSuccess', { name: skill.name }));
    host.setState(prev => ({
      _skillsModal: { ...prev._skillsModal, skills: (prev._skillsModal.skills || []).filter(s => skillKey(s) !== key) },
      _fsSkills: Array.isArray(prev._fsSkills) ? prev._fsSkills.filter(s => skillKey(s) !== key) : prev._fsSkills,
    }));
    const result = await host.reloadFsSkills();
    if (result.ok) {
      host.setState(prev => ({ _skillsModal: { ...prev._skillsModal, skills: mergePreservingOrder(prev._skillsModal.skills, result.skills) } }));
    }
  } catch (e) {
    message.error(t('ui.skillDeleteFailed', { reason: e.message }));
  } finally {
    host.setState(prev => {
      const next = new Set(prev._skillsModal.toggling); next.delete(key);
      return { _skillsModal: { ...prev._skillsModal, toggling: next } };
    });
  }
}
