// 权限审批队列控制器（从 ChatView 抽出，仿 askFlowController 的 host-adapter 模式）。
//
// 处理 ToolApprovalPanel 的 allow / allowSession / deny 三个决策：hook 路径走 ws 发
// perm-hook-answer，PTY 路径走选项点击；每个决策后出队下一个 pending。纯逻辑、可单测。
// state（pendingPermission / permissionQueue）仍留 ChatView.state，经 host 读写。
//
// host 接口：
//   getState()          → 读 pendingPermission / permissionQueue
//   setState(updater)   → 转发宿主 this.setState（支持 functional updater）
//   ws()                → 宿主 this._inputWs（{ readyState, send }）
//   promptOptionClick(n)→ 宿主 this.handlePromptOptionClick（PTY 路径用；该方法属 PTY 簇留宿主）

export class PermissionController {
  constructor(host) {
    this.host = host;
  }

  shiftQueue = () => {
    this.host.setState(state => {
      const next = state.permissionQueue[0] || null;
      return { pendingPermission: next, permissionQueue: state.permissionQueue.slice(1) };
    });
  };

  allow = (id) => {
    const perm = this.host.getState().pendingPermission;
    if (perm?.source === 'pty' && perm.ptyPrompt) {
      const optNum = this._findPtyOptionNumber(perm.ptyPrompt, 'allow');
      this.host.promptOptionClick(optNum);
      this.shiftQueue();
      return;
    }
    const ws = this.host.ws();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'perm-hook-answer', id, decision: 'allow' }));
    }
    this.shiftQueue();
  };

  // 免审批直放：用显式 perm（不依赖 getState/pendingPermission）立即放行。调用方不设置
  // pendingPermission，故不弹面板、不入队，从源头绕过 ToolApprovalPanel。pty 路径复用
  // promptOptionClick（其 _promptSubmitting 500ms 守卫 + _ptyBuffer 清空已防同一 prompt 被
  // 缓冲区重复解析触发二次导航）。
  // 返回是否已实际放行：hook 路径 ws 未连通时返回 false，调用方应回落到正常面板路径
  // （保持可见/可恢复，避免静默丢成 timeout-deny）。pty 路径已点击选项，返回 true。
  autoAllow = (perm) => {
    if (perm?.source === 'pty' && perm.ptyPrompt) {
      const optNum = this._findPtyOptionNumber(perm.ptyPrompt, 'allow');
      this.host.promptOptionClick(optNum);
      return true;
    }
    const ws = this.host.ws();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'perm-hook-answer', id: perm.id, decision: 'allow' }));
      return true;
    }
    return false;
  };

  allowSession = (id) => {
    const perm = this.host.getState().pendingPermission;
    if (perm?.source === 'pty' && perm.ptyPrompt) {
      const optNum = this._findPtyOptionNumber(perm.ptyPrompt, 'allowSession');
      this.host.promptOptionClick(optNum);
      this.shiftQueue();
      return;
    }
    const ws = this.host.ws();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'perm-hook-answer', id, decision: 'allow', allowSession: true }));
    }
    this.shiftQueue();
  };

  deny = (id) => {
    const perm = this.host.getState().pendingPermission;
    if (perm?.source === 'pty' && perm.ptyPrompt) {
      const optNum = this._findPtyOptionNumber(perm.ptyPrompt, 'deny');
      this.host.promptOptionClick(optNum);
      this.shiftQueue();
      return;
    }
    const ws = this.host.ws();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'perm-hook-answer', id, decision: 'deny' }));
    }
    this.shiftQueue();
  };

  _findPtyOptionNumber(prompt, decision) {
    const options = prompt?.options || [];
    if (decision === 'allow') {
      const opt = options.find(o => /^yes$/i.test(o.text.trim()))
        || options.find(o => /^yes/i.test(o.text) && !/allow|session|project/i.test(o.text));
      return opt?.number || 1;
    }
    if (decision === 'allowSession') {
      const opt = options.find(o => /allow.*(?:project|session|during)/i.test(o.text));
      return opt?.number || 2;
    }
    const opt = options.find(o => /^no$/i.test(o.text.trim()) || /^no[^a-z]/i.test(o.text));
    return opt?.number || options.length;
  }
}
