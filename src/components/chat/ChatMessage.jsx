import React from 'react';
import ReactDOM from 'react-dom';
import { Collapse, Typography, Radio, Checkbox, Input, Button, Tooltip, Popover, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { escapeHtml, truncateText, getSvgAvatar } from '../../utils/helpers';
import { formatHms, formatMonthDayTime } from '../../utils/formatters';
import { compactResultPreview } from '../../utils/toolResultCore.js';
import { extractWebSearchGroups } from '../../utils/webSearchGrouping';
import { mergeThinkingBlocks } from '../../utils/thinkingMerge';
import WebSearchResultsView from '../viewers/WebSearchResultsView';
import MarkdownBlock from '../viewers/MarkdownBlock';
import { IM_SOURCE_ICONS } from '../settings/imPlatforms';
import { parseImOrigin } from '../../utils/imOrigin';
import { getTeammateAvatar } from '../../utils/teammateAvatars';
import { renderAssistantText } from '../../utils/systemTags';
import { apiUrl } from '../../utils/apiUrl';
import { findUserImageRefs } from '../../utils/userImageRefs';
import { isMobile, isIOS, isPad } from '../../env';
import AskQuestionForm from './AskQuestionForm';
import { hasOptionDescription, resolveAskQuestions } from '../../utils/askOptionDesc';
import { ApprovalPortalContext } from './ApprovalPortalContext';
import { shouldPortalAskForm } from '../../utils/askPortalMatcher';
import { SettingsContext } from '../../contexts/SettingsContext';
import { t } from '../../i18n';
import { tc } from '../../utils/tClaude';
import { getSlashCommandLabel, getSlashCommandTooltip } from '../../utils/slashCommandLabels';
import { isPlanApprovalPrompt } from '../../utils/promptClassifier';
import DiffView from './DiffView';
import ToolResultView from '../viewers/ToolResultView';

import ImageLightbox from '../common/ImageLightbox';
import defaultAvatarUrl from '../../img/default-avatar.svg';
import defaultModelAvatarUrl from '../../img/default-model-avatar.svg';
import styles from './ChatMessage.module.css';

// IM-source badge icons/colors come from the platform registry (imPlatforms.js): the id captured
// from a ⟦im:<id>⟧ marker maps to its brand icon + color. Unknown ids render no icon.

const { Text } = Typography;

function AskValidationBadge({ resultText }) {
  if (!resultText) return null;
  return (
    <div className={styles.askValidationErrorBadge}>
      <span className={styles.askValidationErrorTitle}>{t('ui.askValidationErrorBadge')}</span>
      <details className={styles.askValidationErrorDetails}>
        <summary>{t('ui.askValidationErrorRaw')}</summary>
        <pre className={styles.askValidationErrorRawText}>{resultText}</pre>
      </details>
    </div>
  );
}

function ViewRequestIcon() {
  return (
    <svg viewBox="0 0 1024 1024" width="12" height="12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="currentColor" d="M738.133333 580.266667c-17.066667-8.533333-38.4 0-38.4 21.333333v85.333333H268.8c-123.733333 0-200.533333-42.666667-200.533333-42.666666s21.333333 170.666667 200.533333 170.666666h430.933333v85.333334c0 21.333333 21.333333 34.133333 38.4 21.333333l204.8-149.333333c17.066667-8.533333 17.066667-34.133333 0-42.666667l-204.8-149.333333zM285.866667 443.733333c17.066667 8.533333 38.4 0 38.4-21.333333v-85.333333h430.933333c123.733333 0 200.533333 42.666667 200.533333 42.666666s-21.333333-170.666667-200.533333-170.666666H324.266667v-85.333334c0-21.333333-21.333333-34.133333-38.4-21.333333L81.066667 251.733333c-17.066667 8.533333-17.066667 34.133333 0 42.666667l204.8 149.333333z" />
    </svg>
  );
}

function ChatImage({ src, alt, fallbackText }) {
  const [failed, setFailed] = React.useState(false);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  if (failed) {
    return <span className={styles.chatImageFallback}>{fallbackText}</span>;
  }
  return (
    <>
      <img
        src={src}
        alt={alt}
        className={styles.chatImageImg}
        loading="lazy"
        decoding="async"
        onClick={() => setLightboxOpen(true)}
        onError={() => setFailed(true)}
      />
      {lightboxOpen && (
        <ImageLightbox src={src} alt={alt} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  );
}

// 流式期间 ChatMessage 整树每 chunk 重渲一次；Avatar / Label 的实际 props
// （modelInfo / name / timestamp / requestIndex）在一轮响应内都是稳定的。
// 提取为 memo 组件后 React 在浅比较通过时直接 bail out，不再进入内部
// antd Text / 头像 innerHTML 的 reconciliation，显著降低 reconciler 工作量。
// streaming 依赖链：ChatView 给"正在流式的那条消息"传 showTrailingCursor=true
//   → ChatMessage.shouldComponentUpdate 行 99 检测到变化触发 re-render
//   → renderAssistantMessage 把 showTrailingCursor 透传为 <ModelAvatar streaming>
//   → 这里的 memo 浅比较 streaming bool 变化 → 切换 svgAnimated / svg
//   → streaming 变 false 时自动切回静态 svg
const ModelAvatar = React.memo(function ModelAvatar({ modelInfo, streaming }) {
  const svgSource = (streaming && modelInfo?.svgAnimated) || modelInfo?.svg;
  if (svgSource) {
    return (
      <div className={styles.avatar} style={{ background: modelInfo.color || 'var(--bg-model-avatar)' }}
        dangerouslySetInnerHTML={{ __html: svgSource }}
      />
    );
  }
  return <img src={defaultModelAvatarUrl} className={styles.avatarImg} alt={modelInfo?.name || 'Agent'} />;
});

// 上下文 token 总量格式化：始终带 K 单位（与全站 formatTokenCount 行为不同：后者 0/<1000 不带 K）。
// 用户需求：在 assistant 时间戳旁显示一个稳定的 "X.XK" 标记。
function formatCacheK(n) {
  if (n == null) return '';
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0K';
  if (n >= 1000000) return (n / 1000).toFixed(0) + 'K';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1000).toFixed(2) + 'K';
}

const AssistantLabel = React.memo(function AssistantLabel({ name, extra, timeStr, requestIndex, onViewRequest, cacheTotalTokens, showFullToolContent }) {
  const useIcon = !showFullToolContent;
  const viewBtn = (requestIndex != null && onViewRequest) ? (
    useIcon ? (
      <span
        className={styles.viewRequestIcon}
        title={t('ui.viewRequest')}
        onClick={(e) => { e.stopPropagation(); onViewRequest(requestIndex); }}
      >
        <ViewRequestIcon />
      </span>
    ) : (
      <span className={styles.viewRequestBtn} onClick={(e) => { e.stopPropagation(); onViewRequest(requestIndex); }}>
        {t('ui.viewRequest')}
      </span>
    )
  ) : null;
  const showCache = showFullToolContent && cacheTotalTokens != null;
  const cacheStr = showCache ? formatCacheK(cacheTotalTokens) : '';
  return (
    <div className={styles.labelRow}>
      <Text type="secondary" className={styles.labelText}>{name}{extra || ''}</Text>
      <span className={styles.labelRight}>
        {viewBtn}
        {showCache && (
          <Text
            className={styles.cacheContextText}
            title={t('ui.cacheContextTooltip', { value: cacheStr })}
          >
            {`[${cacheStr}]`}
          </Text>
        )}
        {timeStr && <Text className={styles.timeText}>{timeStr}</Text>}
      </span>
    </div>
  );
});


class ChatMessage extends React.Component {
  static contextType = SettingsContext;

  constructor(props) {
    super(props);
    this.state = {
      planFeedbackInput: false,
      planFeedbackText: '',
      planFeedbackOptNumber: null,
      planApprovalSubmitting: false,
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (this.state !== nextState) return true;
    const p = this.props, n = nextProps;
    // 逐字段浅比较核心 prop，避免 inline {} 和 computed values 导致的无效重渲染
    return p.role !== n.role || p.content !== n.content || p.text !== n.text ||
      p.timestamp !== n.timestamp || p.displayTs !== n.displayTs || p.highlight !== n.highlight ||
      p.collapseToolResults !== n.collapseToolResults || p.expandThinking !== n.expandThinking || p.showFullToolContent !== n.showFullToolContent ||
      p.showTrailingCursor !== n.showTrailingCursor ||
      p.showThinkingSummaries !== n.showThinkingSummaries ||
      p.toolResultMap !== n.toolResultMap || p.readContentMap !== n.readContentMap ||
      p.editSnapshotMap !== n.editSnapshotMap || p.askAnswerMap !== n.askAnswerMap ||
      p.planApprovalMap !== n.planApprovalMap || p.latestPlanContent !== n.latestPlanContent ||
      p.ptyPrompt !== n.ptyPrompt || p.cliMode !== n.cliMode ||
      p.lastPendingAskId !== n.lastPendingAskId || p.lastPendingPlanId !== n.lastPendingPlanId ||
      p.pendingAsk !== n.pendingAsk ||
      p.activePlanPrompt !== n.activePlanPrompt || p.activeDangerousPrompt !== n.activeDangerousPrompt ||
      p.activePtyPlanId !== n.activePtyPlanId ||
      p.requestIndex !== n.requestIndex || p.cacheTotalTokens !== n.cacheTotalTokens || p.label !== n.label || p.isTeammate !== n.isTeammate ||
      p.animateAvatar !== n.animateAvatar ||
      p.isHistoryLog !== n.isHistoryLog ||
      p.userProfile !== n.userProfile || p.modelInfo !== n.modelInfo || p.imSenderMap !== n.imSenderMap || p.imAgent !== n.imAgent ||
      p.resultText !== n.resultText || p.toolName !== n.toolName ||
      p.onViewRequest !== n.onViewRequest || p.onOpenFile !== n.onOpenFile ||
      p.onPlanApprovalClick !== n.onPlanApprovalClick || p.onPlanFeedbackSubmit !== n.onPlanFeedbackSubmit ||
      p.onDangerousApprovalClick !== n.onDangerousApprovalClick || p.onAskQuestionSubmit !== n.onAskQuestionSubmit ||
      p.onAskQuestionCancel !== n.onAskQuestionCancel ||
      p.askMetaMap !== n.askMetaMap ||
      p.lang !== n.lang ||
      p.taskNotification?.taskId !== n.taskNotification?.taskId;
  }

  componentDidUpdate(prevProps) {
    if (prevProps.lastPendingAskId !== this.props.lastPendingAskId) {
      this.setState({
        askSelections: {},
        askMultiSelections: {},
        askOtherActive: {},
        askOtherText: {},
        askSubmitting: false,
      });
    }
    if (prevProps.lastPendingPlanId !== this.props.lastPendingPlanId) {
      this.setState({ planApprovalSubmitting: false });
    }
  }

  formatTime(ts) {
    // displayTs 优先于 ts：assistant message 用 _generatedTs（消息生成时刻）而非 _timestamp
    // （后者是"被下一次 request 携带进 body.messages"时的 ts，晚一拍）。其他 role 不传 displayTs，
    // fallback 到 ts，行为不变。
    const effectiveTs = this.props.displayTs ?? ts;
    if (!effectiveTs) return null;
    try {
      const d = new Date(effectiveTs);
      const { showFullToolContent, isHistoryLog } = this.props;
      // 紧凑模式只显示 HH:MM:SS；完整模式显示 MM-DD HH:MM:SS。两种格式与 utils/formatters 的
      // formatHms / formatMonthDayTime 同源（formatPromptNavTime 也用后者），无需再手工同步。
      const compact = !showFullToolContent && !isHistoryLog;
      return compact ? formatHms(d) : formatMonthDayTime(d);
    } catch { return null; }
  }

  renderViewRequestBtn() {
    const { requestIndex, onViewRequest, showFullToolContent } = this.props;
    if (requestIndex == null || !onViewRequest) return null;
    if (!showFullToolContent) {
      return (
        <span
          className={styles.viewRequestIcon}
          title={t('ui.viewRequest')}
          onClick={(e) => { e.stopPropagation(); onViewRequest(requestIndex); }}
        >
          <ViewRequestIcon />
        </span>
      );
    }
    return (
      <span className={styles.viewRequestBtn} onClick={(e) => { e.stopPropagation(); onViewRequest(requestIndex); }}>
        {t('ui.viewRequest')}
      </span>
    );
  }

  renderLabel(name, extra) {
    const { timestamp } = this.props;
    const timeStr = this.formatTime(timestamp);
    return (
      <div className={styles.labelRow}>
        <Text type="secondary" className={styles.labelText}>{name}{extra || ''}</Text>
        <span className={styles.labelRight}>
          {this.renderViewRequestBtn()}
          {timeStr && <Text className={styles.timeText}>{timeStr}</Text>}
        </span>
      </div>
    );
  }

  renderModelAvatar(modelInfo) {
    if (modelInfo?.svg) {
      return (
        <div className={styles.avatar} style={{ background: modelInfo.color || 'var(--bg-model-avatar)' }}
          dangerouslySetInnerHTML={{ __html: modelInfo.svg }}
        />
      );
    }
    return <img src={defaultModelAvatarUrl} className={styles.avatarImg} alt={modelInfo?.name || 'Agent'} />;
  }

  // IM 对话记录里，助手（MainAgent）一侧的身份用所属 IM 平台的 logo + 名称呈现（imAgent = {name, Icon, color}）。
  // 平台图标是 currentColor 单色 svg，套进圆形头像容器：用 span 包一层避免命中 `.avatar > svg{width:100%}` 被撑满。
  renderImAgentAvatar(imAgent) {
    const Icon = imAgent.Icon;
    return (
      <div className={styles.avatar} style={{ background: 'var(--bg-model-avatar)', color: imAgent.color }}
        role="img" aria-label={imAgent.name}>
        {Icon ? <span className={styles.imAgentGlyph}><Icon size={20} /></span> : null}
      </div>
    );
  }

  // override = 该条消息的发送者身份（IM 来源时按 senderId 查到的 {name, avatar}）；缺省回落全局 userProfile。
  renderUserAvatar(bgColor, override) {
    const profile = override || this.props.userProfile;
    if (profile?.avatar) {
      return <img src={profile.avatar} className={styles.avatarImg} alt={profile.name || 'User'}
        onError={(e) => { e.target.onerror = null; e.target.src = defaultAvatarUrl; }} />;
    }
    return <img src={defaultAvatarUrl} className={styles.avatarImg} alt={profile?.name || 'User'} />;
  }

  getUserName(override) {
    const profile = override || this.props.userProfile;
    return profile?.name || 'User';
  }

  // IM 来源消息的发送者身份：从 marker 的 senderId 在 imSenderMap 里查 {name, avatar}；非 IM 或查无 → null。
  imSenderProfile(senderId) {
    if (!senderId) return null;
    const m = this.props.imSenderMap;
    const p = m && m[senderId];
    return (p && (p.name || p.avatar)) ? p : null;
  }

  renderSegments(segments, trailingCursor = false) {
    // 光标只给"最后一个可见 markdown segment"，跳过末尾的 system-tag
    let lastMdIdx = -1;
    if (trailingCursor) {
      for (let j = segments.length - 1; j >= 0; j--) {
        if (segments[j].type !== 'system-tag' && segments[j].content && segments[j].content.trim()) {
          lastMdIdx = j;
          break;
        }
      }
    }
    return segments.map((seg, i) => {
      if (seg.type === 'system-tag') {
        return (
          <Collapse
            key={i}
            ghost
            size="small"
            items={[{
              key: '1',
              label: <Text type="secondary" className={styles.systemTagLabel}>{seg.tag}</Text>,
              children: <pre className={styles.systemTagPre}>{seg.content}</pre>,
            }]}
            className={styles.collapseMargin}
          />
        );
      }
      return <MarkdownBlock key={i} text={seg.content} trailingCursor={i === lastMdIdx} />;
    });
  }

  // renderToolCall 拆分后各子方法共用的渲染原语（原 renderToolCall 内部闭包提升而来）。
  _toolBox(tu, label, children) {
    return (
      <div key={tu.id} className={styles.toolBox}>
        <Text strong className={styles.toolLabel}>{label}</Text>
        {children}
      </div>
    );
  }

  _toolCodePre(text) {
    return (
      <pre className={styles.codePre}>{text}</pre>
    );
  }

  _toolPathTag(p) {
    const onOpenFile = this.props.onOpenFile;
    return (
      onOpenFile
        ? <span className={styles.pathTagClickable} onClick={(e) => { e.stopPropagation(); onOpenFile(p); }}>{p}</span>
        : <span className={styles.pathTag}>{p}</span>
    );
  }

  renderToolCall(tu) {
    // 如果 input 是字符串（流式组装残留），尝试解析
    if (typeof tu.input === 'string') {
      try {
        const cleaned = tu.input.replace(/^\[object Object\]/, '');
        tu = { ...tu, input: JSON.parse(cleaned) };
      } catch {
        // 无法解析，保持原样
      }
    }

    // Edit → diff 视图
    if (tu.name === 'Edit' && tu.input && tu.input.old_string != null && tu.input.new_string != null) {
      return this._renderTool_Edit(tu);
    }

    const inp = (tu.input && typeof tu.input === 'object') ? tu.input : {};

    if (tu.name === 'Bash') return this._renderTool_Bash(tu, inp);

    if (tu.name === 'Read' || tu.name === 'Write' || tu.name === 'Glob' || tu.name === 'Grep') {
      return this._renderTool_SimpleOps(tu, inp);
    }

    if (tu.name === 'Task') return this._renderTool_Task(tu, inp);

    if (tu.name === 'AskUserQuestion') return this._renderTool_AskQuestion(tu, inp);

    if (tu.name === 'EnterPlanMode') return this._renderTool_EnterPlanMode(tu);

    if (tu.name === 'ExitPlanMode') return this._renderTool_ExitPlanMode(tu, inp);

    if (tu.name === 'SendMessage' && inp.message != null) {
      const node = this._renderTool_SendMessage(tu, inp);
      if (node) return node;
    }

    return this._renderTool_Default(tu, inp);
  }

  _renderTool_Edit(tu) {
    const editSnapshotMap = this.props.editSnapshotMap || {};
    const filePath = tu.input.file_path || '';
    let startLine = 1;
    const snapshot = editSnapshotMap[tu.id];
    if (snapshot && tu.input.old_string) {
      const idx = snapshot.plainText.indexOf(tu.input.old_string);
      if (idx >= 0) {
        const before = snapshot.plainText.substring(0, idx);
        const lineOffset = before.split('\n').length - 1;
        startLine = snapshot.lineNums[lineOffset] ?? (lineOffset + 1);
      }
    }
    return (
      <DiffView
        key={tu.id}
        file_path={filePath}
        old_string={tu.input.old_string}
        new_string={tu.input.new_string}
        startLine={startLine}
        onOpenFile={this.props.onOpenFile}
      />
    );
  }

  _renderTool_Bash(tu, inp) {
    const cmd = inp.command || '';
    const desc = inp.description || '';
    const lineCount = cmd.split('\n').length;
    // 如果命令超过5行，使用折叠组件
    if (lineCount > 5) {
      return (
        <div key={tu.id} className={styles.toolBox}>
          <Text strong className={styles.toolLabel}>
            Bash{desc ? <span className={styles.descSpan}> — {desc}</span> : ''}
          </Text>
          <Collapse
            ghost
            size="small"
            items={[{
              key: '1',
              label: <Text type="secondary" className={styles.bashCollapseLabel}>{t('ui.bashCommand')} ({lineCount} {t('ui.lines')})</Text>,
              children: this._toolCodePre(cmd),
            }]}
            className={styles.collapseMargin}
          />
        </div>
      );
    }
    return this._toolBox(
      tu,
      <>Bash{desc ? <span className={styles.descSpan}> — {desc}</span> : ''}</>,
      this._toolCodePre(cmd)
    );
  }

  _renderTool_SimpleOps(tu, inp) {
    // Read: show file path + range
    if (tu.name === 'Read') {
      const fp = inp.file_path || '';
      const parts = [];
      if (inp.offset) parts.push(`offset: ${inp.offset}`);
      if (inp.limit) parts.push(`limit: ${inp.limit}`);
      const range = parts.length ? ` (${parts.join(', ')})` : '';
      return this._toolBox(
        tu,
        <>Read: {this._toolPathTag(fp)}<span className={styles.secondarySpan}>{range}</span></>,
        null
      );
    }
    // Write: 整文件按 git diff 新增行渲染（old_string='' → 全部 add 行绿底），
    // 复用 Edit 的 DiffView（行号/+前缀/+N 统计/折叠/路径点击全套）。
    if (tu.name === 'Write' && inp.content != null) {
      return (
        <DiffView
          key={tu.id}
          label="Write:"
          file_path={inp.file_path || ''}
          old_string=""
          new_string={inp.content}
          startLine={1}
          onOpenFile={this.props.onOpenFile}
        />
      );
    }
    // Write 流式半截参数（content 还没到）：白底回退
    if (tu.name === 'Write') {
      const fp = inp.file_path || '';
      const content = inp.content || '';
      const lines = content.split('\n');
      return this._toolBox(
        tu,
        <>Write: {this._toolPathTag(fp)} <span className={styles.secondarySpan}>({lines.length} lines)</span></>,
        this._toolCodePre(content)
      );
    }
    // Glob: show pattern + path
    if (tu.name === 'Glob') {
      const pattern = inp.pattern || '';
      const path = inp.path || '';
      return this._toolBox(
        tu,
        <>Glob: <span className={styles.patternSpan}>{pattern}</span>{path ? <span className={styles.secondarySpan}> in {path}</span> : ''}</>,
        null
      );
    }
    // Grep: show pattern + path + options
    const pattern = inp.pattern || '';
    const path = inp.path || '';
    const opts = [];
    if (inp.glob) opts.push(`glob: ${inp.glob}`);
    if (inp.output_mode) opts.push(`mode: ${inp.output_mode}`);
    if (inp.head_limit) opts.push(`limit: ${inp.head_limit}`);
    const optsStr = opts.length ? ` (${opts.join(', ')})` : '';
    return this._toolBox(
      tu,
      <>Grep: <span className={styles.patternSpan}>/{pattern}/</span>{path ? <span className={styles.secondarySpan}> in {path}</span> : ''}<span className={styles.secondarySpan}>{optsStr}</span></>,
      null
    );
  }

  _renderTool_Task(tu, inp) {
    const st = inp.subagent_type || '';
    const desc = inp.description || '';
    return this._toolBox(
      tu,
      <>Task({st}{desc ? ': ' + desc : ''})</>,
      null
    );
  }

  _renderTool_AskQuestion(tu, inp) {
      // The streamed block's questions can be empty/hollow while stream assembly is still
      // in flight; for the currently-pending ask, fall back to the authoritative
      // pendingAsk.questions so large payloads (multi-question, big previews) never render
      // a blank popup. See resolveAskQuestions for the full selection rules.
      const questions = resolveAskQuestions(inp.questions, tu.id, this.props.lastPendingAskId, this.props.pendingAsk);
      const { askAnswerMap, toolResultMap } = this.props;
      const selectedAnswers = askAnswerMap?.[tu.id] || {};
      // 四态：cancelled / rejected / answered / pending
      // cancelled 是 cancel 按钮 / 输入框打字打断触发的乐观状态（ChatView handleAskCancel 写入），
      // 与 rejected 区分：rejected 是 server 端 schema 校验或 hook deny 等"未触达"语义。
      const isCancelled = selectedAnswers.__cancelled__ === true;
      const isRejected = !isCancelled && selectedAnswers.__rejected__ === true;
      const hasAnswers = !isRejected && !isCancelled && Object.keys(selectedAnswers).length > 0;
      const isPending = !hasAnswers && !isRejected && !isCancelled;
      const isInteractive = isPending && this.props.onAskQuestionSubmit && tu.id === this.props.lastPendingAskId;
      const validationError = toolResultMap?.[tu.id]?.isInputValidationError
        ? toolResultMap[tu.id].resultText
        : null;

      if (isInteractive) {
        const interactive = this.renderAskQuestionInteractive(tu.id, questions);
        return validationError ? (
          <div key={tu.id}>
            <AskValidationBadge resultText={validationError} />
            {interactive}
          </div>
        ) : interactive;
      }

      // Cancelled 终态：渲染问题文本但不交互，并显示一行"已取消"提示
      // (与 rejected 共用 askQuestionBox 容器，区分点是底部的 askCancelledNote)
      if (isCancelled) {
        const reason = typeof selectedAnswers.__cancelReason__ === 'string' && selectedAnswers.__cancelReason__
          ? selectedAnswers.__cancelReason__
          : t('ui.askCancelledByUser');
        return (
          <div key={tu.id} className={styles.askQuestionBox}>
            {questions.map((q, qi) => (
              <div key={qi} className={qi < questions.length - 1 ? styles.questionSpacing : undefined}>
                {q.header && <span className={styles.askQuestionHeader}>{q.header}</span>}
                <div className={styles.askQuestionText}>{q.question}</div>
              </div>
            ))}
            <div className={styles.askCancelledNote}>{reason}</div>
          </div>
        );
      }

      const checkSvg = (
        <svg className={styles.askCheckSvg} width="1em" height="1em" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
      // 队列里非 head 的 ask 是 isPending=true + isInteractive=false（lastPendingAskId 不匹配）。
      // 给只读卡片加 Skip 按钮让用户能跳过单个排队中的 ask（等价 terminal Esc）；isPending=false
      // 的（已答 / 已 reject）不显示按钮。
      const showSkipButton = isPending && !isInteractive && !!this.props.onAskQuestionCancel;
      return (
        <div key={tu.id} className={styles.askQuestionBox}>
          <AskValidationBadge resultText={validationError} />
          {questions.map((q, qi) => {
            const answer = selectedAnswers[q.question];
            const answerLabels = answer != null && q.multiSelect
              ? answer.split(',').map(s => s.trim())
              : [];
            const isOptionMatch = (optLabel) => {
              if (answer == null) return false;
              if (q.multiSelect) return answerLabels.includes(optLabel);
              return answer === optLabel;
            };
            const anyOptionMatched = q.options?.some(opt => isOptionMatch(opt.label));
            const isOtherAnswer = hasAnswers && answer != null && !anyOptionMatched;
            return (
              <div key={qi} className={qi < questions.length - 1 ? styles.questionSpacing : undefined}>
                {q.header && <span className={styles.askQuestionHeader}>{q.header}</span>}
                <div className={styles.askQuestionText}>{q.question}</div>
                <div className={styles.optionList}>
                  {q.options && q.options.map((opt, oi) => {
                    const selected = isOptionMatch(opt.label);
                    return (
                      <div key={oi} className={`${styles.askOptionItem}${selected ? ' ' + styles.askOptionSelected : ''}`}>
                        <span className={styles.askRadioDot}>{selected ? checkSvg : '○'}</span>
                        <span className={styles.askOptionBody}>
                          <span className={styles.askOptionLabel}>{opt.label}</span>
                          {hasOptionDescription(opt) && <span className={styles.askOptionDesc}>{opt.description}</span>}
                        </span>
                      </div>
                    );
                  })}
                  {isOtherAnswer && (
                    <div className={`${styles.askOptionItem} ${styles.askOptionSelected}`}>
                      <span className={styles.askRadioDot}>{checkSvg}</span>
                      <span className={styles.askOptionBody}>
                        <span className={styles.askOptionLabel}>{answer}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {showSkipButton && (
            <div className={styles.askSubmitRow}>
              <button
                type="button"
                className={styles.askCancelBtn}
                onClick={() => this.props.onAskQuestionCancel(tu.id, 'User aborted')}
              >
                {t('ui.askCancel')}
              </button>
            </div>
          )}
        </div>
      );
    }

  _renderTool_EnterPlanMode(tu) {
    return (
      <div key={tu.id} className={styles.planModeBox}>
        <span className={styles.planModeLabel}>{t('ui.enterPlanMode')}</span>
      </div>
    );
  }

  _renderTool_ExitPlanMode(tu, inp) {
      const prompts = inp.allowedPrompts || [];
      const { planApprovalMap } = this.props;
      const approval = (planApprovalMap && planApprovalMap[tu.id]) || { status: 'pending' };
      const isPending = approval.status === 'pending';
      const isInteractive = isPending && this.props.cliMode && tu.id === this.props.lastPendingPlanId;

      // pending 状态下提取 plan 内容（优先级从高到低）：
      // 1. tool_use.input.plan（Claude Code 2.x ExitPlanModeV2Tool 的 normalizeToolInput 注入）
      // 2. tool_use.input.planFilePath → 异步 fetch 缓存（multi-agent-room 等场景关键）
      // 3. 跨消息追踪的 latestPlanContent（Write 到 .claude/plans/ 的内容）
      // 4. 同一 response 中 Write 工具的内容
      // 5. ExitPlanMode 之前的 text blocks
      let planTextContent = null;
      if (isPending) {
        if (typeof inp.plan === 'string' && inp.plan.trim()) {
          planTextContent = inp.plan;
        }
        if (!planTextContent && typeof inp.planFilePath === 'string' && inp.planFilePath
          && this.props.planFileContents && this.props.planFileContents[inp.planFilePath]) {
          planTextContent = this.props.planFileContents[inp.planFilePath];
        }
        if (!planTextContent) planTextContent = this.props.latestPlanContent || null;
        if (!planTextContent && Array.isArray(this.props.content)) {
          for (const b of this.props.content) {
            if (b === tu) break;
            if (b.type === 'tool_use' && b.name === 'Write'
              && b.input?.file_path && /\.claude\/plans\//i.test(b.input.file_path)
              && b.input.content) {
              planTextContent = b.input.content;
            }
          }
        }
        if (!planTextContent && Array.isArray(this.props.content)) {
          const texts = [];
          for (const b of this.props.content) {
            if (b === tu) break;
            if (b.type === 'text' && b.text) texts.push(b.text);
          }
          planTextContent = texts.join('\n\n').trim() || null;
        }
      }

      // 已批准且有计划内容 → 渲染为蓝色边框的 plan 视图
      // approval.planContent 可能为空（V2 tool_result 文本不含 ## Approved Plan: 区块时），用 inp.plan / planFilePath 兜底
      if (approval.status === 'approved') {
        const approvedText = approval.planContent
          || (typeof inp.plan === 'string' && inp.plan.trim() ? inp.plan : '')
          || (typeof inp.planFilePath === 'string' && inp.planFilePath && this.props.planFileContents
            ? (this.props.planFileContents[inp.planFilePath] || '') : '');
        if (approvedText) {
          return (
            <div key={tu.id} className={styles.bubblePlan}>
              <MarkdownBlock text={approvedText} />
            </div>
          );
        }
      }

      // plan 审批选项：优先用 ptyPrompt 检测到的，否则用内置默认选项
      const detectedPrompt = isPlanApprovalPrompt(this.props.ptyPrompt)
        ? this.props.ptyPrompt
        : this.props.activePlanPrompt || null;
      const defaultPlanOptions = [
        { number: 1, text: t('ui.planApprove'), selected: true },
        { number: 2, text: t('ui.planApproveWithEdits'), selected: false },
        { number: 3, text: t('ui.planReject'), selected: false },
      ];
      const planOptions = (detectedPrompt?.options?.length) ? detectedPrompt.options : defaultPlanOptions;
      const statusClass = approval.status === 'approved' ? styles.planStatusApproved
        : approval.status === 'rejected' ? styles.planStatusRejected
        : approval.status === 'ultraplan' ? styles.planStatusApproved
        : styles.planStatusPending;
      const statusIcon = approval.status === 'approved' ? '✓'
        : approval.status === 'rejected' ? '✗'
        : approval.status === 'ultraplan' ? '⚡' : '●';
      const statusKey = approval.status === 'approved' ? 'ui.planApproved'
        : approval.status === 'rejected' ? 'ui.planRejected'
        : approval.status === 'ultraplan' ? 'ui.planUltraplan' : 'ui.planPending';
      const planModeBoxNode = (
        <div key={tu.id} className={`${styles.planModeBox} ${statusClass}`}>
          {isInteractive && (
            <svg className={`${styles.borderSvg} ${styles.borderSvgInset}`} preserveAspectRatio="none">
              <rect x="0" y="0" width="100%" height="100%" rx="6" ry="6"
                fill="none" stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="6 4"
                className={styles.borderRect} />
            </svg>
          )}
          <div className={styles.planModeHeader}>
            <span className={styles.planModeLabel}>{isPending ? t('ui.exitPlanMode') : t('ui.exitPlanModeResolved')}</span>
            {!isInteractive && (
              <span className={`${styles.planStatusBadge} ${statusClass}`}>{statusIcon} {t(statusKey)}</span>
            )}
          </div>
          {isPending && planTextContent && (
            <div className={styles.planContentPreview}>
              <MarkdownBlock text={planTextContent} />
            </div>
          )}
          {prompts.length > 0 && (
            <div className={styles.planModePermissions}>
              <div className={styles.planModePermLabel}>{t('ui.allowedPrompts')}</div>
              {prompts.map((p, pi) => (
                <div key={pi} className={styles.askOptionItem}>• {p.prompt || p.tool}</div>
              ))}
            </div>
          )}
          {isInteractive && !this.state.planFeedbackInput && (
            <div className={styles.planApprovalActions}>
              {this.state.planApprovalSubmitting ? (
                <button className={styles.planOptionBtn} disabled>{t('ui.askSubmitting')}</button>
              ) : planOptions.map((opt, optIdx) => {
                const txt = (opt.text || '').toLowerCase();
                let btnCls = styles.planOptionBtn;
                if (/yes|approve|accept|proceed/i.test(txt) || (detectedPrompt == null && optIdx === 0)) btnCls = styles.planApproveBtn;
                else if (/no|reject|deny|feedback/i.test(txt) || (detectedPrompt == null && optIdx === 2)) btnCls = styles.planRejectBtn;
                const isFeedbackOpt = /type|tell|change|feedback|edit/i.test(opt.text || '') || (detectedPrompt == null && optIdx === 1);
                return (
                  <button key={opt.number} className={btnCls} onClick={() => {
                    if (isFeedbackOpt) {
                      this.setState({ planFeedbackInput: true, planFeedbackOptNumber: opt.number, planFeedbackText: '' });
                    } else {
                      this.setState({ planApprovalSubmitting: true });
                      this.props.onPlanApprovalClick(opt.number);
                    }
                  }}>
                    {opt.text}
                  </button>
                );
              })}
            </div>
          )}
          {/* 「Plan 自动审批」倒计时提示行：开关开 + 正在倒计时（由 ChatView 下发 planAutoApproveCountdown）才显示。
              点「取消」转为手动审批（onCancelPlanAutoApprove），不影响下方批准/拒绝按钮。 */}
          {isInteractive && !this.state.planFeedbackInput && !this.state.planApprovalSubmitting
            && this.props.planAutoApproveCountdown != null && (
            <div className={styles.planAutoApproveHint}>
              <span>{t('ui.planAutoApprove.countdown', { count: this.props.planAutoApproveCountdown })}</span>
              <button
                type="button"
                className={styles.planAutoApproveCancel}
                onClick={() => this.props.onCancelPlanAutoApprove && this.props.onCancelPlanAutoApprove()}
              >
                {t('ui.planAutoApprove.cancel')}
              </button>
            </div>
          )}
          {isInteractive && this.state.planFeedbackInput && (
            <div className={styles.planFeedbackInputWrap}>
              <textarea
                className={styles.planFeedbackTextarea}
                placeholder={t('ui.planFeedbackPlaceholder')}
                value={this.state.planFeedbackText}
                onChange={e => this.setState({ planFeedbackText: e.target.value })}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    const text = this.state.planFeedbackText.trim();
                    if (text && this.props.onPlanFeedbackSubmit) {
                      this.props.onPlanFeedbackSubmit(this.state.planFeedbackOptNumber, text);
                      this.setState({ planFeedbackInput: false, planFeedbackText: '', planFeedbackOptNumber: null });
                    }
                  }
                }}
                autoFocus
                rows={3}
              />
              <div className={styles.planFeedbackBtnRow}>
                <button className={styles.planFeedbackCancelBtn} onClick={() => this.setState({ planFeedbackInput: false, planFeedbackText: '', planFeedbackOptNumber: null })}>
                  {t('ui.cancel')}
                </button>
                <button
                  className={styles.planFeedbackSendBtn}
                  disabled={!this.state.planFeedbackText.trim()}
                  onClick={() => {
                    const text = this.state.planFeedbackText.trim();
                    if (text && this.props.onPlanFeedbackSubmit) {
                      this.props.onPlanFeedbackSubmit(this.state.planFeedbackOptNumber, text);
                      this.setState({ planFeedbackInput: false, planFeedbackText: '', planFeedbackOptNumber: null });
                    }
                  }}
                >
                  {t('ui.planFeedbackSubmit')}
                </button>
              </div>
            </div>
          )}
          {approval.status === 'rejected' && approval.feedback && (
            <div className={styles.planFeedback}>
              <span className={styles.planFeedbackLabel}>{t('ui.planFeedback')}:</span> {approval.feedback}
            </div>
          )}
        </div>
      );
      // PTY plan portal: when the global modal is showing the same active plan id,
      // ReactDOM.createPortal moves this entire planModeBox subtree (including the feedback
      // textarea state) into the modal slot WITHOUT unmounting — local state survives.
      // Inline rendering resumes when modal is dismissed or the prompt resolves.
      // Only interactive cards qualify (resolved/historical cards never portal).
      // ptyPlanCardId 用 tu.id（ExitPlanMode tool_use id）作权威源，与 ChatView pendingPtyPlan.id（=lastPendingPlanId）同源。
      const ptyPlanCardId = isInteractive ? String(tu.id) : '';
      return (
        <ApprovalPortalContext.Consumer key={tu.id}>
          {(ctx) => {
            const match = !!(ctx?.ptyPlanSlot
              && ctx?.activePtyPlanId != null
              && ptyPlanCardId !== ''
              && String(ctx.activePtyPlanId) === ptyPlanCardId);
            return match ? ReactDOM.createPortal(planModeBoxNode, ctx.ptyPlanSlot) : planModeBoxNode;
          }}
        </ApprovalPortalContext.Consumer>
      );
    }

  // SendMessage → render message content directly (no tool shell)。
  // 返回 null = msg 既非 lifecycle 对象也非字符串,由 renderToolCall 落到 Default。
  _renderTool_SendMessage(tu, inp) {
      const to = inp.to || '';
      const msg = inp.message;
      // JSON lifecycle signal → compact status bubble
      if (typeof msg === 'object' && msg.type) {
        const statusKey = `ui.teammate.${msg.type}`;
        const statusText = t(statusKey, { name: to });
        const display = statusText === statusKey ? `${to}: ${msg.type}` : statusText;
        return (
          <div key={tu.id} className={styles.teammateStatusRow}>
            <span className={styles.teammateStatusBubble}>{display}</span>
          </div>
        );
      }
      // String message → direct markdown rendering with small header
      if (typeof msg === 'string') {
        const header = inp.summary ? `→ ${to} — ${inp.summary}` : `→ ${to}`;
        return (
          <div key={tu.id} className={styles.sendMessageBlock}>
            <div className={styles.sendMessageHeader}>{header}</div>
            <MarkdownBlock text={msg} />
          </div>
        );
      }
      return null;
  }

  // Default: structured key-value display
  _renderTool_Default(tu, inp) {
    let toolLabel = tu.name;
    const keys = Object.keys(inp);
    if (keys.length === 0) {
      return this._toolBox(tu, toolLabel, null);
    }
    const items = keys.map(k => {
      const v = inp[k];
      const vs = typeof v === 'string' ? v : JSON.stringify(v);
      const display = (tu.name === 'Agent' || tu.name === 'TaskCreate' || tu.name === 'TaskUpdate' || tu.name === 'SendMessage' || vs.length <= 200) ? vs : vs.substring(0, 200) + '...';
      return (
        <div key={k} className={styles.kvItem}>
          <span className={styles.kvKey}>{k}: </span>
          <span className={styles.kvValue}>{display}</span>
        </div>
      );
    });
    return this._toolBox(tu, toolLabel, <div className={styles.kvContainer}>{items}</div>);
  }

  renderDangerApproval(toolId, dangerPrompt) {
    if (!dangerPrompt) return null;
    const options = dangerPrompt.options || [];
    return (
      <div key={`danger-${toolId}`} className={styles.dangerApprovalBox}>
        <div className={styles.dangerApprovalHeader}>
          <span className={styles.dangerApprovalIcon}>⚠</span>
          <span className={styles.dangerApprovalLabel}>{t('ui.dangerApproval')}</span>
        </div>
        <div className={styles.dangerApprovalActions}>
          {options.map(opt => {
            const txt = (opt.text || '').toLowerCase();
            let btnCls = styles.dangerOptionBtn;
            if (/^no/i.test(txt) || /deny/i.test(txt)) btnCls = styles.dangerRejectBtn;
            else if (/^yes/i.test(txt) || /allow/i.test(txt)) btnCls = styles.dangerApproveBtn;
            return (
              <button key={opt.number} className={btnCls} onClick={() => {
                if (this.props.onDangerousApprovalClick) this.props.onDangerousApprovalClick(opt.number);
              }}>
                {opt.text}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  renderAskQuestionInteractive(toolId, questions) {
    const meta = this.props.askMetaMap && this.props.askMetaMap[toolId];
    const node = (
      <AskQuestionForm
        key={toolId}
        questions={questions}
        startedAt={meta?.startedAt}
        timeoutMs={meta?.timeoutMs}
        onSubmit={(answers) => {
          if (this.props.onAskQuestionSubmit) {
            this.props.onAskQuestionSubmit(answers, toolId, questions);
          }
        }}
        onCancel={this.props.onAskQuestionCancel
          ? () => this.props.onAskQuestionCancel(toolId, 'User aborted')
          : undefined}
      />
    );
    // The form keeps a single React instance regardless of which DOM mount it lands in.
    // When the global modal claims this toolId, portal into its slot — the inline parent
    // sees an empty placeholder so the chat layout stays stable. Otherwise render inline.
    return (
      <ApprovalPortalContext.Consumer>
        {(ctx) => {
          // 决策细节与三种 activeAskId 形态的解释：见 src/utils/askPortalMatcher.js
          if (!ctx || !ctx.askSlot) return node;
          if (shouldPortalAskForm(ctx.activeAskId, toolId, this.props.lastPendingAskId)) {
            return ReactDOM.createPortal(node, ctx.askSlot);
          }
          return node;
        }}
      </ApprovalPortalContext.Consumer>
    );
  }

  renderHighlightBubble(bubbleClass, children) {
    const { highlight } = this.props;
    const cls = `${bubbleClass}${highlight === 'active' ? ' ' + styles.bubbleHighlight : ''}${highlight === 'fading' ? ' ' + styles.bubbleHighlightFading : ''}`;
    const isUser = bubbleClass === styles.bubbleUser;
    return (
      <div className={`${cls} ${styles.bubbleRelative}`}>
        {(highlight === 'active' || highlight === 'fading') && (
          <svg className={`${styles.borderSvg}${highlight === 'fading' ? ' ' + styles.borderSvgFading : ''}`} preserveAspectRatio="none">
            <rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="8" ry="8"
              fill="none" stroke={isUser ? '#fff' : 'var(--color-primary)'} strokeWidth="1" strokeDasharray="6 4"
              className={styles.borderRect} />
          </svg>
        )}
        {children}
      </div>
    );
  }

  // Small IM-source icon shown left of the username (e.g. DingTalk). null when no/unknown source.
  renderImSourceBadge(imSource) {
    const entry = imSource && IM_SOURCE_ICONS[imSource];
    if (!entry) return null;
    const { Icon, color } = entry;
    const label = t(`ui.imSource.${imSource}`);
    return (
      <Tooltip title={label} mouseEnterDelay={0.3} placement="top">
        <span className={styles.imSourceIcon} role="img" aria-label={label}>
          <Icon size={13} style={{ color }} />
        </span>
      </Tooltip>
    );
  }

  renderUserMessage() {
    const { timestamp } = this.props;
    // Strip a leading IM-origin marker (⟦im:dingtalk⟧) so the bubble shows clean text; imSource
    // drives the IM icon shown left of the username. Normal typed messages have no marker.
    const { text, imSource, senderId } = parseImOrigin(this.props.text);
    // IM 发送者真实姓名/头像；IM 来源但未解析到身份时用中性「外部用户」+ 默认头像（而非本机 OS 用户）。
    const senderProfile = this.imSenderProfile(senderId)
      || (imSource ? { name: t('ui.imSender.external'), avatar: null } : null);
    const timeStr = this.formatTime(timestamp);
    const userName = this.getUserName(senderProfile);
    const imBadge = this.renderImSourceBadge(imSource);

    // 检测 /compact 消息
    const isCompact = text && text.includes('This session is being continued from a previous conversation that ran out of context');

    if (isCompact) {
      return (
        <div className={styles.messageRowEnd}>
          <div className={styles.contentColLimited}>
            <div className={styles.labelRow}>
              {timeStr && <Text className={styles.timeTextNoMargin}>{timeStr}</Text>}
              {this.renderViewRequestBtn()}
              <Text type="secondary" className={styles.labelTextRight}>{userName} — {t('ui.slashCommand.compact')}</Text>
            </div>
            {this.renderHighlightBubble(styles.bubbleUser, (
              <Collapse
                ghost
                size="small"
                items={[{
                  key: '1',
                  label: <Text className={styles.compactLabel}>{t('ui.compactSummary')}</Text>,
                  children: <pre className={styles.compactPre}>{text}</pre>,
                }]}
                className={styles.collapseNoMargin}
              />
            ))}
          </div>
          {this.renderUserAvatar('#1e40af', senderProfile)}
        </div>
      );
    }

    const slashLabel = getSlashCommandLabel(text);
    // Tooltip 只显裸命令(`/model` 而非 `/model <args>`),避免 /login 等带敏感
    // 参数的命令在 hover/移动端长按时把 token 暴露给旁观者。
    const bubbleContent = slashLabel != null
      ? (
        <Tooltip title={getSlashCommandTooltip(text)} mouseEnterDelay={0.3} placement="top">
          <span className={styles.slashCommandLabel}>{slashLabel}</span>
        </Tooltip>
      )
      : this.renderUserTextWithImages(text);

    return (
      <div className={styles.messageRowEnd}>
        <div className={styles.contentColLimited}>
          <div className={styles.labelRow}>
            {timeStr && <Text className={styles.timeTextNoMargin}>{timeStr}</Text>}
            {this.renderViewRequestBtn()}
            {imBadge
              ? (
                <span className={styles.imSourceNameGroup}>
                  {imBadge}
                  <Text type="secondary" className={styles.imSourceName}>{userName}</Text>
                </span>
              )
              : <Text type="secondary" className={styles.labelTextRight}>{userName}</Text>}
          </div>
          {this.renderHighlightBubble(styles.bubbleUser, bubbleContent)}
        </div>
        {this.renderUserAvatar('#1e40af', senderProfile)}
      </div>
    );
  }

  renderUserTextWithImages(text) {
    if (!text) return text || '';
    // 图片引用识别(含 [Image …]、引号路径、终端粘贴的裸上传路径)抽到 findUserImageRefs,
    // 便于单测覆盖三种写法。此处只负责把命中区间替换成 <ChatImage>、其余原样保留为文本。
    const refs = findUserImageRefs(text);
    if (refs.length === 0) return text;
    const parts = [];
    let lastIndex = 0;
    for (const ref of refs) {
      if (ref.index > lastIndex) {
        parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, ref.index)}</span>);
      }
      parts.push(
        <ChatImage
          key={`img-${ref.index}`}
          src={apiUrl(`/api/file-raw?path=${encodeURIComponent(ref.path)}`)}
          alt={ref.path.split('/').pop()}
          fallbackText={ref.raw}
        />
      );
      lastIndex = ref.index + ref.raw.length;
    }
    if (lastIndex < text.length) {
      parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
    }
    return <>{parts}</>;
  }

  // 紧凑模式工具按钮的 Popover 渲染。两处 caller(_renderAssistantContentLegacy 与
  // _renderAssistantContentInOrder)使用完全相同的逻辑,抽出统一维护;tr 为 toolResultMap[tu.id],
  // 可能 undefined(末轮未返回 / WebSearch / 历史未到位),compactResultPreview 内部短路返回 null。
  _renderSimplifiedToolPill(tu, tr) {
    // 用函数式 content 让 AntD 在 hover 触发前不构造预览(大 base64 图场景下显著省 CPU);
    // destroyTooltipOnHide 配合 hover 关闭后释放 DOM,避免 detached node 持有图片字节。
    const renderContent = () => {
      const preview = compactResultPreview(tr);
      return (
        <div className={styles.simplifiedToolPopoverContent}>
          {this.renderToolCall(tu)}
          {preview && (
            <div className={styles.simplifiedToolResultPreview}>
              {preview.images && preview.images.map((img, idx) => (
                img.oversized ? (
                  <div key={`img-${idx}`} className={styles.simplifiedToolResultImagePlaceholder}>
                    {`[image ${(img.mediaType || '').replace('image/', '')} · ${Math.round(img.sizeBytes / 1024)} KB · too large to preview]`}
                  </div>
                ) : (
                  <img
                    key={`img-${idx}`}
                    src={img.src}
                    alt={img.mediaType || 'image'}
                    className={styles.simplifiedToolResultImage}
                    loading="lazy"
                  />
                )
              ))}
              {preview.text && <div className={styles.simplifiedToolResultText}>{preview.text}</div>}
            </div>
          )}
        </div>
      );
    };
    return (
      <Popover
        key={`stag-${tu.id}`}
        placement="top"
        overlayClassName="simplifiedToolPopover"
        overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: 0 }}
        content={renderContent}
        destroyTooltipOnHide
        mouseEnterDelay={0.5}
        {...((isMobile && !isPad) ? { trigger: 'click', ...(!isIOS && { getPopupContainer: (node) => node.parentElement }) } : {})}
      >
        <span className={styles.simplifiedToolTag}>{tu.name}</span>
      </Popover>
    );
  }

  renderToolResult(tr) {
    if (!tr) return null;
    return (
      <ToolResultView toolName={tr.toolName} toolInput={tr.toolInput} resultText={tr.resultText} images={tr.images} workflow={tr.workflow} defaultCollapsed={this.props.collapseToolResults} />
    );
  }

  renderAssistantContent(content, toolResultMap = {}, opts = {}) {
    const enableWebSearchGrouping = opts.enableWebSearchGrouping ?? true;
    if (enableWebSearchGrouping && Array.isArray(content)) {
      const { groups, consumedIndices } = extractWebSearchGroups(content);
      if (groups.length > 0) {
        return this._renderAssistantContentInOrder(content, toolResultMap, groups, consumedIndices);
      }
    }
    return this._renderAssistantContentLegacy(content, toolResultMap);
  }

  // legacy 与 in-order 两渲染器共用：thinking 块的 antd Collapse。
  // 调用方负责算好 tIdx(决定 key)与 isCursorTarget,本方法绝不重算下标——
  // 保证两渲染器各自 key 与现状逐字一致(zero behavior change)。
  _renderThinkingEntry(thinkingText, isEmpty, isCursorTarget, tIdx, streamThinkingExpanded) {
    const showTC = !!this.props.showTrailingCursor;
    // 流式走 controlled activeKey（稳定 key + 变化 activeKey 触发 antd 高度 transition）。
    // 非流式走 uncontrolled defaultActiveKey,key 含 e/c 标识让切 expandThinking 时重挂响应新 prop。
    const collapseProps = showTC
      ? { key: `think-stream-${tIdx}`, activeKey: streamThinkingExpanded ? ['1'] : [] }
      : { key: `think-${tIdx}-${this.props.expandThinking ? 'e' : 'c'}`, defaultActiveKey: this.props.expandThinking ? ['1'] : [] };
    return (
      <Collapse
        {...collapseProps}
        ghost
        size="small"
        items={[{
          key: '1',
          label: <Text type="secondary" className={styles.thinkingLabel}>{t('ui.thinking')}</Text>,
          children: isEmpty ? (
            <div className={styles.thinkingEmptyHint}>
              <Text type="secondary" className={styles.thinkingEmptyText}>{t('ui.thinkingEmpty')}</Text>
              {!this.props.showThinkingSummaries && (
                <Tooltip title={tc('ui.enableThinkingSummariesTip')}>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    className={styles.enableThinkingBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      this.context.updateClaudeSettings({ showThinkingSummaries: true })
                        .then(data => {
                          if (data) message.success(tc('ui.enableThinkingSummariesTip'));
                          else message.error('Failed to save setting');
                        });
                    }}
                  >
                    {t('ui.enableThinkingSummaries')}
                  </Button>
                </Tooltip>
              )}
            </div>
          ) : (
            <MarkdownBlock text={thinkingText} trailingCursor={isCursorTarget} />
          ),
        }]}
        className={`${styles.collapseMargin}${showTC ? ' ' + styles.collapseStream : ''}`}
      />
    );
  }

  // legacy 与 in-order 两渲染器共用：tool_use 的尾随 tool_result 块。返回 node 或 null
  // (null = 该 tr 不渲染:已批准 ExitPlanMode 跳过 / 简化模式非权限拒绝)。所有 key 基于 tu.id。
  _renderToolResultTrailing(tu, tr) {
    if (!tr) return null;
    const simplify = !this.props.showFullToolContent;
    // 已批准的 ExitPlanMode 计划内容已在 renderToolCall 中渲染，隐藏重复的 tool_result
    const planApprovalMap = this.props.planApprovalMap || {};
    const approval = planApprovalMap[tu.id];
    if (tu.name === 'ExitPlanMode' && approval && approval.status === 'approved' && approval.planContent) {
      return null;
    }
    const deniedNode = (
      <React.Fragment key={`tr-denied-${tu.id}`}>
        {tr.isUltraplan ? (
          <div className={styles.ultraplanBadge}>◇ UltraPlan</div>
        ) : (
          <div className={`${styles.dangerApprovalBox} ${styles.dangerApprovalBoxDenied}`}>
            <span className={styles.dangerDeniedBadge}>✗ {t('ui.dangerDenied')}</span>
          </div>
        )}
      </React.Fragment>
    );
    // Workflow 工具的结果是工作流面板（phases/agents，含运行中逐帧），始终完整渲染，
    // 不随简化模式隐藏。
    const alwaysFullResult = tu.name === 'Workflow';
    if (simplify && !alwaysFullResult) {
      // 简化模式：仅显示权限拒绝，隐藏其他 tool_result
      return tr.isPermissionDenied ? deniedNode : null;
    }
    if (tr.isPermissionDenied) return deniedNode;
    return (
      <React.Fragment key={`tr-${tu.id}`}>{this.renderToolResult(tr)}</React.Fragment>
    );
  }

  _renderAssistantContentLegacy(content, toolResultMap = {}) {
    const textBlocks = content.filter(b => b.type === 'text');
    const toolUseBlocks = content.filter(b => b.type === 'tool_use');

    // 流式光标分发：有 text 时贴在最后一段 text 的末尾；否则贴在合并后的 thinking 末尾
    const showTC = !!this.props.showTrailingCursor;
    const hasTextWithContent = textBlocks.some(b => b.text && b.text.trim());
    const lastTextIdxWithContent = showTC && hasTextWithContent
      ? textBlocks.reduce((acc, b, i) => (b.text && b.text.trim() ? i : acc), -1)
      : -1;
    // 流式 thinking 展开策略：text 未开始则展开让用户看推理；text 开始后按用户偏好（通常折叠）。
    // 走 antd Collapse controlled 模式（activeKey）+ 稳定 React key，activeKey 变化触发
    // 内置 height transition 动画，避免流式结束切到正式 entry 时的瞬时高度跳变。
    const streamThinkingExpanded = !hasTextWithContent || !!this.props.expandThinking;

    let innerContent = [];

    // 同一请求内的多个 thinking 块（interleaved thinking）合并为单个「思考过程」，段间用 --- 分隔
    const mergedThinking = mergeThinkingBlocks(content);
    if (mergedThinking.count > 0) {
      const isCursorTarget = showTC && !hasTextWithContent && !mergedThinking.isEmpty;
      innerContent.push(this._renderThinkingEntry(mergedThinking.text, mergedThinking.isEmpty, isCursorTarget, 0, streamThinkingExpanded));
    }

    textBlocks.forEach((tb, i) => {
      if (tb.text) {
        const { segments } = renderAssistantText(tb.text);
        const isCursorTarget = i === lastTextIdxWithContent;
        innerContent.push(
          <div key={`text-${i}`} className="chat-boxer">{this.renderSegments(segments, isCursorTarget)}</div>
        );
      }
    });

    const simplify = !this.props.showFullToolContent;
    let simplifiedLabelAdded = false;
    toolUseBlocks.forEach((tu, tuIdx) => {
      const isFullDisplayTool = tu.name === 'Edit' || tu.name === 'Write' || tu.name === 'EnterPlanMode' || tu.name === 'ExitPlanMode' || tu.name === 'AskUserQuestion' || tu.name === 'Agent' || tu.name === 'TaskCreate' || tu.name === 'SendMessage' || tu.name === 'Workflow';
      const tr = toolResultMap[tu.id];
      if (simplify && !isFullDisplayTool) {
        // 简化模式：首个标签前加 "使用工具: " 标签
        if (!simplifiedLabelAdded) {
          simplifiedLabelAdded = true;
          innerContent.push(
            <span key={`stag-label-${tuIdx}`} className={styles.simplifiedToolLabel}>{t('ui.toolsUsed')}</span>
          );
        }
        // 简化模式：非 Edit/Write 工具只显示标签，hover/click 显示完整内容
        innerContent.push(this._renderSimplifiedToolPill(tu, tr));
      } else {
        simplifiedLabelAdded = false; // 遇到完整展示工具后重置，下一组简化标签前重新显示 label
        innerContent.push(this.renderToolCall(tu));
      }

      // 危险操作审批卡片：第一个无 tool_result 的 tool_use + 有活跃的 dangerous prompt
      const isFirstPendingTool = !tr && !toolUseBlocks.slice(0, tuIdx).some(t2 => !toolResultMap[t2.id]);
      if (isFirstPendingTool && this.props.activeDangerousPrompt && this.props.cliMode) {
        const dp = this.props.activeDangerousPrompt;
        innerContent.push(this.renderDangerApproval(tu.id, dp));
      }

      // 权限拒绝的 tool_result 加红色标记（共享 helper，返回 node|null）
      const trNode = this._renderToolResultTrailing(tu, tr);
      if (trNode) innerContent.push(trNode);
    });

    return innerContent;
  }

  _renderAssistantContentInOrder(content, toolResultMap, groups, consumedIndices) {
    const showTC = !!this.props.showTrailingCursor;
    const innerContent = [];

    // 光标：找 content 全局最后一个非空 text 块（含 group 内 synthesis），用 global index 对齐
    let lastTextGlobalIdx = -1;
    let hasTextWithContent = false;
    for (let i = 0; i < content.length; i++) {
      const b = content[i];
      if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        hasTextWithContent = true;
        if (showTC) lastTextGlobalIdx = i;
      }
    }
    const streamThinkingExpanded = !hasTextWithContent || !!this.props.expandThinking;

    // 1. thinking 顶部合并为单个「思考过程」（与 legacy 一致；thinking 永远不在 consumedIndices 里）
    //    同一请求内的多个 thinking 块（interleaved thinking）合并，段间用 --- 分隔
    const mergedThinking = mergeThinkingBlocks(content);
    if (mergedThinking.count > 0) {
      const isCursorTarget = showTC && !hasTextWithContent && !mergedThinking.isEmpty;
      innerContent.push(this._renderThinkingEntry(mergedThinking.text, mergedThinking.isEmpty, isCursorTarget, 0, streamThinkingExpanded));
    }

    // 2. 工具调用辅助：维护非 consumed 的 tool_use 列表，用于 isFirstPendingTool 判断
    const toolUseGlobalIndices = [];
    for (let i = 0; i < content.length; i++) {
      if (content[i] && content[i].type === 'tool_use' && !consumedIndices.has(i)) {
        toolUseGlobalIndices.push(i);
      }
    }
    const simplify = !this.props.showFullToolContent;
    let simplifiedLabelAdded = false;

    // 3. groups 索引：globalIndex → group object（按 serverToolUseIndex 或 webSearchResultIndex）
    const groupStartMap = new Map();
    for (const g of groups) {
      const startIdx = g.serverToolUseIndex >= 0 ? g.serverToolUseIndex : g.webSearchResultIndex;
      groupStartMap.set(startIdx, g);
    }

    // 4. 按 content 原始顺序遍历
    for (let i = 0; i < content.length; i++) {
      const block = content[i];
      if (!block) continue;
      if (block.type === 'thinking') continue; // 已在第 1 步渲染

      if (groupStartMap.has(i)) {
        const g = groupStartMap.get(i);
        innerContent.push(this._renderWebSearchGroup(g, content, lastTextGlobalIdx, showTC, `wsg-${i}`));
        continue;
      }

      if (consumedIndices.has(i)) continue; // group 内部块，已包含在 group 中

      if (block.type === 'text') {
        if (!block.text) continue;
        const { segments } = renderAssistantText(block.text);
        const isCursorTarget = i === lastTextGlobalIdx;
        innerContent.push(
          <div key={`text-${i}`} className="chat-boxer">{this.renderSegments(segments, isCursorTarget)}</div>
        );
        continue;
      }

      if (block.type === 'tool_use') {
        const tu = block;
        const tuIdxInList = toolUseGlobalIndices.indexOf(i);
        const isFullDisplayTool = tu.name === 'Edit' || tu.name === 'Write' || tu.name === 'EnterPlanMode' || tu.name === 'ExitPlanMode' || tu.name === 'AskUserQuestion' || tu.name === 'Agent' || tu.name === 'TaskCreate' || tu.name === 'SendMessage' || tu.name === 'Workflow';
        const tr = toolResultMap[tu.id];
        if (simplify && !isFullDisplayTool) {
          if (!simplifiedLabelAdded) {
            simplifiedLabelAdded = true;
            innerContent.push(
              <span key={`stag-label-${i}`} className={styles.simplifiedToolLabel}>{t('ui.toolsUsed')}</span>
            );
          }
          innerContent.push(this._renderSimplifiedToolPill(tu, tr));
        } else {
          simplifiedLabelAdded = false;
          innerContent.push(this.renderToolCall(tu));
        }
        const isFirstPendingTool = !tr && tuIdxInList >= 0 && !toolUseGlobalIndices.slice(0, tuIdxInList).some(gi => !toolResultMap[content[gi].id]);
        if (isFirstPendingTool && this.props.activeDangerousPrompt && this.props.cliMode) {
          const dp = this.props.activeDangerousPrompt;
          innerContent.push(this.renderDangerApproval(tu.id, dp));
        }

        const trNode = this._renderToolResultTrailing(tu, tr);
        if (trNode) innerContent.push(trNode);
        continue;
      }

      // 其他未知 block type：忽略（保持与 legacy 一致的静默丢弃行为，仅 web_search 被特化）
    }

    return innerContent;
  }

  _renderWebSearchGroup(group, content, lastTextGlobalIdx, showTC, keyPrefix) {
    const { serverToolUse, webSearchResult, synthesisTextIndices } = group;
    const query = serverToolUse?.input?.query || '';
    const results = (webSearchResult && Array.isArray(webSearchResult.content))
      ? webSearchResult.content.filter(r => r && r.type === 'web_search_result')
      : [];

    const hasCitations = synthesisTextIndices.some(gi => {
      const tb = content[gi];
      return tb && Array.isArray(tb.citations) && tb.citations.length > 0;
    });

    // 合并 synthesis text 为单块 markdown：每段原始 text 之间用 \n\n---\n\n 分隔，
    // 让 marked 自然渲染成 <hr>（命中 .chat-md hr 全局样式），避免之前多个 chat-boxer 视觉碎片化。
    // 注：parseSystemTags 正则非块边界依赖，join 不破坏 system-tag 提取。
    // trade-off：原 citations 数组与具体段落的对应关系丢失（hasCitations bool 仍保留）。
    const mergedSynthesisText = synthesisTextIndices
      .map(gi => content[gi]?.text)
      .filter(t => typeof t === 'string' && t.trim() && t.trim() !== '---')
      .map(t => t.trim())
      .join('\n\n---\n\n');

    const synthesisNodes = [];
    if (mergedSynthesisText) {
      const synthesisIsCursorTarget = synthesisTextIndices.some(gi => gi === lastTextGlobalIdx);
      const { segments } = renderAssistantText(mergedSynthesisText);
      synthesisNodes.push(
        <div key="syn-merged" className="chat-boxer">{this.renderSegments(segments, synthesisIsCursorTarget)}</div>
      );
    }

    const isStreamingPlaceholder = showTC && !webSearchResult && synthesisNodes.length === 0;
    const containerCls = `${styles.webSearchGroup}${isStreamingPlaceholder ? ' ' + styles.webSearchGroupStreaming : ''}`;

    return (
      <div key={keyPrefix} className={containerCls}>
        <div className={styles.webSearchGroupHeader}>
          <SearchOutlined aria-hidden="true" />
          <span>
            {serverToolUse
              ? t('ui.webSearchQuery', { query: query || '...' })
              : t('ui.webSearchResultCount', { count: results.length })}
          </span>
          {serverToolUse && webSearchResult && (
            <span className={styles.webSearchGroupCount}>
              {t('ui.webSearchResultCount', { count: results.length })}
            </span>
          )}
        </div>
        {webSearchResult ? (
          <WebSearchResultsView results={results} />
        ) : serverToolUse ? (
          <div className={styles.webSearchPlaceholder}>{t('ui.webSearchSearching')}</div>
        ) : null}
        {synthesisNodes.length > 0 && (
          <div className={styles.webSearchSynthesis}>
            {synthesisNodes}
            {hasCitations && (
              <div className={styles.webSearchCitationHint}>
                {t('ui.webSearchCitedHint')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  renderAssistantMessage() {
    const { content, toolResultMap = {}, modelInfo, timestamp, requestIndex, onViewRequest, showTrailingCursor, cacheTotalTokens, showFullToolContent, imAgent, isTeammate, label } = this.props;
    const innerContent = this.renderAssistantContent(content, toolResultMap);

    if (innerContent.length === 0) return null;

    // Teammate session logs render the transcript's assistant turns with the
    // TEAMMATE's identity (portrait + name label) — model identity here would
    // read as the MainAgent speaking in the teammate's own log. Main-view
    // assistant rows never carry isTeammate/label, so this branch is inert
    // outside _buildTeammateFallbackItems.
    const ta = isTeammate && label ? getTeammateAvatar(label, { animated: this.props.animateAvatar !== false }) : null;

    return (
      <div className={styles.messageRow}>
        {ta
          ? <div className={styles.avatar} style={{ background: ta.color }} dangerouslySetInnerHTML={{ __html: ta.svg }} />
          : (imAgent ? this.renderImAgentAvatar(imAgent) : <ModelAvatar modelInfo={modelInfo} streaming={!!showTrailingCursor} />)}
        <div className={styles.contentCol}>
          <AssistantLabel
            name={ta ? label : (imAgent ? imAgent.name : (modelInfo?.name || 'MainAgent'))}
            timeStr={this.formatTime(timestamp)}
            requestIndex={requestIndex}
            onViewRequest={onViewRequest}
            cacheTotalTokens={cacheTotalTokens}
            showFullToolContent={showFullToolContent}
          />
          {this.renderHighlightBubble(styles.bubbleAssistant, innerContent)}
        </div>
      </div>
    );
  }

  _getSubAvatarType() {
    if (this.props.isTeammate) return 'teammate';
    const label = this.props.label || '';
    const match = label.match(/SubAgent:\s*(\w+)/i);
    const st = match ? match[1].toLowerCase() : '';
    if (st === 'explore' || st === 'search') return 'sub-search';
    if (st === 'plan') return 'sub-plan';
    return 'sub';
  }

  renderSubAgentChatMessage() {
    const { content, toolResultMap = {}, label, cacheTotalTokens, showFullToolContent } = this.props;
    const innerContent = this.renderAssistantContent(content, toolResultMap);

    if (innerContent.length === 0) return null;
    const showCache = showFullToolContent && cacheTotalTokens != null;
    const cacheStr = showCache ? formatCacheK(cacheTotalTokens) : '';

    return (
      <div className={styles.messageRowEnd}>
        <div className={styles.contentColLimited}>
          <div className={styles.labelRowEnd}>
            {showCache && (
              <Text
                className={styles.cacheContextText}
                title={t('ui.cacheContextTooltip', { value: cacheStr })}
              >
                {`[${cacheStr}]`}
              </Text>
            )}
            {this.formatTime(this.props.timestamp) && <Text className={styles.timeText}>{this.formatTime(this.props.timestamp)}</Text>}
            {this.renderViewRequestBtn()}
            <Text type="secondary" className={styles.labelTextRight}>{label || 'SubAgent'}</Text>
          </div>
          {this.renderHighlightBubble(styles.bubbleAssistant, innerContent)}
        </div>
        {(() => { const ta = this.props.isTeammate ? getTeammateAvatar(label, { animated: this.props.animateAvatar !== false }) : null; return (
          <div className={styles.avatar} style={{ background: ta ? ta.color : 'var(--bg-sub-avatar)' }}
            dangerouslySetInnerHTML={{ __html: ta ? ta.svg : getSvgAvatar(this._getSubAvatarType()) }}
          />
        ); })()}
      </div>
    );
  }

  renderSubAgentMessage() {
    const { label, resultText, toolName, toolInput, images, workflow } = this.props;
    const tmAvatar = this.props.isTeammate ? getTeammateAvatar(label, { animated: this.props.animateAvatar !== false }) : null;
    return (
      <div className={styles.messageRow}>
        <div className={styles.avatar} style={{ background: tmAvatar ? tmAvatar.color : 'var(--bg-sub-avatar)' }}
          dangerouslySetInnerHTML={{ __html: tmAvatar ? tmAvatar.svg : getSvgAvatar(this._getSubAvatarType()) }}
        />
        <div className={styles.contentCol}>
          {this.renderLabel(label)}
          <div className={styles.bubbleSubAgent}>
            <ToolResultView toolName={toolName} toolInput={toolInput} resultText={resultText} images={images} workflow={workflow} />
          </div>
        </div>
      </div>
    );
  }

  renderTeammateMessage() {
    const { text, label, timestamp } = this.props;
    const timeStr = this.formatTime(timestamp);
    const ta = getTeammateAvatar(label, { animated: this.props.animateAvatar !== false });

    return (
      <div className={styles.messageRowEnd}>
        <div className={styles.contentColLimited}>
          <div className={styles.labelRowEnd}>
            {timeStr && <Text className={styles.timeText}>{timeStr}</Text>}
            {this.renderViewRequestBtn()}
            <Text type="secondary" className={styles.labelTextRight}>{label || 'Teammate'}</Text>
          </div>
          {this.renderHighlightBubble(styles.bubbleAssistant, (
            <MarkdownBlock text={text || ''} />
          ))}
        </div>
        <div className={styles.avatar} style={{ background: ta ? ta.color : 'var(--bg-sub-avatar)' }}
          dangerouslySetInnerHTML={{ __html: ta ? ta.svg : getSvgAvatar('sub') }}
        />
      </div>
    );
  }

  renderTeammateStatus() {
    const { label, toolName } = this.props;
    const statusKey = `ui.teammate.${toolName}`;
    const statusText = t(statusKey, { name: label || 'Teammate' });
    const display = statusText === statusKey
      ? `${label || 'Teammate'}: ${toolName}`
      : statusText;
    return (
      <div className={styles.teammateStatusRowCenter}>
        <span className={styles.teammateStatusBubble}>{display}</span>
      </div>
    );
  }

  renderPlanPromptMessage() {
    const { text, timestamp, modelInfo } = this.props;
    const timeStr = this.formatTime(timestamp);
    // 去掉前导系统标签和 plan 前缀
    const planContent = (text || '').replace(/^[\s\S]*?Implement the following plan:\s*/i, '');

    return (
      <div className={styles.messageRow}>
        {this.renderModelAvatar(modelInfo)}
        <div className={styles.contentColLimited}>
          {this.renderLabel(modelInfo?.name || 'MainAgent', ' (Plan)')}
          <div className={styles.bubblePlan}>
            <MarkdownBlock text={planContent} />
          </div>
        </div>
      </div>
    );
  }

  renderSkillLoadedMessage() {
    const { text, skillName, timestamp } = this.props;
    const timeStr = this.formatTime(timestamp);
    return (
      <div className={styles.messageRow}>
        <div className={styles.skillSpacer} />
        <div className={styles.contentCol}>
          <Collapse
            ghost
            size="small"
            items={[{
              key: '1',
              label: (
                <span className={styles.skillLabel}>
                  📦 {t('ui.skillLoaded')}: {skillName}
                  {timeStr && <Text className={`${styles.timeTextNoMargin} ${styles.skillTimeIndent}`}>{timeStr}</Text>}
                </span>
              ),
              children: <MarkdownBlock text={text} />,
            }]}
            className={styles.collapseNoMargin}
          />
        </div>
      </div>
    );
  }

  renderSystemMessage() {
    // Mid-conversation role:"system" messages (mid-conversation-system beta):
    // housekeeping notices (task reminders, "Exited Plan Mode", ...). Rendered as a
    // subtle collapsed meta row, same shape as skill-loaded messages.
    const { text, timestamp } = this.props;
    if (!text || !String(text).trim()) return null;
    const timeStr = this.formatTime(timestamp);
    return (
      <div className={styles.messageRow}>
        <div className={styles.skillSpacer} />
        <div className={styles.contentCol}>
          <Collapse
            ghost
            size="small"
            items={[{
              key: '1',
              label: (
                <span className={styles.systemMsgLabel}>
                  ⚙️ {t('ui.systemMessage')}
                  {timeStr && <Text className={`${styles.timeTextNoMargin} ${styles.skillTimeIndent}`}>{timeStr}</Text>}
                </span>
              ),
              children: <MarkdownBlock text={String(text)} />,
            }]}
            className={styles.collapseNoMargin}
          />
        </div>
      </div>
    );
  }

  renderTaskNotification() {
    const { taskNotification: tn, modelInfo } = this.props;
    if (!tn) return null;
    const isError = tn.status === 'error';
    const statusIcon = isError ? '✗' : '✓';
    const statusColor = isError ? '#ff4d4f' : '#52c41a';

    const durationSec = tn.usage?.durationMs ? (tn.usage.durationMs / 1000).toFixed(1) : null;
    const tokens = tn.usage?.totalTokens ? tn.usage.totalTokens.toLocaleString() : null;
    const toolUses = tn.usage?.toolUses || null;

    const innerContent = [];
    // summary 作为标准文本
    innerContent.push(
      <div key="summary" className="chat-boxer">
        <span style={{ color: statusColor, fontWeight: 'bold', marginRight: 6 }}>{statusIcon}</span>
        {tn.summary || 'Background Task'}
      </div>
    );
    // result 折叠展开
    if (tn.result) {
      innerContent.push(
        <Collapse key="result" ghost size="small" items={[{
          key: '1',
          label: <Typography.Text type="secondary">{t('ui.taskNotification.result') || 'Result'}</Typography.Text>,
          children: <MarkdownBlock text={tn.result} />,
        }]} />
      );
    }
    // usage 统计行
    if (durationSec || tokens || toolUses) {
      innerContent.push(
        <div key="usage" className={styles.taskNotifUsage}>
          {durationSec && <span>{durationSec}s</span>}
          {tokens && <span>{tokens} tokens</span>}
          {toolUses && <span>{toolUses} tool uses</span>}
        </div>
      );
    }

    return (
      <div className={styles.messageRow}>
        {this.renderModelAvatar(modelInfo)}
        <div className={styles.contentCol}>
          {this.renderLabel(modelInfo?.name || 'MainAgent')}
          {this.renderHighlightBubble(styles.bubbleAssistant, innerContent)}
        </div>
      </div>
    );
  }

  render() {
    const { role } = this.props;
    if (role === 'user') return this.renderUserMessage();
    if (role === 'skill-loaded') return this.renderSkillLoadedMessage();
    if (role === 'system') return this.renderSystemMessage();
    if (role === 'plan-prompt') return this.renderPlanPromptMessage();
    if (role === 'assistant') return this.renderAssistantMessage();
    if (role === 'task-notification') return this.renderTaskNotification();
    if (role === 'teammate-message') return this.renderTeammateMessage();
    if (role === 'teammate-status') return this.renderTeammateStatus();
    if (role === 'sub-agent-chat') return this.renderSubAgentChatMessage();
    if (role === 'sub-agent') return this.renderSubAgentMessage();
    return null;
  }
}

export default ChatMessage;
