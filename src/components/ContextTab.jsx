import React, { useState, useMemo, useEffect } from 'react';
import { Typography, Empty } from 'antd';
import { RightOutlined, DownOutlined } from '@ant-design/icons';
import { renderMarkdown } from '../utils/markdown';
import { t } from '../i18n';
import JsonViewer from './JsonViewer';
import TranslateTag from './TranslateTag';
import styles from './ContextTab.module.css';

const { Text } = Typography;

// ── Block parsers ─────────────────────────────────────────────────────────────

function parseContentBlocks(content) {
  if (content == null) return [];

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? [{ type: 'markdown', text: trimmed }] : [];
  }

  if (Array.isArray(content)) {
    const blocks = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'text') {
        const trimmed = (block.text || '').trim();
        if (trimmed) blocks.push({ type: 'markdown', text: trimmed });
      } else if (block.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          name: block.name || 'unknown',
          id: block.id || '',
          input: block.input ?? {},
        });
      } else if (block.type === 'tool_result') {
        const inner = parseResultContent(block.content);
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id || '',
          is_error: block.is_error,
          content: inner,
        });
      } else if (block.type === 'thinking') {
        const text = block.thinking || '';
        if (text.trim()) blocks.push({ type: 'thinking', text });
      } else if (block.type === 'image') {
        blocks.push({ type: 'json', label: 'image', data: block });
      } else {
        blocks.push({ type: 'json', label: block.type || 'block', data: block });
      }
    }
    return blocks;
  }

  return [{ type: 'json', label: 'content', data: content }];
}

function parseResultContent(content) {
  if (content == null) return [];
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? [{ type: 'markdown', text: trimmed }] : [];
  }
  if (Array.isArray(content)) {
    return content.flatMap((c) => {
      if (!c) return [];
      if (c.type === 'text') {
        const trimmed = (c.text || '').trim();
        return trimmed ? [{ type: 'markdown', text: trimmed }] : [];
      }
      return [{ type: 'json', label: c.type || 'block', data: c }];
    });
  }
  return [{ type: 'json', label: 'content', data: content }];
}

function parseSystemBlocks(system) {
  if (!system) return null;
  if (typeof system === 'string') {
    return [{ type: 'markdown', text: system }];
  }
  if (Array.isArray(system)) {
    const blocks = [];
    system.forEach((item, i) => {
      if (i > 0) blocks.push({ type: 'separator' });
      if (!item) return;
      if (typeof item === 'string') {
        blocks.push({ type: 'markdown', text: item });
      } else if (item.type === 'text') {
        blocks.push({ type: 'markdown', text: item.text || '' });
      } else {
        blocks.push({ type: 'json', label: item.type || 'item', data: item });
      }
    });
    return blocks;
  }
  return [{ type: 'json', label: 'system', data: system }];
}

function parseToolBlocks(tool) {
  const blocks = [];
  const name = tool?.name || 'unknown';
  const desc = tool?.description || '';
  let md = `### ${name}\n\n`;
  if (desc) md += `${desc}\n\n`;
  blocks.push({ type: 'markdown', text: md });
  const schema = tool?.input_schema || tool?.parameters || null;
  if (schema) {
    blocks.push({ type: 'json', label: 'Parameters', data: schema });
  }
  return blocks;
}

// ── Message turn grouping ─────────────────────────────────────────────────────

function extractPreviewText(content) {
  if (typeof content === 'string') return content.slice(0, 60).replace(/\n/g, ' ');
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && block.text?.trim()) {
        return block.text.trim().slice(0, 60).replace(/\n/g, ' ');
      }
    }
  }
  return '';
}

function groupMessagesIntoTurns(messages) {
  const turns = [];
  let i = 0;
  while (i < messages.length) {
    const userMsg = messages[i];
    if (userMsg?.role !== 'user') { i++; continue; }
    const assistantMsg = messages[i + 1]?.role === 'assistant' ? messages[i + 1] : null;
    turns.push({
      id: `turn__${i}`,
      isTurn: true,
      turnIndex: turns.length,
      timestamp: userMsg._timestamp || null,
      assistantTimestamp: assistantMsg?._timestamp || null,
      userBlocks: parseContentBlocks(userMsg?.content),
      assistantBlocks: assistantMsg ? parseContentBlocks(assistantMsg.content) : null,
      preview: extractPreviewText(userMsg?.content),
    });
    i += assistantMsg ? 2 : 1;
  }
  return turns;
}

function formatTurnTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return null;
  }
}

// ── Block renderers ───────────────────────────────────────────────────────────

function TranslatableMarkdown({ text, compact }) {
  const [translatedHtml, setTranslatedHtml] = useState(null);
  const displayHtml = translatedHtml || renderMarkdown(text);
  const translateTag = (
    <TranslateTag
      text={text}
      onTranslated={(txt) => setTranslatedHtml(txt ? renderMarkdown(txt) : null)}
    />
  );

  if (compact) {
    return (
      <div className={styles.textBlockCompact}>
        <span className={styles.textBlockCompactFloat}>{translateTag}</span>
        <div className={`chat-md ${styles.markdownBody}`} dangerouslySetInnerHTML={{ __html: displayHtml }} />
      </div>
    );
  }

  return (
    <div className={styles.textBlock}>
      <div className={styles.textBlockBar}>
        <span className={`${styles.blockTag} ${styles.blockTagText}`}>text</span>
        {translateTag}
      </div>
      <div className={`chat-md ${styles.textBlockBody}`} dangerouslySetInnerHTML={{ __html: displayHtml }} />
    </div>
  );
}

function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(true);
  const [translatedHtml, setTranslatedHtml] = useState(null);
  const preview = block.text.length > 60 ? block.text.slice(0, 60).replace(/\n/g, ' ') + '…' : block.text.replace(/\n/g, ' ');
  const displayHtml = translatedHtml || renderMarkdown(block.text);
  return (
    <div className={styles.thinkingBlock}>
      <div className={styles.thinkingHeader} onClick={() => setExpanded((v) => !v)}>
        {expanded ? <DownOutlined className={styles.arrow} /> : <RightOutlined className={styles.arrow} />}
        <span className={`${styles.blockTag} ${styles.blockTagThinking}`}>thinking</span>
        {!expanded && <span className={styles.thinkingPreview}>{preview}</span>}
        {expanded && (
          <span onClick={(e) => e.stopPropagation()}>
            <TranslateTag
              text={block.text}
              onTranslated={(txt) => setTranslatedHtml(txt ? renderMarkdown(txt) : null)}
            />
          </span>
        )}
      </div>
      {expanded && (
        <div className={styles.thinkingBody}>
          <div
            className={`chat-md ${styles.markdownBody}`}
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        </div>
      )}
    </div>
  );
}

function RenderBlocks({ blocks, compact }) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <>
      {blocks.map((block, i) => (
        <RenderBlock key={i} block={block} compact={compact} />
      ))}
    </>
  );
}

function RenderBlock({ block, compact }) {
  if (block.type === 'separator') {
    return <hr className={styles.blockSeparator} />;
  }

  if (block.type === 'markdown') {
    if (!block.text?.trim()) return null;
    return <TranslatableMarkdown text={block.text} compact={compact} />;
  }

  if (block.type === 'thinking') {
    return <ThinkingBlock block={block} />;
  }

  if (block.type === 'tool_use') {
    return (
      <div className={styles.toolBlock}>
        <div className={styles.toolBlockHeader}>
          <span className={styles.blockTag}>tool_use</span>
          <span className={styles.toolName}>{block.name}</span>
          {block.id && <span className={styles.toolId}>{block.id}</span>}
        </div>
        <div className={styles.toolBlockBody}>
          <JsonViewer data={block.input} defaultExpand="root" />
        </div>
      </div>
    );
  }

  if (block.type === 'tool_result') {
    return (
      <div className={`${styles.toolBlock} ${block.is_error ? styles.toolBlockError : styles.toolBlockResult}`}>
        <div className={styles.toolBlockHeader}>
          <span className={`${styles.blockTag} ${block.is_error ? styles.blockTagError : styles.blockTagResult}`}>
            tool_result
          </span>
          {block.tool_use_id && <span className={styles.toolId}>{block.tool_use_id}</span>}
          {block.is_error && <span className={styles.errorLabel}>error</span>}
        </div>
        <div className={styles.toolBlockBody}>
          <RenderBlocks blocks={block.content} compact />
        </div>
      </div>
    );
  }

  if (block.type === 'json') {
    return (
      <div className={styles.jsonBlock}>
        {block.label && <div className={styles.jsonBlockLabel}>{block.label}</div>}
        <JsonViewer data={block.data} defaultExpand="root" />
      </div>
    );
  }

  return null;
}

// ── Turn content renderer ─────────────────────────────────────────────────────

function TurnContent({ turn }) {
  const timeStr = turn.timestamp ? formatTurnTime(turn.timestamp) : null;
  const assistantTimeStr = turn.assistantTimestamp ? formatTurnTime(turn.assistantTimestamp) : null;
  return (
    <div>
      <div className={styles.roleHeader}>
        <span className={`${styles.roleBadge} ${styles.role_user}`}>user</span>
        <span className={styles.roleLabel}>{`Turn ${turn.turnIndex + 1}`}</span>
        {timeStr && <span className={styles.contentTime}>{timeStr}</span>}
      </div>
      <RenderBlocks blocks={turn.userBlocks} />
      {turn.assistantBlocks && (
        <>
          <div className={styles.turnDivider} />
          <div className={styles.roleHeader}>
            <span className={`${styles.roleBadge} ${styles.role_assistant}`}>assistant</span>
            {assistantTimeStr && <span className={styles.contentTime}>{assistantTimeStr}</span>}
          </div>
          <RenderBlocks blocks={turn.assistantBlocks} />
        </>
      )}
    </div>
  );
}

// ── Accordion ─────────────────────────────────────────────────────────────────

function AccordionSection({ title, items, historyItems, onSelect, selectedId }) {
  const [open, setOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const totalCount = items.length + (historyItems?.length || 0);

  function renderItem(item) {
    const active = selectedId === item.id;
    return (
      <div
        key={item.id}
        className={`${styles.item} ${active ? styles.itemActive : ''}`}
        onClick={() => onSelect(item)}
      >
        <div className={styles.itemContent}>
          <span className={styles.itemLabel}>{item.label}</span>
          {item.sublabel && !active && (
            <div className={styles.itemSublabel}>{item.sublabel}</div>
          )}
        </div>
        {item.time && <span className={styles.itemTime}>{item.time}</span>}
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <DownOutlined className={styles.arrow} /> : <RightOutlined className={styles.arrow} />}
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionCount}>{totalCount}</span>
      </div>
      {open && (
        <div className={styles.sectionBody}>
          {historyItems && historyItems.length > 0 && (
            <>
              <div
                className={styles.historyToggle}
                onClick={() => setHistoryOpen((v) => !v)}
              >
                {historyOpen ? <DownOutlined className={styles.arrow} /> : <RightOutlined className={styles.arrow} />}
                <span className={styles.historyToggleLabel}>
                  {t('ui.context.history')} ({historyItems.length})
                </span>
              </div>
              {historyOpen && historyItems.map(renderItem)}
            </>
          )}
          {items.map(renderItem)}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContextTab({ body, response }) {
  const [selectedItem, setSelectedItem] = useState(null);

  // Compute conversation turns from messages.
  // The last turn's assistant blocks are overridden with the actual response content.
  const turns = useMemo(() => {
    if (!Array.isArray(body?.messages)) return [];
    const allTurns = groupMessagesIntoTurns(body.messages);
    if (allTurns.length === 0) return allTurns;
    const last = allTurns[allTurns.length - 1];
    const responseBlocks = response?.content ? parseContentBlocks(response.content) : null;
    return [
      ...allTurns.slice(0, -1),
      { ...last, assistantBlocks: responseBlocks ?? last.assistantBlocks },
    ];
  }, [body, response]);

  // Auto-select last turn whenever body or response changes
  useEffect(() => {
    if (turns.length > 0) {
      setSelectedItem(turns[turns.length - 1]);
    } else {
      setSelectedItem(null);
    }
  }, [body, response]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!body || typeof body !== 'object') {
    return (
      <div className={styles.emptyWrap}>
        <Empty description={t('ui.context.noData')} />
      </div>
    );
  }

  const accordionSections = [];

  // System prompt
  const systemBlocks = parseSystemBlocks(body.system);
  if (systemBlocks != null) {
    accordionSections.push({
      key: 'system',
      title: t('ui.context.systemPrompt'),
      items: [{
        id: 'system__0',
        label: t('ui.context.systemPrompt'),
        blocks: systemBlocks,
      }],
    });
  }

  // Messages: grouped into conversation turns
  // Historical turns (all but the last) go into a collapsible sub-group
  if (turns.length > 0) {
    const toHistoryItem = (turn) => ({
      ...turn,
      label: t('ui.context.historyTurnNoTime', { n: turn.turnIndex + 1 }),
      time: turn.timestamp ? formatTurnTime(turn.timestamp) : null,
      sublabel: turn.preview || undefined,
    });
    const toCurrentItem = (turn) => ({
      ...turn,
      label: t('ui.context.currentTurn'),
      sublabel: turn.preview || undefined,
    });
    const historyTurns = turns.slice(0, -1).map(toHistoryItem);
    const currentTurn = toCurrentItem(turns[turns.length - 1]);
    accordionSections.push({
      key: 'messages',
      title: t('ui.context.messages'),
      historyItems: historyTurns.length > 0 ? historyTurns : undefined,
      items: [currentTurn],
    });
  }

  // Tools
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    accordionSections.push({
      key: 'tools',
      title: t('ui.context.tools'),
      items: body.tools.map((tool, i) => ({
        id: `tool__${i}`,
        label: tool?.name || `Tool ${i}`,
        blocks: parseToolBlocks(tool),
      })),
    });
  }

  if (accordionSections.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        <Empty description={t('ui.context.noFields')} />
      </div>
    );
  }

  // For turn items: resolve against the current turns array
  const currentSelectedItem = selectedItem?.isTurn
    ? (turns.find(t => t.id === selectedItem.id) ?? null)
    : selectedItem;

  return (
    <div className={styles.root}>
      {/* Left accordion */}
      <div className={styles.sidebar}>
        {accordionSections.map((sec) => (
          <AccordionSection
            key={sec.key}
            title={sec.title}
            items={sec.items}
            historyItems={sec.historyItems}
            selectedId={currentSelectedItem?.id}
            onSelect={(item) => setSelectedItem(item)}
          />
        ))}
      </div>

      {/* Right content */}
      <div className={styles.content}>
        {currentSelectedItem == null ? (
          <div className={styles.contentEmpty}>
            <Text type="secondary">{t('ui.context.selectPrompt')}</Text>
          </div>
        ) : (
          <div key={currentSelectedItem.id} className={styles.contentInner}>
            {currentSelectedItem.isTurn ? (
              <TurnContent turn={currentSelectedItem} />
            ) : (
              <>
                {currentSelectedItem.role && (
                  <div className={styles.roleHeader}>
                    <span className={`${styles.roleBadge} ${styles[`role_${currentSelectedItem.role}`] || ''}`}>
                      {currentSelectedItem.role}
                    </span>
                    <span className={styles.roleLabel}>{currentSelectedItem.label}</span>
                  </div>
                )}
                <RenderBlocks blocks={currentSelectedItem.blocks} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
