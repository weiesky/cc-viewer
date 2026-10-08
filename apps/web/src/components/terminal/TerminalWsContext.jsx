import React, { createContext } from 'react';
import { appendToken, getBasePath } from '../../utils/apiUrl';

/**
 * Single shared `/ws/terminal` connection.
 *
 * Why a shared ws:
 * - 改前 ChatView (`_inputWs`) 与 TerminalPanel (`this.ws`) 各开一条,服务端广播给两条
 *   client-readyState=1 的连接,导致 PTY data / state / exit 等大量消息**双倍传输**,
 *   ChatView 端还要跑 `_stripAnsi` + `_detectPrompt` 解析全量 raw bytes(纯浪费 CPU)。
 * - 合并到单 ws 后,server 端无需 role 过滤、`activeWs` 仲裁简化、新消息类型不再要决策"该过滤谁"。
 *
 * Provider 职责:
 * - 在 `props.open=true` 时建立 ws,`open=false` 时关闭
 * - 内部封装重连(2s 退避),消费者无感
 * - `addMessageHandler` 把单条 onmessage 派发给所有注册者(各自 switch type)
 * - `addStateListener` 通知 open/close,TerminalPanel 用它在 onopen 后立即 sendResize
 *
 * 默认值是 no-op,纯 web 模式 / 未包 Provider 时调用不报错。
 */
export const TerminalWsContext = createContext({
  send: () => false,
  isOpen: () => false,
  addMessageHandler: () => () => {},
  addStateListener: () => () => {},
  attach: () => false,
});

const RECONNECT_DELAY_MS = 2000;

export class TerminalWsProvider extends React.Component {
  constructor(props) {
    super(props);
    this.ws = null;
    this.messageHandlers = new Set();
    this.stateListeners = new Set();
    this.reconnectTimer = null;
    this._unmounted = false;
    // The project the LAST open connection attached to — reconnects re-attach to
    // the CURRENT prop, view switches while connected send an explicit attach.
    this._attachedProject = null;
    this._attachedInstance = null; // multi-instance: paired with _attachedProject
    this._ctxValue = {
      send: this.send,
      isOpen: this.isOpen,
      addMessageHandler: this.addMessageHandler,
      addStateListener: this.addStateListener,
      attach: this.attach,
    };
  }

  componentDidMount() {
    if (this.props.open) this.connect();
  }

  componentDidUpdate(prevProps) {
    if (!prevProps.open && this.props.open) {
      this.connect();
    } else if (prevProps.open && !this.props.open) {
      this.disconnect();
      return;
    }
    // Multi-PTY view switch (2026-10): while the shared ws stays open, a change
    // of the viewed project (chip click / launch / detach) must re-anchor the
    // server-side active PTY — otherwise the terminal keeps showing/feeding the
    // previously viewed project's process.
    // Multi-instance: re-attach when EITHER the viewed project or the viewed instance changes.
    if (this.props.open && (prevProps.viewedProject !== this.props.viewedProject || prevProps.viewedInstance !== this.props.viewedInstance)) {
      this.attach(this.props.viewedProject, this.props.viewedInstance);
    }
  }

  componentWillUnmount() {
    this._unmounted = true;
    this.disconnect();
  }

  connect = () => {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    let url;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // 带上 LAN token —— 服务端 WS upgrade 与 HTTP 同款鉴权,远程 ?token= 终端必须携带凭证。
      // 密码登录用户由浏览器自动随握手发送 ccv_auth cookie,此处无 token 时原样返回。
      url = appendToken(`${protocol}//${window.location.host}${getBasePath().replace(/\/$/, '')}/ws/terminal`);
      // Multi-PTY: pin this connection to the project being VIEWED so the server
      // replays that project's state/buffer (not the last-spawned one).
      const vp = this.props.viewedProject;
      if (vp) url += `${url.includes('?') ? '&' : '?'}project=${encodeURIComponent(vp)}`;
      // Multi-instance: pin the connection to the exact instance when a same-cwd project runs
      // two concurrent processes (so the server replays/attaches THIS process's terminal).
      const vi = this.props.viewedInstance;
      if (vi) url += `${url.includes('?') ? '&' : '?'}instance=${encodeURIComponent(vi)}`;
    } catch (e) {
      return; // SSR / 测试环境兜底
    }
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[TerminalWsProvider] WebSocket constructor failed:', e);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this._attachedProject = this.props.viewedProject || null;
      this._notifyState('open');
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch {
        // 整条消息丢弃 = 数据流中间挖洞且无路径补发（概率极低：ws 帧不会截断 JSON）
        // → 请求权威快照对齐兜底（服务端有冷却，不会风暴）
        try { ws.send(JSON.stringify({ type: 'resync-request' })); } catch {}
        return;
      }
      // 单点 onmessage 派发给所有 handler;handler 抛错被吞,不影响其他。
      for (const h of this.messageHandlers) {
        try { h(msg); } catch (e) { console.warn('[TerminalWsProvider] handler error:', e); }
      }
    };

    ws.onerror = () => {
      this._notifyState('error');
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this._notifyState('close');
      // 仅当 props.open 仍为 true 且未 unmount,才安排重连。
      if (!this._unmounted && this.props.open) this._scheduleReconnect();
    };
  };

  disconnect = () => {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.onclose = null; } catch {}
      try { ws.close(); } catch {}
    }
  };

  _scheduleReconnect = () => {
    if (this.reconnectTimer || this._unmounted) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this._unmounted && this.props.open) this.connect();
    }, RECONNECT_DELAY_MS);
  };

  _notifyState = (state) => {
    for (const l of this.stateListeners) {
      try { l(state); } catch (e) { console.warn('[TerminalWsProvider] state listener error:', e); }
    }
  };

  send = (obj) => {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      console.warn('[TerminalWsProvider] send error:', e);
      return false;
    }
  };

  isOpen = () => {
    const ws = this.ws;
    return !!(ws && ws.readyState === WebSocket.OPEN);
  };

  /**
   * Re-anchor the shared stream to a project's PTY (multi-PTY view switch).
   * Idempotent; a no-op when already attached to it or while disconnected
   * (the next connect's ?project= handshake picks up the current prop anyway).
   * Returns whether the message was sent.
   */
  attach = (project, instanceKey) => {
    const target = project || null;
    const inst = instanceKey || null;
    // Multi-instance: identity is project+instance — re-attach when either changes.
    if (target === this._attachedProject && inst === (this._attachedInstance || null)) return false;
    const sent = this.send({ type: 'attach', project: target, ...(inst ? { instanceKey: inst } : {}) });
    if (sent) { this._attachedProject = target; this._attachedInstance = inst; }
    return sent;
  };

  addMessageHandler = (fn) => {
    if (typeof fn !== 'function') return () => {};
    this.messageHandlers.add(fn);
    return () => { this.messageHandlers.delete(fn); };
  };

  addStateListener = (fn) => {
    if (typeof fn !== 'function') return () => {};
    this.stateListeners.add(fn);
    return () => { this.stateListeners.delete(fn); };
  };

  render() {
    return (
      <TerminalWsContext.Provider value={this._ctxValue}>
        {this.props.children}
      </TerminalWsContext.Provider>
    );
  }
}
