import React from 'react';
import { Empty, Typography, Divider, Spin } from 'antd';
import ChatMessage from './ChatMessage';
import { extractToolResultText, isSystemText, getModelInfo } from '../utils/helpers';
import { renderAssistantText } from '../utils/systemTags';
import { t } from '../i18n';

const { Text } = Typography;

const QUEUE_THRESHOLD = 20;

function randomInterval() {
  return 100 + Math.random() * 50;
}

class ChatView extends React.Component {
  constructor(props) {
    super(props);
    this.containerRef = React.createRef();
    this.state = {
      visibleCount: 0,
      loading: false,
      allItems: [],
    };
    this._queueTimer = null;
    this._prevItemsLen = 0;
  }

  componentDidMount() {
    this.startRender();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.mainAgentSessions !== this.props.mainAgentSessions) {
      this.startRender();
    }
  }

  componentWillUnmount() {
    if (this._queueTimer) clearTimeout(this._queueTimer);
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

  scrollToBottom() {
    const el = this.containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  renderSessionMessages(messages, keyPrefix, msgTimestamps, modelInfo) {
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

    const renderedMessages = [];

    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
      const content = msg.content;
      const ts = msgTimestamps && msgTimestamps[mi] ? msgTimestamps[mi] : null;

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
                <ChatMessage key={`${keyPrefix}-selection-${mi}`} role="user-selection" questions={questions} answers={answers} timestamp={ts} />
              );
            }
          } else {
            const textBlocks = content.filter(b => b.type === 'text' && !isSystemText(b.text));
            for (let ti = 0; ti < textBlocks.length; ti++) {
              renderedMessages.push(
                <ChatMessage key={`${keyPrefix}-user-${mi}-${ti}`} role="user" text={textBlocks[ti].text} timestamp={ts} />
              );
            }
          }
        } else if (typeof content === 'string' && !isSystemText(content)) {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-user-${mi}`} role="user" text={content} timestamp={ts} />
          );
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(content)) {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={content} toolResultMap={toolResultMap} timestamp={ts} modelInfo={modelInfo} />
          );
        } else if (typeof content === 'string') {
          renderedMessages.push(
            <ChatMessage key={`${keyPrefix}-asst-${mi}`} role="assistant" content={[{ type: 'text', text: content }]} toolResultMap={toolResultMap} timestamp={ts} modelInfo={modelInfo} />
          );
        }
      }
    }

    return renderedMessages;
  }

  buildAllItems() {
    const { mainAgentSessions, requests } = this.props;
    if (!mainAgentSessions || mainAgentSessions.length === 0) return [];

    // 从最新的 mainAgent 请求中提取模型名
    let modelName = null;
    if (requests) {
      for (let i = requests.length - 1; i >= 0; i--) {
        if (requests[i].mainAgent && requests[i].body?.model) {
          modelName = requests[i].body.model;
          break;
        }
      }
    }
    const modelInfo = getModelInfo(modelName);

    const allItems = [];

    mainAgentSessions.forEach((session, si) => {
      if (si > 0) {
        allItems.push(
          <Divider key={`session-div-${si}`} style={{ borderColor: '#333', margin: '16px 0' }}>
            <Text style={{ fontSize: 11, color: '#555' }}>Session</Text>
          </Divider>
        );
      }

      allItems.push(...this.renderSessionMessages(session.messages, `s${si}`, session.msgTimestamps, modelInfo));

      if (si === mainAgentSessions.length - 1 && session.response?.body?.content) {
        const respContent = session.response.body.content;
        if (Array.isArray(respContent)) {
          allItems.push(
            <React.Fragment key="resp-divider">
              <Divider style={{ borderColor: '#2a2a2a', margin: '8px 0' }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{t('ui.lastResponse')}</Text>
              </Divider>
            </React.Fragment>
          );
          allItems.push(
            <ChatMessage key="resp-asst" role="assistant" content={respContent} modelInfo={modelInfo} />
          );
        }
      }
    });

    return allItems;
  }

  render() {
    const { mainAgentSessions } = this.props;
    const { allItems, visibleCount, loading } = this.state;

    if (!mainAgentSessions || mainAgentSessions.length === 0) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Empty description={t('ui.noChat')} />
        </div>
      );
    }

    if (loading) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Spin size="large" />
        </div>
      );
    }

    return (
      <div
        ref={this.containerRef}
        style={{
          height: '100%',
          overflow: 'auto',
          padding: '16px 24px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {allItems.slice(0, visibleCount)}
      </div>
    );
  }
}

export default ChatView;
