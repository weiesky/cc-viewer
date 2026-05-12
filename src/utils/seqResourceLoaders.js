// 三态加载 + seq 防污 共用实现（class 组件用）。
// 三态契约：state[key] === null  → 未加载（loading）
//          state[key] === false → 加载失败
//          state[key] === <data> → 加载成功
// 组件 instance 上必须存在 `_<name>Seq` 计数字段（constructor 初始化为 0）。
// workspace 切换时 componentDidUpdate 应 `++this._<name>Seq` 失效在途请求。
//
// ─── 抽取边界（有意为之，请勿扩张）────────────────────────────────────────────
// 这里**只覆盖 lazy-load 静默路径**：组件首次挂载/workspace 切换时自动 fire，失败
// 落 false 让上游 chip / popover 进入空态。
// 用户主动触发的 refresh（带 toast、loading spinner、错误 message）刻意保留在
// AppHeader.jsx (handleRefreshMemory) / Mobile.jsx 各自的 inline 实现里，原因：
//   1) 主动 refresh 需要 caller 决定 toast 文案、loading 视觉、错误反馈策略；
//      若硬塞进 loader 内部，loader 必须 import message → 反向耦合 antd UI 层。
//   2) loadMemoryDetail / loadClaudeMdDetail 也是用户点击驱动，含「成功后跳详情面板」
//      副作用，同样不属于"加载即更新 state"语义，留 caller 自管更清晰。
// 即：本文件 = 静默路径，inline = 用户触发路径。两者并存是设计选择，不是抽取漏。
// ────────────────────────────────────────────────────────────────────────────

import { apiUrl } from './apiUrl.js';

async function _seqGuardedFetch(component, seqProp, url) {
  const seq = ++component[seqProp];
  let r;
  try {
    r = await fetch(url);
  } catch (e) {
    if (seq !== component[seqProp]) return { stale: true };
    return { stale: false, ok: false, error: e, errorKind: 'network' };
  }
  try {
    const data = await r.json();
    if (seq !== component[seqProp]) return { stale: true };
    return { stale: false, ok: r.ok, status: r.status, data };
  } catch (e) {
    if (seq !== component[seqProp]) return { stale: true };
    return { stale: false, ok: false, error: e, errorKind: 'parse', status: r.status };
  }
}

// 拉取项目文件系统 skills。
// 失败时若 _fsSkills 已是数组（前次成功结果）→ 保留不 clobber，
// 避免 popover chip 从乐观态回退到历史空态。
// 返回 { ok: true, skills } / { ok: false, reason: 'local_log'|'stale'|'http:NNN'|'network'|'parse'|<server msg> }
export async function loadFsSkills(component, { isLocalLog } = {}) {
  if (isLocalLog) return { ok: false, reason: 'local_log' };
  const res = await _seqGuardedFetch(component, '_fsSkillsSeq', apiUrl('/api/skills'));
  if (res.stale) return { ok: false, reason: 'stale' };
  if (res.error) {
    component.setState(prev => ({ _fsSkills: Array.isArray(prev._fsSkills) ? prev._fsSkills : false }));
    return { ok: false, reason: res.errorKind || res.error.message || 'network' };
  }
  if (!res.ok || !res.data?.ok || !Array.isArray(res.data?.skills)) {
    const reason = (res.data && res.data.error) || `http:${res.status}`;
    component.setState(prev => ({ _fsSkills: Array.isArray(prev._fsSkills) ? prev._fsSkills : false }));
    return { ok: false, reason };
  }
  component.setState({ _fsSkills: res.data.skills });
  return { ok: true, skills: res.data.skills };
}

// 拉取项目入口 MEMORY.md。lazy-load 失败静默回退 false；用户主动刷新走 handleRefreshMemory（带 toast）。
export async function loadProjectMemory(component) {
  const res = await _seqGuardedFetch(component, '_memorySeq', apiUrl('/api/project-memory'));
  if (res.stale) return;
  if (res.error || !res.ok) { component.setState({ _memory: false }); return; }
  component.setState({ _memory: res.data });
}

// 拉取 CLAUDE.md 候选清单。三态：null/false/[]/[{id,scope,tail,...}]。
export async function loadClaudeMdList(component) {
  const res = await _seqGuardedFetch(component, '_claudeMdSeq', apiUrl('/api/claude-md'));
  if (res.stale) return;
  if (res.error || !res.ok || !Array.isArray(res.data?.entries)) {
    component.setState({ _claudeMd: false });
    return;
  }
  component.setState({ _claudeMd: res.data.entries });
}
