import React from 'react';
import { Collapse, Typography, Radio, Checkbox, Input, Button, Tooltip, Popover, message } from 'antd';
import { renderMarkdown } from '../utils/markdown';
import { escapeHtml, truncateText, getSvgAvatar } from '../utils/helpers';
import { getTeammateAvatar } from '../utils/teammateAvatars';
import { renderAssistantText } from '../utils/systemTags';
import { apiUrl } from '../utils/apiUrl';
import { isMobile } from '../env';
import AskQuestionForm from './AskQuestionForm';
import { t } from '../i18n';
import { isPlanApprovalPrompt } from '../utils/promptClassifier';
import DiffView from './DiffView';
import ToolResultView from './ToolResultView';

import ImageLightbox from './ImageLightbox';
import defaultAvatarUrl from '../img/default-avatar.svg';
import defaultModelAvatarUrl from '../img/default-model-avatar.svg';
import styles from './ChatMessage.module.css';

const { Text } = Typography;

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


class ChatMessage extends React.Component {
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
      p.timestamp !== n.timestamp || p.highlight !== n.highlight ||
      p.collapseToolResults !== n.collapseToolResults || p.expandThinking !== n.expandThinking || p.showFullToolContent !== n.showFullToolContent ||
      p.showThinkingSummaries !== n.showThinkingSummaries ||
      p.toolResultMap !== n.toolResultMap || p.readContentMap !== n.readContentMap ||
      p.editSnapshotMap !== n.editSnapshotMap || p.askAnswerMap !== n.askAnswerMap ||
      p.planApprovalMap !== n.planApprovalMap || p.latestPlanContent !== n.latestPlanContent ||
      p.ptyPrompt !== n.ptyPrompt || p.cliMode !== n.cliMode ||
      p.lastPendingAskId !== n.lastPendingAskId || p.lastPendingPlanId !== n.lastPendingPlanId ||
      p.activePlanPrompt !== n.activePlanPrompt || p.activeDangerousPrompt !== n.activeDangerousPrompt ||
      p.requestIndex !== n.requestIndex || p.label !== n.label || p.isTeammate !== n.isTeammate ||
      p.userProfile !== n.userProfile || p.modelInfo !== n.modelInfo ||
      p.resultText !== n.resultText || p.toolName !== n.toolName ||
      p.onViewRequest !== n.onViewRequest || p.onOpenFile !== n.onOpenFile ||
      p.onPlanApprovalClick !== n.onPlanApprovalClick || p.onPlanFeedbackSubmit !== n.onPlanFeedbackSubmit ||
      p.onDangerousApprovalClick !== n.onDangerousApprovalClick || p.onAskQuestionSubmit !== n.onAskQuestionSubmit;
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
    if (!ts) return null;
    try {
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch { return null; }
  }

  renderViewRequestBtn() {
    const { requestIndex, onViewRequest } = this.props;
    if (requestIndex == null || !onViewRequest) return null;
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

  renderUserAvatar(bgColor) {
    const { userProfile } = this.props;
    if (userProfile?.avatar) {
      return <img src={userProfile.avatar} className={styles.avatarImg} alt={userProfile.name || 'User'}
        onError={(e) => { e.target.onerror = null; e.target.src = defaultAvatarUrl; }} />;
    }
    return <img src={defaultAvatarUrl} className={styles.avatarImg} alt={userProfile?.name || 'User'} />;
  }

  getUserName() {
    const { userProfile } = this.props;
    return userProfile?.name || 'User';
  }

  renderSegments(segments) {
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
      return (
        <div
          key={i}
          className="chat-md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
        />
      );
    });
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

    const inp = (tu.input && typeof tu.input === 'object') ? tu.input : {};
    const box = (label, children) => (
      <div key={tu.id} className={styles.toolBox}>
        <Text strong className={styles.toolLabel}>{label}</Text>
        {children}
      </div>
    );

    const codePre = (text) => (
      <pre className={styles.codePre}>{text}</pre>
    );

    const onOpenFile = this.props.onOpenFile;
    const pathTag = (p) => (
      onOpenFile
        ? <span className={styles.pathTagClickable} onClick={(e) => { e.stopPropagation(); onOpenFile(p); }}>{p}</span>
        : <span className={styles.pathTag}>{p}</span>
    );

    // Bash: show command and description
    if (tu.name === 'Bash') {
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
                children: codePre(cmd),
              }]}
              className={styles.collapseMargin}
            />
          </div>
        );
      }

      return box(
        <>Bash{desc ? <span className={styles.descSpan}> — {desc}</span> : ''}</>,
        codePre(cmd)
      );
    }

    // Read: show file path + range
    if (tu.name === 'Read') {
      const fp = inp.file_path || '';
      const parts = [];
      if (inp.offset) parts.push(`offset: ${inp.offset}`);
      if (inp.limit) parts.push(`limit: ${inp.limit}`);
      const range = parts.length ? ` (${parts.join(', ')})` : '';
      return box(
        <>Read: {pathTag(fp)}<span className={styles.secondarySpan}>{range}</span></>,
        null
      );
    }

    // Write: show file path + content preview
    if (tu.name === 'Write') {
      const fp = inp.file_path || '';
      const content = inp.content || '';
      const lines = content.split('\n');
      return box(
        <>Write: {pathTag(fp)} <span className={styles.secondarySpan}>({lines.length} lines)</span></>,
        codePre(content)
      );
    }

    // Glob: show pattern + path
    if (tu.name === 'Glob') {
      const pattern = inp.pattern || '';
      const path = inp.path || '';
      return box(
        <>Glob: <span className={styles.patternSpan}>{pattern}</span>{path ? <span className={styles.secondarySpan}> in {path}</span> : ''}</>,
        null
      );
    }

    // Grep: show pattern + path + options
    if (tu.name === 'Grep') {
      const pattern = inp.pattern || '';
      const path = inp.path || '';
      const opts = [];
      if (inp.glob) opts.push(`glob: ${inp.glob}`);
      if (inp.output_mode) opts.push(`mode: ${inp.output_mode}`);
      if (inp.head_limit) opts.push(`limit: ${inp.head_limit}`);
      const optsStr = opts.length ? ` (${opts.join(', ')})` : '';
      return box(
        <>Grep: <span className={styles.patternSpan}>/{pattern}/</span>{path ? <span className={styles.secondarySpan}> in {path}</span> : ''}<span className={styles.secondarySpan}>{optsStr}</span></>,
        null
      );
    }

    // Task: show subagent type + description
    if (tu.name === 'Task') {
      const st = inp.subagent_type || '';
      const desc = inp.description || '';
      return box(
        <>Task({st}{desc ? ': ' + desc : ''})</>,
        null
      );
    }

    // AskUserQuestion: 问卷卡片
    if (tu.name === 'AskUserQuestion') {
      const questions = Array.isArray(inp.questions) ? inp.questions : [];
      const { askAnswerMap } = this.props;
      const selectedAnswers = askAnswerMap?.[tu.id] || {};
      const isRejected = selectedAnswers.__rejected__ === true;
      const hasAnswers = !isRejected && Object.keys(selectedAnswers).length > 0;
      const isPending = !hasAnswers && !isRejected;
      const isInteractive = isPending && this.props.onAskQuestionSubmit && tu.id === this.props.lastPendingAskId;

      if (isInteractive) {
        return this.renderAskQuestionInteractive(tu.id, questions);
      }

      const checkSvg = (
        <svg className={styles.askCheckSvg} width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
      return (
        <div key={tu.id} className={styles.askQuestionBox}>
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
                        {selected ? checkSvg : '○'} {opt.label}
                        {opt.description && <span className={styles.optionDesc}>— {opt.description}</span>}
                      </div>
                    );
                  })}
                  {isOtherAnswer && (
                    <div className={`${styles.askOptionItem} ${styles.askOptionSelected}`}>
                      {checkSvg} {answer}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // EnterPlanMode: 进入计划模式
    if (tu.name === 'EnterPlanMode') {
      return (
        <div key={tu.id} className={styles.planModeBox}>
          <span className={styles.planModeLabel}>{t('ui.enterPlanMode')}</span>
        </div>
      );
    }

    // ExitPlanMode: 计划就绪
    if (tu.name === 'ExitPlanMode') {
      const prompts = inp.allowedPrompts || [];
      const { planApprovalMap } = this.props;
      const approval = (planApprovalMap && planApprovalMap[tu.id]) || { status: 'pending' };
      const isPending = approval.status === 'pending';
      const isInteractive = isPending && this.props.cliMode && tu.id === this.props.lastPendingPlanId;

      // pending 状态下提取 plan 内容：
      // 1. 优先从跨消息追踪的 latestPlanContent（Write 到 .claude/plans/ 的内容，可能在前 1-2 个请求中）
      // 2. 回退到同一 response 中 Write 工具的内容
      // 3. 最后回退到 ExitPlanMode 之前的 text blocks
      let planTextContent = null;
      if (isPending) {
        planTextContent = this.props.latestPlanContent || null;
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
      if (approval.status === 'approved' && approval.planContent) {
        return (
          <div key={tu.id} className={styles.bubblePlan}>
            <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(approval.planContent) }} />
          </div>
        );
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
      return (
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
              <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(planTextContent) }} />
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
    }

    // Default: structured key-value display
    let toolLabel = tu.name;
    const keys = Object.keys(inp);
    if (keys.length === 0) {
      return box(toolLabel, null);
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
    return box(toolLabel, <div className={styles.kvContainer}>{items}</div>);
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
    return (
      <AskQuestionForm
        key={toolId}
        questions={questions}
        onSubmit={(answers) => {
          if (this.props.onAskQuestionSubmit) {
            this.props.onAskQuestionSubmit(answers, toolId, questions);
          }
        }}
      />
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

  renderUserMessage() {
    const { text, timestamp } = this.props;
    const timeStr = this.formatTime(timestamp);
    const userName = this.getUserName();

    // 检测 /compact 消息
    const isCompact = text && text.includes('This session is being continued from a previous conversation that ran out of context');

    if (isCompact) {
      return (
        <div className={styles.messageRowEnd}>
          <div className={styles.contentColLimited}>
            <div className={styles.labelRow}>
              {timeStr && <Text className={styles.timeTextNoMargin}>{timeStr}</Text>}
              {this.renderViewRequestBtn()}
              <Text type="secondary" className={styles.labelTextRight}>{userName} — /compact</Text>
            </div>
            {this.renderHighlightBubble(styles.bubbleUser, (
              <Collapse
                ghost
                size="small"
                items={[{
                  key: '1',
                  label: <Text className={styles.compactLabel}>Compact Summary</Text>,
                  children: <pre className={styles.compactPre}>{text}</pre>,
                }]}
                className={styles.collapseNoMargin}
              />
            ))}
          </div>
          {this.renderUserAvatar('#1e40af')}
        </div>
      );
    }

    return (
      <div className={styles.messageRowEnd}>
        <div className={styles.contentColLimited}>
          <div className={styles.labelRow}>
            {timeStr && <Text className={styles.timeTextNoMargin}>{timeStr}</Text>}
            {this.renderViewRequestBtn()}
            <Text type="secondary" className={styles.labelTextRight}>{userName}</Text>
          </div>
          {this.renderHighlightBubble(styles.bubbleUser, this.renderUserTextWithImages(text))}
        </div>
        {this.renderUserAvatar('#1e40af')}
      </div>
    );
  }

  renderUserTextWithImages(text) {
    if (!text) return text || '';
    // 匹配图片路径格式：
    // 1. [Image: source: /path/to/file.ext] 或 [Image #N]
    // 2. "引号包裹的 /tmp/cc-viewer-uploads/ 图片路径"（仅限上传目录，避免误伤正常文本）
    const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
    const combinedPattern = /\[Image(?:\s*#\d+)?(?::?\s*source)?:\s*([^\]]+)\]|"(\/tmp\/cc-viewer-uploads\/[^"]+?)"/g;
    const parts = [];
    let lastIndex = 0;
    let match;
    while ((match = combinedPattern.exec(text)) !== null) {
      // match[1] = [Image...] 中的路径, match[2] = "引号路径"
      const filePath = (match[1] || match[2] || '').trim();
      if (!filePath || !IMAGE_EXTS.test(filePath)) continue;
      if (match.index > lastIndex) {
        parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
      }
      const originalText = match[0];
      parts.push(
        <ChatImage
          key={`img-${match.index}`}
          src={apiUrl(`/api/file-raw?path=${encodeURIComponent(filePath)}`)}
          alt={filePath.split('/').pop()}
          fallbackText={originalText}
        />
      );
      lastIndex = match.index + match[0].length;
    }
    if (parts.length === 0) return text;
    if (lastIndex < text.length) {
      parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
    }
    return <>{parts}</>;
  }

  renderToolResult(tr) {
    if (!tr) return null;
    return (
      <ToolResultView toolName={tr.toolName} toolInput={tr.toolInput} resultText={tr.resultText} defaultCollapsed={this.props.collapseToolResults} />
    );
  }

  renderAssistantContent(content, toolResultMap = {}) {
    const thinkingBlocks = content.filter(b => b.type === 'thinking');
    const textBlocks = content.filter(b => b.type === 'text');
    const toolUseBlocks = content.filter(b => b.type === 'tool_use');

    let innerContent = [];

    thinkingBlocks.forEach((tb, i) => {
      const thinkingText = tb.thinking || '';
      const isEmpty = !thinkingText.trim();
      innerContent.push(
        <Collapse
          key={`think-${i}-${this.props.expandThinking ? 'e' : 'c'}`}
          ghost
          size="small"
          defaultActiveKey={this.props.expandThinking ? ['1'] : []}
          items={[{
            key: '1',
            label: <Text type="secondary" className={styles.thinkingLabel}>{t('ui.thinking')}</Text>,
            children: isEmpty ? (
              <div className={styles.thinkingEmptyHint}>
                <Text type="secondary" className={styles.thinkingEmptyText}>{t('ui.thinkingEmpty')}</Text>
                {!this.props.showThinkingSummaries && (
                  <Tooltip title={t('ui.enableThinkingSummariesTip')}>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      className={styles.enableThinkingBtn}
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const res = await fetch(apiUrl('/api/claude-settings'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ showThinkingSummaries: true }),
                          });
                          if (res.ok) {
                            message.success(t('ui.enableThinkingSummariesTip'));
                          }
                        } catch { message.error('Failed to save setting'); }
                      }}
                    >
                      {t('ui.enableThinkingSummaries')}
                    </Button>
                  </Tooltip>
                )}
              </div>
            ) : (
              <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(thinkingText) }} />
            ),
          }]}
          className={styles.collapseMargin}
        />
      );
    });

    textBlocks.forEach((tb, i) => {
      if (tb.text) {
        const { segments } = renderAssistantText(tb.text);
        innerContent.push(
          <div key={`text-${i}`} className="chat-boxer">{this.renderSegments(segments)}</div>
        );
      }
    });

    const simplify = !this.props.showFullToolContent;
    let simplifiedLabelAdded = false;
    toolUseBlocks.forEach((tu, tuIdx) => {
      const isFullDisplayTool = tu.name === 'Edit' || tu.name === 'Write' || tu.name === 'EnterPlanMode' || tu.name === 'ExitPlanMode' || tu.name === 'AskUserQuestion' || tu.name === 'Agent' || tu.name === 'TaskCreate';
      if (simplify && !isFullDisplayTool) {
        // 简化模式：首个标签前加 "使用工具: " 标签
        if (!simplifiedLabelAdded) {
          simplifiedLabelAdded = true;
          innerContent.push(
            <span key={`stag-label-${tuIdx}`} className={styles.simplifiedToolLabel}>{t('ui.toolsUsed')}</span>
          );
        }
        // 简化模式：非 Edit/Write 工具只显示标签，hover/click 显示完整内容
        // 移动端 zoom:0.6 导致 Popover 坐标偏移，需 getPopupContainer 渲染在缩放容器内
        innerContent.push(
          <Popover
            key={`stag-${tu.id}`}
            placement="top"
            overlayClassName="simplifiedToolPopover"
            overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)', borderRadius: 8, padding: 0 }}
            content={<div className={styles.simplifiedToolPopoverContent}>{this.renderToolCall(tu)}</div>}
            mouseEnterDelay={0.3}
            {...(isMobile ? { trigger: 'click', getPopupContainer: (node) => node.parentElement } : {})}
          >
            <span className={styles.simplifiedToolTag}>{tu.name}</span>
          </Popover>
        );
      } else {
        simplifiedLabelAdded = false; // 遇到完整展示工具后重置，下一组简化标签前重新显示 label
        innerContent.push(this.renderToolCall(tu));
      }

      const tr = toolResultMap[tu.id];

      // 危险操作审批卡片：第一个无 tool_result 的 tool_use + 有活跃的 dangerous prompt
      const isFirstPendingTool = !tr && !toolUseBlocks.slice(0, tuIdx).some(t2 => !toolResultMap[t2.id]);
      if (isFirstPendingTool && this.props.activeDangerousPrompt && this.props.cliMode) {
        const dp = this.props.activeDangerousPrompt;
        innerContent.push(this.renderDangerApproval(tu.id, dp));
      }

      // 权限拒绝的 tool_result 加红色标记
      if (tr) {
        // 已批准的 ExitPlanMode 计划内容已在 renderToolCall 中渲染，隐藏重复的 tool_result
        const planApprovalMap = this.props.planApprovalMap || {};
        const approval = planApprovalMap[tu.id];
        if (tu.name === 'ExitPlanMode' && approval && approval.status === 'approved' && approval.planContent) {
          // skip tool result — plan content already shown
        } else if (simplify) {
          // 简化模式：仅显示权限拒绝，隐藏其他 tool_result
          if (tr.isPermissionDenied) {
            innerContent.push(
              <React.Fragment key={`tr-denied-${tu.id}`}>
                {tr.isUltraplan ? (
                  <div className={styles.ultraplanBadge}>◇ Ultraplan</div>
                ) : (
                  <div className={`${styles.dangerApprovalBox} ${styles.dangerApprovalBoxDenied}`}>
                    <span className={styles.dangerDeniedBadge}>✗ {t('ui.dangerDenied')}</span>
                    {tr.resultText && (
                      <div className={styles.dangerDeniedDetail}>{tr.resultText}</div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          }
        } else {
          if (tr.isPermissionDenied) {
            innerContent.push(
              <React.Fragment key={`tr-denied-${tu.id}`}>
                {tr.isUltraplan ? (
                  <div className={styles.ultraplanBadge}>◇ Ultraplan</div>
                ) : (
                  <div className={`${styles.dangerApprovalBox} ${styles.dangerApprovalBoxDenied}`}>
                    <span className={styles.dangerDeniedBadge}>✗ {t('ui.dangerDenied')}</span>
                    {tr.resultText && (
                      <div className={styles.dangerDeniedDetail}>{tr.resultText}</div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          } else {
            innerContent.push(
              <React.Fragment key={`tr-${tu.id}`}>{this.renderToolResult(tr)}</React.Fragment>
            );
          }
        }
      }
    });

    return innerContent;
  }

  renderAssistantMessage() {
    const { content, toolResultMap = {}, modelInfo } = this.props;
    const innerContent = this.renderAssistantContent(content, toolResultMap);

    if (innerContent.length === 0) return null;

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
    const { content, toolResultMap = {}, label } = this.props;
    const innerContent = this.renderAssistantContent(content, toolResultMap);

    if (innerContent.length === 0) return null;

    return (
      <div className={styles.messageRowEnd}>
        <div className={styles.contentColLimited}>
          <div className={styles.labelRowEnd}>
            {this.formatTime(this.props.timestamp) && <Text className={styles.timeText}>{this.formatTime(this.props.timestamp)}</Text>}
            {this.renderViewRequestBtn()}
            <Text type="secondary" className={styles.labelTextRight}>{label || 'SubAgent'}</Text>
          </div>
          {this.renderHighlightBubble(styles.bubbleAssistant, innerContent)}
        </div>
        {(() => { const ta = this.props.isTeammate ? getTeammateAvatar(label) : null; return (
          <div className={styles.avatar} style={{ background: ta ? ta.color : 'var(--bg-surface)' }}
            dangerouslySetInnerHTML={{ __html: ta ? ta.svg : getSvgAvatar(this._getSubAvatarType()) }}
          />
        ); })()}
      </div>
    );
  }

  renderSubAgentMessage() {
    const { label, resultText, toolName, toolInput } = this.props;
    const tmAvatar = this.props.isTeammate ? getTeammateAvatar(label) : null;
    return (
      <div className={styles.messageRow}>
        <div className={styles.avatar} style={{ background: tmAvatar ? tmAvatar.color : 'var(--bg-surface)' }}
          dangerouslySetInnerHTML={{ __html: tmAvatar ? tmAvatar.svg : getSvgAvatar(this._getSubAvatarType()) }}
        />
        <div className={styles.contentCol}>
          {this.renderLabel(label)}
          <div className={styles.bubbleSubAgent}>
            <ToolResultView toolName={toolName} toolInput={toolInput} resultText={resultText} />
          </div>
        </div>
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
            <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(planContent) }} />
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
              children: <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />,
            }]}
            className={styles.collapseNoMargin}
          />
        </div>
      </div>
    );
  }

  render() {
    const { role } = this.props;
    if (role === 'user') return this.renderUserMessage();
    if (role === 'skill-loaded') return this.renderSkillLoadedMessage();
    if (role === 'plan-prompt') return this.renderPlanPromptMessage();
    if (role === 'assistant') return this.renderAssistantMessage();
    if (role === 'sub-agent-chat') return this.renderSubAgentChatMessage();
    if (role === 'sub-agent') return this.renderSubAgentMessage();
    return null;
  }
}

export default ChatMessage;
