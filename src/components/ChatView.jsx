import React from 'react';
import { Empty, Typography, Divider, Spin } from 'antd';
import ChatMessage from './ChatMessage';
import { extractToolResultText, getModelInfo } from '../utils/helpers';
import { isSystemText, classifyUserContent, isMainAgent } from '../utils/contentFilter';
import { classifyRequest, formatRequestTag } from '../utils/requestType';
import { t } from '../i18n';
import styles from './ChatView.module.css';

const { Text } = Typography;

const QUEUE_THRESHOLD = 20;

function randomInterval() {
  return 100 + Math.random() * 50;
}

function buildToolResultMap(messages) {
  const toolUseMap = {};
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolUseMap[block.id] = block;
        }
      }
    }
  }

  const toolResultMap = {};
  for (const msg of messages) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const matchedTool = toolUseMap[block.tool_use_id];
          let label = t('ui.toolReturn');
          let toolName = null;
          let toolInput = null;
          if (matchedTool) {
            toolName = matchedTool.name;
            toolInput = matchedTool.input;
            if (matchedTool.name === 'Task' && matchedTool.input) {
              const st = matchedTool.input.subagent_type || '';
              const desc = matchedTool.input.description || '';
              label = `SubAgent: ${st}${desc ? ' — ' + desc : ''}`;
            } else {
              label = t('ui.toolReturnNamed', { name: matchedTool.name });
            }
          }
          toolResultMap[block.tool_use_id] = {
            label,
            toolName,
            toolInput,
            resultText: extractToolResultText(block),
          };
        }
      }
    }
  }
  return { toolUseMap, toolResultMap };
}

class ChatView extends React.Component {
  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.state = {
      visibleCount: 0,
      loading: false,
      allItems: [],
      highlightTs: null,
      highlightFading: false,
    };
    this._queueTimer = null;
    this._prevItemsLen = 0;
    this._scrollTargetIdx = null;
    this._scrollTargetRef = React.createRef();
    this._scrollFadeTimer = null;
  }

  componentDidMount() {
    this.startRender();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.mainAgentSessions !== this.props.mainAgentSessions) {
      this.startRender();
    } else if (prevProps.collapseToolResults !== this.props.collapseToolResults || prevProps.expandThinking !== this.props.expandThinking) {
      // 设置变化时重建消息列表，使已渲染的 ToolResultView 获得新的 defaultCollapsed
      const allItems = this.buildAllItems();
      this.setState({ allItems, visibleCount: allItems.length });
    }
  }

  componentWillUnmount() {
    if (this._queueTimer) clearTimeout(this._queueTimer);
    if (this._fadeClearTimer) clearTimeout(this._fadeClearTimer);
    this._unbindScrollFade();
  }

  startRender() {
    if (this._queueTimer) clearTimeout(this._queueTimer);

    const allItems = this.buildAllItems();
    const prevLen = this._prevItemsLen;
    this._prevItemsLen = allItems.length;

    const newCount = allItems.length - prevLen;

    if (newCount <= 0 || (prevLen > 0 && newCount <= 3)) {
      this.setState({ allItems, visibleCount: allItems.length, loading: false }, () => this.scrollToBottom());
      return;
    }

    if (allItems.length > QUEUE_THRESHOLD) {
      this.setState({ allItems, visibleCount: 0, loading: true });
      this._queueTimer = setTimeout(() => {
        this.setState({ visibleCount: allItems.length, loading: false }, () => this.scrollToBottom());
      }, 300);
    } else {
      const startFrom = Math.max(0, prevLen);
      this.setState({ allItems, visibleCount: startFrom, loading: false });
      this.queueNext(startFrom, allItems.length);
    }
  }

  queueNext(current, total) {
    if (current >= total) return;
    this._queueTimer = setTimeout(() => {
      this.setState({ visibleCount: current + 1 }, () => {
        this.scrollToBottom();
        this.queueNext(current + 1, total);
      });
    }, randomInterval());
  }

  _isNearBottom() {
    const el = this.containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 5;
  }

  scrollToBottom() {
    if (this._scrollTargetRef.current) {
      const targetEl = this._scrollTargetRef.current;
      const container = this.containerRef.current;
      // If the target element is taller than the container, align to top; otherwise center
      if (container && targetEl.offsetHeight > container.clientHeight) {
        targetEl.scrollIntoView({ block: 'start', behavior: 'instant' });
      } else {
        targetEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
      const targetTs = this.props.scrollToTimestamp;
      this._scrollTargetRef = React.createRef();
      // Activate highlight glow
      if (targetTs) {
        this.setState({ highlightTs: targetTs, highlightFading: false });
        this._bindScrollFade();
      }
      if (this.props.onScrollTsDone) this.props.onScrollTsDone();
      return;
    }
    // Only auto-scroll to bottom if user is already near the bottom
    if (this._isNearBottom()) {
      const el = this.containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  _bindScrollFade() {
    this._unbindScrollFade();
    const container = this.containerRef.current;
    if (!container) return;
    this._scrollFadeIgnoreFirst = true;
    this._onScrollFade = () => {
      if (this._scrollFadeIgnoreFirst) {
        this._scrollFadeIgnoreFirst = false;
        return;
      }
      this.setState({ highlightFading: true });
      this._fadeClearTimer = setTimeout(() => {
        this.setState({ highlightTs: null, highlightFading: false });
      }, 2000);
      this._unbindScrollFade();
    };
    container.addEventListener('scroll', this._onScrollFade);
  }

  _unbindScrollFade() {
    if (this._onScrollFade && this.containerRef.current) {
      this.containerRef.current.removeEventListener('scroll', this._onScrollFade);
      this._onScrollFade = null;
    }
  }

  renderSessionMessages(messages, keyPrefix, modelInfo, tsToIndex) {
    const { userProfile, collapseToolResults, expandThinking, onViewRequest } = this.props;
    const { toolUseMap, toolResultMap } = buildToolResultMap(messages);

    const renderedMessages = [];

    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
      const content = msg.content;
      const ts = msg._timestamp || null;
      const reqIdx = ts ? tsToIndex[ts] : undefined;
      const viewReqProps = reqIdx != null && onViewRequest ? { requestIndex: reqIdx, onViewRequest } : {};

      if (msg.role === 'user') {
        if (Array.isArray(content)) {
          const suggestionText = content.find(b => b.type === 'text' && /^\[SUGGESTION MODE:/i.test((b.text || '').trim()));
          const toolResults = content.filter(b => b.type === 'tool_result');

          if (suggestionText && toolResults.length > 0) {
            let questions = null;
            let answers = {};
            for (const tr of toolResults) {
              const matchedTool = toolUseMap[tr.tool_use_id];
              if (matchedTool && matchedTool.name === 'AskUserQuestion' && matchedTool.input?.questions) {
                questions = matchedTool.input.questions;
                const resultText = extractToolResultText(tr);
                try {
                  const parsed = JSON.parse(resultText);
                  answers = parsed.answers || {};
                } catch {}
                break;
              }
            }

            if (questions) {
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-selection-${mi}`} role="user-selection" questions={questions} answers={answers} timestamp={ts} userProfile={userProfile} {...viewReqProps} />
              );
            }
          } else {
            const { commands, textBlocks, skillBlocks } = classifyUserContent(content);
            // 渲染 slash command 作为独立用户输入
            for (let ci = 0; ci < commands.length; ci++) {
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-cmd-${mi}-${ci}`} role="user" text={commands[ci]} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
              );
            }
            // 渲染 skill 加载块
            for (const sb of skillBlocks) {
              const nameMatch = sb.text.match(/^#\s+(.+)$/m);
              const skillName = nameMatch ? nameMatch[1] : 'Skill';
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-skill-${mi}`} role="skill-loaded" text={sb.text} skillName={skillName} timestamp={ts} {...viewReqProps} />
              );
            }
            // 渲染普通用户文本块
            for (let ti = 0; ti < textBlocks.length; ti++) {
              const isPlan = /^Implement the following plan:/i.test((textBlocks[ti].text || '').trim());
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-user-${mi}-${ti}`} role={isPlan ? 'plan-prompt' : 'user'} text={textBlocks[ti].text} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
              );
            }
          }
        } else if (typeof content === 'string' && !isSystemText(content)) {
          const isPlan = /^Implement the following plan:/i.test(content.trim());
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-user-${mi}`} role={isPlan ? 'plan-prompt' : 'user'} text={content} timestamp={ts} userProfile={userProfile} modelInfo={modelInfo} {...viewReqProps} />
          );
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(content)) {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={content} toolResultMap={toolResultMap} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} {...viewReqProps} />
          );
        } else if (typeof content === 'string') {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={[{ type: 'text', text: content }]} toolResultMap={toolResultMap} timestamp={ts} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} {...viewReqProps} />
          );
        }
      }
    }

    return renderedMessages;
  }

  buildAllItems() {
    const { mainAgentSessions, requests, collapseToolResults, expandThinking, onViewRequest } = this.props;
    if (!mainAgentSessions || mainAgentSessions.length === 0) return [];

    // 构建 timestamp → filteredRequests index 映射
    const tsToIndex = {};
    if (requests) {
      for (let i = 0; i < requests.length; i++) {
        if (isMainAgent(requests[i]) && requests[i].timestamp) {
          tsToIndex[requests[i].timestamp] = i;
        }
      }
    }

    // 从最新的 mainAgent 请求中提取模型名
    let modelName = null;
    if (requests) {
      for (let i = requests.length - 1; i >= 0; i--) {
        if (isMainAgent(requests[i]) && requests[i].body?.model) {
          modelName = requests[i].body.model;
          break;
        }
      }
    }
    const modelInfo = getModelInfo(modelName);

    const allItems = [];
    // 记录每个 timestamp 对应的最后一个 item index，用于滚动定位
    const tsItemMap = {};

    // 收集 SubAgent entries（按 timestamp 排序）
    const subAgentEntries = [];
    if (requests) {
      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        if (!req.timestamp) continue;
        const cls = classifyRequest(req, requests[i + 1]);
        if (cls.type === 'SubAgent') {
          const respContent = req.response?.body?.content;
          if (Array.isArray(respContent) && respContent.length > 0) {
            const subToolResultMap = buildToolResultMap(req.body?.messages || []).toolResultMap;
            subAgentEntries.push({
              timestamp: req.timestamp,
              content: respContent,
              toolResultMap: subToolResultMap,
              label: formatRequestTag(cls.type, cls.subType),
              requestIndex: i,
            });
          }
        }
      }
    }

    let subIdx = 0;

    mainAgentSessions.forEach((session, si) => {
      if (si > 0) {
        allItems.push(
          <Divider key={`session-div-${si}`} style={{ borderColor: '#333', margin: '16px 0' }}>
            <Text className={styles.sessionDividerText}>Session</Text>
          </Divider>
        );
      }

      const msgs = this.renderSessionMessages(session.messages, `s${si}`, modelInfo, tsToIndex);

      // 将 SubAgent entries 按时间戳插入到 session 消息之间
      for (const m of msgs) {
        const msgTs = m.props.timestamp;
        // 插入时间戳 <= 当前消息时间戳的 SubAgent entries
        while (subIdx < subAgentEntries.length && msgTs && subAgentEntries[subIdx].timestamp <= msgTs) {
          const sa = subAgentEntries[subIdx];
          if (sa.timestamp) tsItemMap[sa.timestamp] = allItems.length;
          allItems.push(
            <ChatMessage key={`sub-chat-${subIdx}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} />
          );
          subIdx++;
        }
        if (msgTs) tsItemMap[msgTs] = allItems.length;
        allItems.push(m);
      }
      // 插入剩余的 SubAgent entries（时间戳在最后一条消息之后）
      while (subIdx < subAgentEntries.length) {
        const sa = subAgentEntries[subIdx];
        // 只插入属于当前 session 时间范围内的（下一个 session 之前的）
        const nextSessionStart = si < mainAgentSessions.length - 1 && mainAgentSessions[si + 1].messages?.[0]?._timestamp;
        if (nextSessionStart && sa.timestamp > nextSessionStart) break;
        if (sa.timestamp) tsItemMap[sa.timestamp] = allItems.length;
        allItems.push(
          <ChatMessage key={`sub-chat-${subIdx}`} role="sub-agent-chat" content={sa.content} toolResultMap={sa.toolResultMap} label={sa.label} timestamp={sa.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={sa.requestIndex} onViewRequest={onViewRequest} />
        );
        subIdx++;
      }

      if (si === mainAgentSessions.length - 1 && session.response?.body?.content) {
        const respContent = session.response.body.content;
        if (Array.isArray(respContent)) {
          allItems.push(
            <React.Fragment key="resp-divider">
              <Divider style={{ borderColor: '#2a2a2a', margin: '8px 0' }}>
                <Text type="secondary" className={styles.lastResponseLabel}>{t('ui.lastResponse')}</Text>
              </Divider>
            </React.Fragment>
          );
          // 将 Last Response 关联到该 session 对应的 entry timestamp，用于原文-对话定位
          if (session.entryTimestamp) tsItemMap[session.entryTimestamp] = allItems.length;
          allItems.push(
            <ChatMessage key="resp-asst" role="assistant" content={respContent} timestamp={session.entryTimestamp} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={{}} />
          );
        }
      }
    });

    // 记录滚动目标 item index
    const { scrollToTimestamp } = this.props;
    this._scrollTargetIdx = scrollToTimestamp && tsItemMap[scrollToTimestamp] != null
      ? tsItemMap[scrollToTimestamp] : null;
    this._tsItemMap = tsItemMap;

    return allItems;
  }

  render() {
    const { mainAgentSessions } = this.props;
    const { allItems, visibleCount, loading } = this.state;

    if (!mainAgentSessions || mainAgentSessions.length === 0) {
      return (
        <div className={styles.centerEmpty}>
          <Empty description={t('ui.noChat')} />
        </div>
      );
    }

    if (loading) {
      return (
        <div className={styles.centerEmpty}>
          <Spin size="large" />
        </div>
      );
    }

    const targetIdx = this._scrollTargetIdx;
    const { highlightTs, highlightFading } = this.state;
    const highlightIdx = highlightTs && this._tsItemMap && this._tsItemMap[highlightTs] != null
      ? this._tsItemMap[highlightTs] : null;
    const visible = allItems.slice(0, visibleCount);

    return (
      <div
        ref={this.containerRef}
        className={styles.container}
      >
        {visible.map((item, i) => {
          const isScrollTarget = i === targetIdx;
          const needsHighlight = i === highlightIdx;
          let el = item;
          if (needsHighlight) {
            el = React.cloneElement(el, { highlight: highlightFading ? 'fading' : 'active' });
          }
          return isScrollTarget
            ? <div key={item.key + '-anchor'} ref={this._scrollTargetRef}>{el}</div>
            : el;
        })}
      </div>
    );
  }
}

export default ChatView;
