import React from 'react';
import { Collapse, Typography } from 'antd';
import { renderMarkdown } from '../utils/markdown';
import { escapeHtml, truncateText, getSvgAvatar } from '../utils/helpers';
import { renderAssistantText } from '../utils/systemTags';
import { t } from '../i18n';
import DiffView from './DiffView';
import ToolResultView from './ToolResultView';
import TranslateTag from './TranslateTag';
import styles from './ChatMessage.module.css';

const { Text } = Typography;

class ChatMessage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      // { [thinkingIndex]: translatedHtml | null }
      thinkingTranslated: {},
    };
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

  renderUserAvatar(bgColor) {
    const { userProfile } = this.props;
    if (userProfile?.avatar) {
      return <img src={userProfile.avatar} className={styles.avatarImg} alt={userProfile.name || 'User'} />;
    }
    return (
      <div className={styles.avatar} style={{ background: bgColor }}
        dangerouslySetInnerHTML={{ __html: getSvgAvatar('user') }}
      />
    );
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
      return (
        <DiffView
          key={tu.id}
          file_path={tu.input.file_path || ''}
          old_string={tu.input.old_string}
          new_string={tu.input.new_string}
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
      <pre className={styles.codePre} style={{ color: color || 'var(--text-code)' }}>{text}</pre>
    );

    const pathTag = (p) => (
      <span className={styles.pathTag}>{p}</span>
    );

    // Bash: show command and description
    if (tu.name === 'Bash') {
      const cmd = inp.command || '';
      const desc = inp.description || '';
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
        innerContent.push(
          <React.Fragment key={`tr-${tu.id}`}>{this.renderToolResult(tr)}</React.Fragment>
        );
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
        <div className={styles.avatar} style={{ background: modelInfo?.color || '#6b21a8' }}
          dangerouslySetInnerHTML={{ __html: modelInfo?.svg || getSvgAvatar('agent') }}
        />
        <div className={styles.contentCol}>
          {this.renderLabel(modelInfo?.name || 'MainAgent')}
          {this.renderHighlightBubble(styles.bubbleAssistant, innerContent)}
        </div>
      </div>
    );
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
        <div className={styles.avatar} style={{ background: '#4a1d96' }}
          dangerouslySetInnerHTML={{ __html: getSvgAvatar('sub') }}
        />
      </div>
    );
  }

  renderSubAgentMessage() {
    const { label, resultText, toolName, toolInput } = this.props;
    return (
      <div className={styles.messageRow}>
        <div className={styles.avatar} style={{ background: '#4a1d96' }}
          dangerouslySetInnerHTML={{ __html: getSvgAvatar('sub') }}
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

  renderUserSelectionMessage() {
    const { questions, answers } = this.props;
    const userName = this.getUserName();
    return (
      <div className={styles.messageRowEnd}>
        <div className={styles.contentColLimited}>
          {this.renderLabel(userName, ' — 选择')}
          <div className={styles.bubbleSelection}>
            {questions && questions.map((q, qi) => {
              const answer = answers?.[q.question] || '未选择';
              return (
                <div key={qi} className={qi < questions.length - 1 ? styles.questionSpacing : undefined}>
                  <div className={styles.questionText}>{q.question}</div>
                  <div className={styles.optionList}>
                    {q.options && q.options.map((opt, oi) => {
                      const isSelected = answer === opt.label;
                      return (
                        <div key={oi} className={styles.option} style={{
                          color: isSelected ? 'var(--text-1)' : 'var(--text-5)',
                          fontWeight: isSelected ? 600 : 'normal',
                        }}>
                          {isSelected ? '● ' : '○ '}{opt.label}
                          {opt.description && <span className={styles.optionDesc}>— {opt.description}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {this.renderUserAvatar('#2ea043')}
      </div>
    );
  }

  renderPlanPromptMessage() {
    const { text, timestamp, modelInfo } = this.props;
    const timeStr = this.formatTime(timestamp);
    const planContent = (text || '').replace(/^Implement the following plan:\s*/i, '');

    return (
      <div className={styles.messageRow}>
        <div className={styles.avatar} style={{ background: modelInfo?.color || '#6b21a8' }}
          dangerouslySetInnerHTML={{ __html: modelInfo?.svg || getSvgAvatar('agent') }}
        />
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
    if (role === 'user-selection') return this.renderUserSelectionMessage();
    if (role === 'assistant') return this.renderAssistantMessage();
    if (role === 'sub-agent-chat') return this.renderSubAgentChatMessage();
    if (role === 'sub-agent') return this.renderSubAgentMessage();
    return null;
  }
}

export default ChatMessage;
