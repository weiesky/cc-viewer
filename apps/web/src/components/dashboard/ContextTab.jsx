import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Typography, Empty, Switch, Button, message } from 'antd';
import { RightOutlined, DownOutlined, CopyOutlined } from '@ant-design/icons';
import { renderMarkdown } from '../../utils/markdown';
import { t } from '../../i18n';
import { getContextSidebarArrowNavigation } from '../../utils/contextSidebarNavigation';
import { buildContextItemRawText } from '../../utils/contextRaw';
import { parseContentBlocks, groupMessagesIntoTurns } from '../../utils/contextTurns';
import { computeToolsDiff } from '../../utils/toolsDiff';
import JsonViewer from '../viewers/JsonViewer';
import ConceptHelp from '../common/ConceptHelp';

import styles from './ContextTab.module.css';

const { Text } = Typography;

// ── Block parsers ─────────────────────────────────────────────────────────────
// parseContentBlocks / parseResultContent / extractPreviewText / groupMessagesIntoTurns
// live in src/utils/contextTurns.js (extracted for unit-testability).

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
  const displayHtml = renderMarkdown(text);

  if (compact) {
    return (
      <div className={styles.textBlockCompact}>
        <div className={`chat-md ${styles.markdownBody}`} dangerouslySetInnerHTML={{ __html: displayHtml }} />
      </div>
    );
  }

  return (
    <div className={styles.textBlock}>
      <div className={styles.textBlockBar}>
        <span className={`${styles.blockTag} ${styles.blockTagText}`}>text</span>
      </div>
      <div className={`chat-md ${styles.textBlockBody}`} dangerouslySetInnerHTML={{ __html: displayHtml }} />
    </div>
  );
}

function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(true);
  const preview = block.text.length > 60 ? block.text.slice(0, 60).replace(/\n/g, ' ') + '…' : block.text.replace(/\n/g, ' ');
  return (
    <div className={styles.thinkingBlock}>
      <div className={styles.thinkingHeader} onClick={() => setExpanded((v) => !v)}>
        {expanded ? <DownOutlined className={styles.arrow} /> : <RightOutlined className={styles.arrow} />}
        <span className={`${styles.blockTag} ${styles.blockTagThinking}`}>thinking</span>
        {!expanded && <span className={styles.thinkingPreview}>{preview}</span>}
      </div>
      {expanded && (
        <div className={styles.thinkingBody}>
          <div
            className={`chat-md ${styles.markdownBody}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
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
      {turn.systemBlocks && turn.systemBlocks.map((sys, si) => (
        <React.Fragment key={si}>
          <div className={styles.turnDivider} />
          <div className={styles.roleHeader}>
            <span className={`${styles.roleBadge} ${styles.role_system}`}>system</span>
            {sys.timestamp && <span className={styles.contentTime}>{formatTurnTime(sys.timestamp)}</span>}
          </div>
          <RenderBlocks blocks={sys.blocks} />
        </React.Fragment>
      ))}
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

function AccordionSection({ sectionKey, title, items, historyItems = [], onSelect, onSelectById, selectedId, sidebarRef, countOverride }) {
  const [open, setOpen] = useState(sectionKey !== 'tools');
  const [historyOpen, setHistoryOpen] = useState(false);
  // countOverride 存在时（如 tools 区：移除项是 diff 占位、不计入实际数量）按其统计，
  // 否则用列表项总数。
  const totalCount = countOverride != null ? countOverride : items.length + historyItems.length;
  const historyToggleId = `${sectionKey}__history_toggle`;

  function focusControl(controlId) {
    const el = sidebarRef.current?.querySelector(`[data-context-sidebar-control="${controlId}"]`);
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: 'nearest' });
  }

  function handleControlKeyDown(event, controlId) {
    const visibleIds = Array.from(
      sidebarRef.current?.querySelectorAll('[data-context-sidebar-control]') || []
    ).map((el) => el.dataset.contextSidebarControl).filter(Boolean);
    const nextId = getContextSidebarArrowNavigation({
      currentId: controlId,
      visibleIds,
      key: event.key,
    });
    if (!nextId) return;

    event.preventDefault();
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        focusControl(nextId);
        const nextEl = sidebarRef.current?.querySelector(`[data-context-sidebar-control="${nextId}"]`);
        if (nextEl?.dataset.controlType === 'item') {
          onSelectById(nextId);
        }
      });
    }
  }

  function renderItem(item) {
    const active = selectedId === item.id;
    return (
      <button
        type="button"
        key={item.id}
        className={`${styles.item} ${active ? styles.itemActive : ''}`}
        onClick={() => onSelect(item)}
        onKeyDown={(event) => handleControlKeyDown(event, item.id)}
        aria-current={active ? 'true' : undefined}
        data-context-sidebar-control={item.id}
        data-control-type="item"
      >
        <div className={styles.itemContent}>
          <span className={styles.itemLabel}>{item.label}</span>
          {item.sublabel && !active && (
            <div className={styles.itemSublabel}>{item.sublabel}</div>
          )}
        </div>
        {item.time && <span className={styles.itemTime}>{item.time}</span>}
      </button>
    );
  }

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <DownOutlined className={styles.arrow} /> : <RightOutlined className={styles.arrow} />}
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionCount}>{totalCount}</span>
      </button>
      {open && (
        <div className={styles.sectionBody}>
          {historyItems.length > 0 && (
            <>
              <button
                type="button"
                className={styles.historyToggle}
                onClick={() => setHistoryOpen((v) => !v)}
                onKeyDown={(event) => handleControlKeyDown(event, historyToggleId)}
                aria-expanded={historyOpen}
                data-context-sidebar-control={historyToggleId}
                data-control-type="toggle"
              >
                {historyOpen ? <DownOutlined className={styles.arrow} /> : <RightOutlined className={styles.arrow} />}
                <span className={styles.historyToggleLabel}>
                  {t('ui.context.history')} ({historyItems.length})
                </span>
              </button>
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

export default function ContextTab({ body, response, prevTools }) {
  const [selectedItem, setSelectedItem] = useState(null);
  // 「原文」模式：右侧面板显示选中节点的原始 JSON 纯文本；切换节点时保持
  const [rawMode, setRawMode] = useState(false);
  const sidebarRef = useRef(null);
  const contentRef = useRef(null);

  // Compute turns from messages; override last turn's assistant blocks with actual response.
  const turns = useMemo(() => {
    if (!Array.isArray(body?.messages)) return [];
    const allTurns = groupMessagesIntoTurns(body.messages);
    if (allTurns.length === 0) return allTurns;
    const last = allTurns[allTurns.length - 1];
    const responseBlocks = response?.content ? parseContentBlocks(response.content) : null;
    return [
      ...allTurns.slice(0, -1),
      {
        ...last,
        assistantBlocks: responseBlocks ?? last.assistantBlocks,
        // 当前轮 assistant 原文 = 完整 response body（即该回复的原始 JSON，含 usage/model）；
        // response 为字符串/null（流式中）时回退请求体内 assistant，与解析视图同口径
        rawAssistant: responseBlocks ? response : last.rawAssistant,
      },
    ];
  }, [body, response]);

  // Auto-select last turn whenever body or response changes.
  useEffect(() => {
    if (turns.length > 0) {
      setSelectedItem(turns[turns.length - 1]);
    } else {
      setSelectedItem(null);
    }
  }, [body, response]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve selected turn against live turns array to pick up response updates.
  // 提前到 early return 之前：rawText 的 useMemo 依赖它（hooks 顺序约束）。
  const currentSelectedItem = selectedItem?.isTurn
    ? (turns.find((turn) => turn.id === selectedItem.id) ?? null)
    : selectedItem;

  const rawText = useMemo(() => buildContextItemRawText(currentSelectedItem), [currentSelectedItem]);

  if (!body || typeof body !== 'object') {
    return (
      <div className={styles.emptyWrap}>
        <Empty description={t('ui.context.noData')} />
      </div>
    );
  }

  const accordionSections = [];

  // Tools (collapsed by default, shown first to match API cache prefix order)
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    // 相对上一条 MainAgent 请求的 tools diff：tools_search 等场景下 tools 列表逐请求变化，
    // 这里高亮新增/移除，让"变化时机/内容"可见。prevTools 为空（无上一条/非 MainAgent）时不显示 diff。
    const diff = computeToolsDiff(prevTools, body.tools);

    const toolItems = body.tools.map((tool, i) => {
      const name = tool?.name || `Tool ${i}`;
      const isAdded = diff.isAdded(tool?.name);
      return {
        id: `tool__${i}`,
        label: isAdded
          ? <span className={styles.toolAdded}>{name}<span className={styles.toolDiffTag}>{t('ui.context.toolAdded')}</span></span>
          : name,
        blocks: parseToolBlocks(tool),
        raw: tool,
      };
    });

    // 移除的 tool 在当前请求里已不存在，追加为只读条目展示。id 用 name 派生（稳定，
    // 数据刷新/重排时不会让选中态漂移到别的项）。
    diff.removedNames.forEach((name) => {
      toolItems.push({
        id: `tool_removed__${name}`,
        label: <span className={styles.toolRemoved}>{name}<span className={styles.toolDiffTag}>{t('ui.context.toolRemoved')}</span></span>,
        blocks: [{ type: 'markdown', text: t('ui.context.toolRemovedNote') }],
        raw: { name, _removed: true },
      });
    });

    accordionSections.push({
      key: 'tools',
      // 数量徽标只算当前请求实际携带的 tools（少了工具就按少了之后算）；
      // 移除项是相对上一条的 diff 占位，不计入数量。
      countOverride: body.tools.length,
      title: (
        <>
          {t('ui.context.tools')} <ConceptHelp doc="ToolsFirst" />
          {diff.changed && (
            <span className={styles.toolDiffSummary}>
              {diff.addedCount > 0 && <span className={styles.toolDiffSummaryAdd}>+{diff.addedCount}</span>}
              {diff.removedCount > 0 && <span className={styles.toolDiffSummaryRemove}>-{diff.removedCount}</span>}
            </span>
          )}
        </>
      ),
      items: toolItems,
    });
  }

  // System prompt
  const systemBlocks = parseSystemBlocks(body.system);
  if (systemBlocks != null) {
    accordionSections.push({
      key: 'system',
      title: t('ui.context.systemPrompt'),
      items: [{ id: 'system__0', label: t('ui.context.systemPrompt'), blocks: systemBlocks, raw: body.system }],
    });
  }

  // Messages grouped into turns; history collapsed, current always visible.
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

  if (accordionSections.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        <Empty description={t('ui.context.noFields')} />
      </div>
    );
  }

  const itemMap = new Map();
  accordionSections.forEach((section) => {
    (section.historyItems || []).forEach((item) => itemMap.set(item.id, item));
    section.items.forEach((item) => itemMap.set(item.id, item));
  });

  return (
    <div className={styles.root}>
      <div ref={sidebarRef} className={styles.sidebar}>
        {accordionSections.map((sec) => (
          <AccordionSection
            key={sec.key}
            sectionKey={sec.key}
            title={sec.title}
            items={sec.items}
            historyItems={sec.historyItems}
            countOverride={sec.countOverride}
            selectedId={currentSelectedItem?.id}
            onSelect={(item) => setSelectedItem(item)}
            onSelectById={(itemId) => {
              const nextItem = itemMap.get(itemId);
              if (nextItem) setSelectedItem(nextItem);
            }}
            sidebarRef={sidebarRef}
          />
        ))}
      </div>

      <div className={styles.contentWrap}>
        {/* 工具条独占一行（滚动区之外），不悬浮、不遮挡内容 */}
        {currentSelectedItem != null && (
          <div className={styles.contentToolbar}>
            {rawMode && (
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  // navigator.clipboard 在非安全上下文（局域网明文 HTTP）为 undefined，先判存在
                  if (!navigator.clipboard) return;
                  navigator.clipboard.writeText(rawText).then(() => message.success(t('ui.copySuccess'))).catch(() => {});
                }}
              >
                {t('ui.copy')}
              </Button>
            )}
            <span className={styles.contentToolbarLabel}>{t('ui.context.viewRaw')}</span>
            <Switch
              size="small"
              checked={rawMode}
              aria-label={t('ui.context.viewRaw')}
              onChange={(v) => {
                setRawMode(v);
                // 长解析视图切短原文时不留滚出内容的空白滚动位
                if (contentRef.current) contentRef.current.scrollTop = 0;
              }}
            />
          </div>
        )}
        <div className={styles.content} ref={contentRef}>
          {currentSelectedItem == null ? (
            <div className={styles.contentEmpty}>
              <Text type="secondary">{t('ui.context.selectPrompt')}</Text>
            </div>
          ) : (
            <div key={currentSelectedItem.id} className={styles.contentInner}>
              {rawMode ? (
                <pre className={styles.rawPre}>{rawText}</pre>
              ) : currentSelectedItem.isTurn ? (
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
    </div>
  );
}
