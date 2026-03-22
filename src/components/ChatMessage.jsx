import React from 'react';
import { Collapse, Typography, Radio, Checkbox, Input } from 'antd';
import { renderMarkdown } from '../utils/markdown';
import { escapeHtml, truncateText, getSvgAvatar } from '../utils/helpers';
import { renderAssistantText } from '../utils/systemTags';
import AskQuestionForm from './AskQuestionForm';
import { t } from '../i18n';
import { isPlanApprovalPrompt } from './ChatView';
import DiffView from './DiffView';
import ToolResultView from './ToolResultView';
import TranslateTag from './TranslateTag';
import defaultAvatarUrl from '../img/default-avatar.svg';
import defaultModelAvatarUrl from '../img/default-model-avatar.svg';
import styles from './ChatMessage.module.css';

const { Text } = Typography;

function nameToColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 35%)`;
}

class ChatMessage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      // { [thinkingIndex]: translatedHtml | null }
      thinkingTranslated: {},
      planFeedbackInput: false,
      planFeedbackText: '',
      planFeedbackOptNumber: null,
    };
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
  }

  handleThinkingTranslated = (index, translatedText) => {
    this.setState(prev => ({
      thinkingTranslated: {
        ...prev.thinkingTranslated,
        [index]: translatedText ? renderMarkdown(translatedText) : null,
      },
    }));
  };

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
        <div className={styles.avatar} style={{ background: modelInfo.color || '#6b21a8' }}
          dangerouslySetInnerHTML={{ __html: modelInfo.svg }}
        />
      );
    }
    return <img src={defaultModelAvatarUrl} className={styles.avatarImg} alt={modelInfo?.name || 'Agent'} />;
  }

  renderUserAvatar(bgColor) {
    const { userProfile } = this.props;
    if (userProfile?.avatar) {
      return <img src={userProfile.avatar} className={styles.avatarImg} alt={userProfile.name || 'User'} />;
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

    const codePre = (text, color) => (
      <pre className={styles.codePre} style={{ color: color || '#e5e7eb' }}>{text}</pre>
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
                children: codePre(cmd, '#c9d1d9'),
              }]}
              className={styles.collapseMargin}
            />
          </div>
        );
      }

      return box(
        <>Bash{desc ? <span className={styles.descSpan}> — {desc}</span> : ''}</>,
        codePre(cmd, '#c9d1d9')
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
      const preview = lines.length > 20
        ? lines.slice(0, 20).join('\n') + `\n... (${lines.length} lines total)`
        : content;
      return box(
        <>Write: {pathTag(fp)} <span className={styles.secondarySpan}>({lines.length} lines)</span></>,
        codePre(preview, '#c9d1d9')
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
      const hasAnswers = Object.keys(selectedAnswers).length > 0;
      const isPending = !hasAnswers;
      const isInteractive = isPending && this.props.onAskQuestionSubmit && tu.id === this.props.lastPendingAskId;

      if (isInteractive) {
        return this.renderAskQuestionInteractive(tu.id, questions);
      }

      const checkSvg = (
        <svg className={styles.askCheckSvg} width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5L6.5 12L13 4" stroke="#2ea043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
        { number: 1, text: 'Approve plan', selected: true },
        { number: 2, text: 'Approve plan with edits', selected: false },
        { number: 3, text: 'Deny plan', selected: false },
      ];
      const planOptions = detectedPrompt ? detectedPrompt.options : defaultPlanOptions;
      const statusClass = approval.status === 'approved' ? styles.planStatusApproved
        : approval.status === 'rejected' ? styles.planStatusRejected
        : styles.planStatusPending;
      const statusIcon = approval.status === 'approved' ? '✓'
        : approval.status === 'rejected' ? '✗' : '●';
      const statusKey = approval.status === 'approved' ? 'ui.planApproved'
        : approval.status === 'rejected' ? 'ui.planRejected' : 'ui.planPending';
      return (
        <div key={tu.id} className={`${styles.planModeBox} ${statusClass}`}>
          <div className={styles.planModeHeader}>
            <span className={styles.planModeLabel}>{t('ui.exitPlanMode')}</span>
            {!isInteractive && (
              <span className={`${styles.planStatusBadge} ${statusClass}`}>{statusIcon} {t(statusKey)}</span>
            )}
          </div>
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
              {planOptions.map(opt => {
                const txt = opt.text.toLowerCase();
                let btnCls = styles.planOptionBtn;
                if (/yes|approve|accept|proceed/i.test(txt)) btnCls = styles.planApproveBtn;
                else if (/no|reject|deny|feedback/i.test(txt)) btnCls = styles.planRejectBtn;
                const isFeedbackOpt = /type|tell|change|feedback|edit/i.test(opt.text);
                return (
                  <button key={opt.number} className={btnCls} onClick={() => {
                    if (isFeedbackOpt) {
                      this.setState({ planFeedbackInput: true, planFeedbackOptNumber: opt.number, planFeedbackText: '' });
                    } else {
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
      const display = vs.length > 200 ? vs.substring(0, 200) + '...' : vs;
      return (
        <div key={k} className={styles.kvItem}>
          <span className={styles.kvKey}>{k}: </span>
          <span className={styles.kvValue}>{display}</span>
        </div>
      );
    });
    return box(toolLabel, <div className={styles.kvContainer}>{items}</div>);
  }

  renderAskQuestionInteractive(toolId, questions) {
    return (
      <AskQuestionForm
        key={toolId}
        questions={questions}
        onSubmit={this.props.onAskQuestionSubmit}
      />
    );
  }

  renderHighlightBubble(bubbleClass, children) {
    const { highlight } = this.props;
    const cls = `${bubbleClass}${highlight === 'active' ? ' ' + styles.bubbleHighlight : ''}${highlight === 'fading' ? ' ' + styles.bubbleHighlightFading : ''}`;
    const isUser = bubbleClass === styles.bubbleUser;
    return (
      <div className={cls} style={{ position: 'relative' }}>
        {(highlight === 'active' || highlight === 'fading') && (
          <svg className={`${styles.borderSvg}${highlight === 'fading' ? ' ' + styles.borderSvgFading : ''}`} preserveAspectRatio="none">
            <rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="8" ry="8"
              fill="none" stroke={isUser ? '#ffffff' : '#1668dc'} strokeWidth="1" strokeDasharray="6 4"
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
          {this.renderHighlightBubble(styles.bubbleUser, escapeHtml(text))}
        </div>
        {this.renderUserAvatar('#1e40af')}
      </div>
    );
  }

  renderToolResult(tr) {
    if (!tr) return null;
    return (
      <div className={styles.toolResult}>
        <Text type="secondary" className={styles.toolResultLabel}>{tr.label}</Text>
        <ToolResultView toolName={tr.toolName} toolInput={tr.toolInput} resultText={tr.resultText} defaultCollapsed={this.props.collapseToolResults} />
      </div>
    );
  }

  renderAssistantContent(content, toolResultMap = {}) {
    const thinkingBlocks = content.filter(b => b.type === 'thinking');
    const textBlocks = content.filter(b => b.type === 'text');
    const toolUseBlocks = content.filter(b => b.type === 'tool_use');

    let innerContent = [];

    thinkingBlocks.forEach((tb, i) => {
      const translatedHtml = this.state.thinkingTranslated[i];
      const displayHtml = translatedHtml || renderMarkdown(tb.thinking || '');
      innerContent.push(
        <Collapse
          key={`think-${i}-${this.props.expandThinking ? 'e' : 'c'}`}
          ghost
          size="small"
          defaultActiveKey={this.props.expandThinking ? ['1'] : []}
          items={[{
            key: '1',
            label: (
              <span>
                <Text type="secondary" className={styles.thinkingLabel}>{t('ui.thinking')}</Text>
                <TranslateTag text={tb.thinking || ''} onTranslated={(txt) => this.handleThinkingTranslated(i, txt)} />
              </span>
            ),
            children: <div className="chat-md" dangerouslySetInnerHTML={{ __html: displayHtml }} />,
          }]}
          className={styles.collapseMargin}
        />
      );
    });

    textBlocks.forEach((tb, i) => {
      if (tb.text) {
        const { segments } = renderAssistantText(tb.text);
        innerContent.push(
          <div key={`text-${i}`}>{this.renderSegments(segments)}</div>
        );
      }
    });

    toolUseBlocks.forEach(tu => {
      innerContent.push(this.renderToolCall(tu));
      const tr = toolResultMap[tu.id];
      if (tr) {
        // 已批准的 ExitPlanMode 计划内容已在 renderToolCall 中渲染，隐藏重复的 tool_result
        const planApprovalMap = this.props.planApprovalMap || {};
        const approval = planApprovalMap[tu.id];
        if (tu.name === 'ExitPlanMode' && approval && approval.status === 'approved' && approval.planContent) {
          // skip tool result — plan content already shown
        } else {
          innerContent.push(
            <React.Fragment key={`tr-${tu.id}`}>{this.renderToolResult(tr)}</React.Fragment>
          );
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
        <div className={styles.avatar} style={{ background: this.props.isTeammate ? nameToColor(label || '') : 'rgba(255, 255, 255, 0.1)' }}
          dangerouslySetInnerHTML={{ __html: getSvgAvatar(this._getSubAvatarType()) }}
        />
      </div>
    );
  }

  renderSubAgentMessage() {
    const { label, resultText, toolName, toolInput } = this.props;
    return (
      <div className={styles.messageRow}>
        <div className={styles.avatar} style={{ background: this.props.isTeammate ? nameToColor(label || '') : 'rgba(255, 255, 255, 0.1)' }}
          dangerouslySetInnerHTML={{ __html: getSvgAvatar(this._getSubAvatarType()) }}
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
        <div style={{ width: 32, flexShrink: 0 }} />
        <div className={styles.contentCol}>
          <Collapse
            ghost
            size="small"
            items={[{
              key: '1',
              label: (
                <span className={styles.skillLabel}>
                  📦 {t('ui.skillLoaded')}: {skillName}
                  {timeStr && <Text className={styles.timeTextNoMargin} style={{ marginLeft: 8 }}>{timeStr}</Text>}
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
