import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Drawer, Button, Spin, Empty, Tooltip, Tag, message } from 'antd';
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import ChatMessage from '../chat/ChatMessage';
import { cachedBuildToolResultMap } from '../../utils/toolResultBuilder';
import { classifyUserContent, isSystemText, isMainAgent, extractDisplayText } from '@ccv/core/contentFilter';
import { mergeMainAgentSessions } from '../../utils/sessionMerge';
import { reconstructEntries } from '@ccv/core/delta-reconstructor';
import { apiUrl } from '../../utils/apiUrl';
import { IM_PLATFORMS } from './imPlatforms';
import { t } from '../../i18n';
import { imBadgeModel } from '../../utils/imConnState';
import { reportSwallowed } from '../../utils/errorReport';
import styles from './ImConversationModal.module.css';

// 启动校验：轮询 status 直到 worker 真就绪（state==='ready'）或超时；对齐 ImPlatformSettings / 服务端 BOOT_WINDOW_MS(15s)。
const START_POLL_TIMEOUT_MS = 15000;
const START_POLL_INTERVAL_MS = 1000;

// 把一份独立 IM worker 的 .jsonl 重建出的 entries 折叠成 mainAgentSessions。
// 复用纯函数 isMainAgent + mergeMainAgentSessions（后者自带 _timestamp 赋值），不碰 AppBase._processEntries
// 那条 mainAgent-doubling 热路径。
function buildSessionsFromEntries(entries) {
  let sessions = [];
  for (const entry of entries) {
    if (isMainAgent(entry) && entry.body && Array.isArray(entry.body.messages) && !entry._slimmed) {
      sessions = mergeMainAgentSessions(sessions, entry);
    }
  }
  return sessions;
}

// 只读渲染：复用 ChatMessage（isHistoryLog，省略所有交互 on*/active*/lastPending* props → 自动降级）。
// senderMap：senderId → {name, avatar}，透传给 ChatMessage 以按发送者覆盖姓名/头像（IM 来源消息）。
// imAgent：{name, Icon, color}，让助手（MainAgent）一侧的头像/名字用所属 IM 平台的 logo + 名称呈现。
function renderSessions(sessions, senderMap, imAgent) {
  const out = [];
  sessions.forEach((session, si) => {
    const messages = Array.isArray(session.messages) ? session.messages : [];
    if (messages.length === 0) return;
    const maps = cachedBuildToolResultMap(messages);
    const kp = `s${si}`;
    messages.forEach((msg, mi) => {
      if (!msg) return;
      const ts = msg._timestamp || null;
      const content = msg.content;

      if (msg.role === 'user') {
        if (Array.isArray(content)) {
          const { commands, textBlocks, skillBlocks } = classifyUserContent(content);
          commands.forEach((cmd, ci) => out.push(
            <ChatMessage key={`${kp}-cmd-${mi}-${ci}`} role="user" text={cmd} timestamp={ts} isHistoryLog imSenderMap={senderMap} />
          ));
          skillBlocks.forEach((sb, ski) => {
            const m = (sb.text || '').match(/^#\s+(.+)$/m);
            out.push(<ChatMessage key={`${kp}-skill-${mi}-${ski}`} role="skill-loaded" text={sb.text} skillName={m ? m[1] : 'Skill'} timestamp={ts} isHistoryLog />);
          });
          textBlocks.forEach((tb, ti) => {
            const isPlan = /Implement the following plan:/i.test(tb.text || '');
            out.push(<ChatMessage key={`${kp}-user-${mi}-${ti}`} role={isPlan ? 'plan-prompt' : 'user'} text={tb.text} timestamp={ts} isHistoryLog imSenderMap={senderMap} />);
          });
          // 纯 tool_result 的 user 消息不单独渲染（其结果挂在对应 assistant 的 tool_use 上）。
        } else if (typeof content === 'string') {
          const dispText = extractDisplayText(content);
          if (dispText) {
            const isPlan = /Implement the following plan:/i.test(dispText);
            out.push(<ChatMessage key={`${kp}-user-${mi}`} role={isPlan ? 'plan-prompt' : 'user'} text={dispText} timestamp={ts} isHistoryLog imSenderMap={senderMap} />);
          }
        }
      } else if (msg.role === 'assistant') {
        let blocks = null;
        if (Array.isArray(content)) {
          blocks = content.filter((b) => b.type !== 'text' || !isSystemText(b.text));
        } else if (typeof content === 'string') {
          const dispText = extractDisplayText(content);
          if (dispText) blocks = [{ type: 'text', text: dispText }];
        }
        if (blocks && blocks.length > 0) {
          out.push(
            <ChatMessage
              key={`${kp}-asst-${mi}`}
              role="assistant"
              content={blocks}
              toolResultMap={maps.toolResultMap}
              readContentMap={maps.readContentMap}
              editSnapshotMap={maps.editSnapshotMap}
              askAnswerMap={maps.askAnswerMap}
              planApprovalMap={maps.planApprovalMap}
              latestPlanContent={maps.latestPlanContent}
              timestamp={ts}
              displayTs={msg._generatedTs}
              collapseToolResults
              isHistoryLog
              imAgent={imAgent}
            />
          );
        }
      }
    });
  });
  return out;
}

/**
 * IM 对话记录弹窗：点击 header 的 IM logo 打开，展示该 IM 独立 worker 的 Claude Code 会话。
 * 数据：GET /api/im/:platform/logs → 最新 .jsonl → /api/local-log SSE → reconstructEntries → 渲染。
 * 非实时；右上角刷新按钮重新拉取。
 */
export default function ImConversationModal({ open, onClose, platform, onOpenConfig }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 上一次 effect 的 {open, platform}：用于区分「纯刷新」（仅 reloadKey 变）与「切平台/重新打开」。
  // 本组件在 AppHeader 里常驻挂载（destroyOnClose 只销毁 Modal 内层，不卸载本组件），故 ref 跨开关存活；
  // HMR remount 时 useRef 会重建为初始值，行为退化为「清空」，安全。
  const prevRef = useRef({ open: false, platform: null });
  // 镜像当前 sessions，供 effect 内异步错误回调判断「是否已有内容」（决定报错走 toast 还是 Empty）。
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // 滚动位置记忆：组件常驻挂载 → ref 跨开关存活。按 platform 记 {top, atBottom}。
  // 打开时：无记录 / 上次停在底部 → 拉到最底；否则恢复上次拉到的位置。
  const bodyRef = useRef(null);
  const scrollMemRef = useRef({});       // platform -> { top, atBottom }
  const positionedRef = useRef(false);   // 本次打开是否已定位（每次 open/切平台重置）

  const handleScroll = (e) => {
    if (!open || !platform) return;
    const el = e.currentTarget;
    const atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 24;
    scrollMemRef.current[platform] = { top: el.scrollTop, atBottom };
  };

  // 每次打开 / 切平台 → 需重新定位。
  useEffect(() => { positionedRef.current = false; }, [open, platform]);

  // 内容就绪（loading 落定）后定位一次：恢复记忆位置，或默认拉到底。用 layout effect 避免可见跳动。
  useLayoutEffect(() => {
    if (!open || loading || positionedRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    const mem = scrollMemRef.current[platform];
    el.scrollTop = (!mem || mem.atBottom) ? el.scrollHeight : Math.min(mem.top, el.scrollHeight);
    positionedRef.current = true;
  }, [open, platform, loading, sessions]);

  const descriptor = IM_PLATFORMS.find((p) => p.id === platform) || null;
  const label = descriptor ? (() => { try { return t(descriptor.labelKey); } catch { return descriptor.fallback; } })() : '';

  // 发送者身份映射（senderId → {name, avatar}）：打开/切平台/刷新时拉取，按发送者覆盖 user 气泡的姓名+头像。
  const [senderMap, setSenderMap] = useState({});
  useEffect(() => {
    if (!open || !platform) return undefined;
    let cancelled = false;
    fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/senders`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setSenderMap((d && d.senders) || {}); })
      .catch(() => { if (!cancelled) setSenderMap({}); });
    return () => { cancelled = true; };
  }, [open, platform, reloadKey]);

  // 连接状态（与设置弹窗同源 /status）：打开时拉一次并每 5s 轮询，让用户在对话记录里也能确认桥接已连通。
  const [imConn, setImConn] = useState(null);
  const [imProc, setImProc] = useState(null);
  // 轮询期间用户可能切平台/关抽屉：闭包里记住目标平台，与最新值比对后再 setState，防止串台。
  const platformRef = useRef(platform);
  platformRef.current = platform;
  // 真卸载（HMR/父级卸载）守卫 + 启动期间暂停 5s 后台轮询（对齐 ImPlatformSettings 的 mountedRef/busyRef 范式）。
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!open || !platform) return undefined;
    let cancelled = false;
    const poll = async () => {
      // 启动轮询进行中：暂停后台轮询——其 catch 分支会把状态复位成断连，瞬态失败会让徽标在
      // booting→ready 过渡中闪回「未连接」（与 ImPlatformSettings 的 busyRef 同理）。
      if (busyRef.current) return;
      try {
        const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/status`));
        if (!r.ok) { if (!cancelled) { setImConn({ running: false, connected: false }); setImProc(null); } return; }
        const d = await r.json();
        if (!cancelled) { setImConn(d.connection || null); setImProc(d.process || null); }
      } catch { if (!cancelled) { setImConn({ running: false, connected: false }); setImProc(null); } }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
    // reloadKey: 手动刷新时一并重拉连接状态（与下方对话/发送者 effect 对齐，否则刷新只更新内容不更新状态徽标）。
  }, [open, platform, reloadKey]);

  // 「启动」按钮：worker 确认已死（procState==='dead' → 徽标显示「未连接」）时出现在徽标旁，
  // 让用户不必绕道设置弹窗即可拉起。POST /process {action:'start'}（服务端校验凭证并持久化 enabled:true），
  // 然后轮询 status 直到桥接真连上或超时。
  // 远端（LAN）客户端 status 不含 process → imProc 为 null → 按钮自然隐藏（/process 本就 loopback-only）。
  // startingPlatform 按平台记「正在启动谁」：全局布尔曾在「启动中切平台」时被 finally 的守卫跳过复位，
  // 导致按钮在其他平台串台出现并永久卡死 loading（review P1）。
  const [startingPlatform, setStartingPlatform] = useState(null);

  const startWorker = async () => {
    const target = platform;
    setStartingPlatform(target);
    busyRef.current = true;
    try {
      const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(target)}/process`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }),
      });
      let body = null;
      try { body = await r.json(); } catch (e) { reportSwallowed('fetch.im-process-start', e); }
      if (!r.ok || body?.ok === false) {
        // 服务端凭证校验失败等会带 detail（如 "missing appId/appSecret"），拼进 toast 帮助定位。
        const detail = body?.detail || body?.error || '';
        message.error(t('ui.im.startFailed') + (detail ? `: ${detail}` : ''));
        return;
      }
      // 轮询 status 直到桥接真连上或超时。ready 只代表 worker 的 HTTP 身份服务就绪，凭证失效时
      // bridge no-op 而 worker 照样 ready——若以 ready 为判据会误报「已连接」（review P2）。
      const deadline = Date.now() + START_POLL_TIMEOUT_MS;
      let ready = false;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, START_POLL_INTERVAL_MS));
        if (!mountedRef.current || platformRef.current !== target) return;
        try {
          const s = await fetch(apiUrl(`/api/im/${encodeURIComponent(target)}/status`));
          if (!s.ok) continue;
          const d = await s.json();
          if (!mountedRef.current || platformRef.current !== target) return;
          setImConn(d.connection || null);
          setImProc(d.process || null);
          if (d?.process?.state === 'ready'
            && (d?.connection?.connected || d?.connection?.connectionState === 'connected')) { ready = true; break; }
        } catch (e) { reportSwallowed('fetch.im-start-poll', e); /* transient → keep polling until deadline */ }
      }
      if (ready) message.success(t('ui.im.statusConnected'));
      else message.error(t('ui.im.startFailed'));
    } catch (e) {
      reportSwallowed('fetch.im-process-start', e);
      message.error(t('ui.im.startFailed'));
    } finally {
      busyRef.current = false;
      // 函数式更新只清自己这一轮：无条件复位会误清切平台后新发起的另一轮启动。
      setStartingPlatform((p) => (p === target ? null : p));
    }
  };

  // 状态徽标：以真实进程状态为准（含服务端口）。远端无 process → 回落 connection。与 ImPlatformSettings 一致。
  // Decision logic lives in imBadgeModel (shared with ImPlatformSettings).
  const renderStatus = () => {
    const m = imBadgeModel({ procState: imProc?.state, connection: imConn });
    if (!m) return null;
    const portSuffix = m.withPort && imProc?.port ? ` :${imProc.port}` : '';
    // 启动中徽标会先翻成「启动中…」（booting）：按钮保持 loading 可见直到就绪/超时，反馈不中断。
    // dead && !lastError 等价于「徽标此刻显示未连接」（imBadgeModel 对 dead 只有 lastError 一个更高优先级
    // 分支），直接用语义字段判断，不比对 i18n key 字符串（key 重命名会静默失效，review P2）。
    const showStart = startingPlatform === platform || (imProc?.state === 'dead' && !imConn?.lastError);
    return (
      <>
        {showStart ? (
          <Button type="primary" size="small" loading={startingPlatform === platform} onClick={startWorker}>
            {t('ui.im.start')}
          </Button>
        ) : null}
        <Tag color={m.color || undefined}>
          {t(m.key)}{m.error ? `: ${m.error}` : ''}{portSuffix}
        </Tag>
      </>
    );
  };

  useEffect(() => {
    if (!open || !platform) { prevRef.current = { open, platform }; return undefined; }
    // 纯刷新（仅 reloadKey 变：open 已是 true 且 platform 未变）保留旧内容，避免高度从内容→Spin→内容闪烁；
    // 切平台 / 重新打开则清空，先显示首屏 Spin。
    const isPureRefresh = prevRef.current.open === true && prevRef.current.platform === platform;
    prevRef.current = { open, platform };
    let es = null;
    let cancelled = false;
    setLoading(true); setError(null);
    if (!isPureRefresh) setSessions([]);
    // 刷新失败但已有内容时只弹 toast（不替换正文，避免抖动）；首屏无内容时走 Empty 报错态。
    const reportError = (e) => {
      setError(String(e?.message || e) || 'load_failed');
      if (sessionsRef.current.length > 0) message.error(t('ui.imRecord.loadFailed'));
    };

    (async () => {
      try {
        const r = await fetch(apiUrl(`/api/im/${encodeURIComponent(platform)}/logs`));
        if (!r.ok) throw new Error(`logs ${r.status}`);
        const { latest } = await r.json();
        if (cancelled) return;
        if (!latest) { setSessions([]); setLoading(false); return; }

        const entries = [];
        es = new EventSource(apiUrl(`/api/local-log?file=${encodeURIComponent(latest)}`));
        es.addEventListener('load_chunk', (ev) => {
          try { const chunk = JSON.parse(ev.data); if (Array.isArray(chunk)) for (const e of chunk) entries.push(e); } catch { /* skip bad chunk */ }
        });
        es.addEventListener('load_end', () => {
          es.close();
          if (cancelled) return;
          try {
            const reconstructed = reconstructEntries(entries);
            setSessions(buildSessionsFromEntries(reconstructed));
          } catch (e) { reportError(e); }
          setLoading(false);
        });
        es.onerror = () => { try { es.close(); } catch { /* noop */ } if (!cancelled) { reportError('load_failed'); setLoading(false); } };
      } catch (e) {
        if (!cancelled) { reportError(e); setLoading(false); }
      }
    })();

    return () => { cancelled = true; if (es) try { es.close(); } catch { /* noop */ } };
  }, [open, platform, reloadKey]);

  // 助手回复零滞后自动刷新：主服务 fs.watch 到本平台 IM 日志写入 → im_log_update SSE → AppBase 转 window 事件。
  // 弹窗打开时监听，命中当前 platform 即 bump reloadKey，复用上方「纯刷新」路径（保留滚动/吸底，不闪烁）。
  useEffect(() => {
    if (!open || !platform) return undefined;
    const onUpdate = (e) => {
      if (e?.detail?.platform === platform) setReloadKey((k) => k + 1);
    };
    window.addEventListener('ccv:im-log-update', onUpdate);
    return () => window.removeEventListener('ccv:im-log-update', onUpdate);
    // reloadKey 不入依赖：setReloadKey 用函数式更新，不读闭包内 reloadKey，无需重订阅（重订阅反而多余）。
  }, [open, platform]);

  // 助手（MainAgent）一侧的身份：用所属 IM 平台的 logo + 名称呈现。memo 在 [platform] 上稳定，避免每次重渲都
  // 生成新对象而打穿 ChatMessage 的 shouldComponentUpdate（imAgent !== 恒为真）。
  const imAgent = useMemo(
    () => (descriptor ? { name: label, Icon: descriptor.icon, color: descriptor.color } : null),
    [platform, label], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 始终基于当前 sessions 渲染（不再 loading?[]:...），刷新时旧内容仍在，高度稳定。
  // renderSessions 是纯函数（内部 cachedBuildToolResultMap 按 messages 引用记忆），重渲廉价。
  const items = renderSessions(sessions, senderMap, imAgent);

  const title = (
    <div className={styles.headerBar}>
      <span>{t('ui.imRecord.title')}</span>
      {onOpenConfig ? (
        <Tooltip title={t('ui.imRecord.config')}>
          <Button
            type="text"
            size="small"
            icon={<SettingOutlined />}
            className={styles.refreshBtn}
            onClick={() => onOpenConfig(platform)}
          />
        </Tooltip>
      ) : null}
      <Tooltip title={t('ui.imRecord.refresh')}>
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined spin={loading} />}
          className={styles.refreshBtn}
          disabled={loading}
          onClick={() => setReloadKey((k) => k + 1)}
        />
      </Tooltip>
      <span className={styles.statusTag}>{renderStatus()}</span>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="left"
      width="min(760px, 92vw)"
      rootClassName="ccvSideDrawer"
      destroyOnHidden
      title={title}
      // header 高度由 global.css 的 `.ccvSideDrawer .ant-drawer-header` 统一压到 40px(对齐主窗口顶栏)。
      styles={{ body: { padding: 0, overflow: 'hidden', background: 'var(--bg-elevated)' }, header: { background: 'var(--bg-elevated)' } }}
    >
      <div className={styles.scrollBody} ref={bodyRef} onScroll={handleScroll}>
        {items.length > 0 ? (
          // 有内容优先渲染（刷新期间也是），保证高度稳定、不塌缩成 Spin
          items
        ) : loading ? (
          // 仅首屏加载（尚无内容）显示整页 Spin；刷新进度改由标题刷新图标的 spin 呈现
          <div className={styles.center}><Spin /><span className={styles.hint}>{t('ui.imRecord.loading')}</span></div>
        ) : error ? (
          <div className={styles.center}>
            <Empty description={t('ui.imRecord.loadFailed')} />
            <Button size="small" onClick={() => setReloadKey((k) => k + 1)}>{t('ui.imRecord.refresh')}</Button>
          </div>
        ) : (
          <Empty description={t('ui.imRecord.empty')} />
        )}
      </div>
    </Drawer>
  );
}
