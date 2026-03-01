import React, { useState } from 'react';
import { Typography, Empty } from 'antd';
import { RightOutlined, DownOutlined } from '@ant-design/icons';
import { renderMarkdown } from '../utils/markdown';
import { t } from '../i18n';
import JsonViewer from './JsonViewer';
import TranslateTag from './TranslateTag';
import styles from './ContextTab.module.css';

const { Text } = Typography;

// ── Block parsers ─────────────────────────────────────────────────────────────

/**
 * Parse a single content block array or string into typed render-blocks.
 * Returns an array of:
 *   { type: 'markdown', text }
 *   { type: 'tool_use', name, id, input }
 *   { type: 'tool_result', tool_use_id, content: renderBlocks[] }
 *   { type: 'json', label, data }
 */
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

// ── Accordion ─────────────────────────────────────────────────────────────────

function AccordionSection({ title, items, onSelect, selectedId }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <DownOutlined className={styles.arrow} /> : <RightOutlined className={styles.arrow} />}
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionCount}>{items.length}</span>
      </div>
      {open && (
        <div className={styles.sectionBody}>
          {items.map((item) => {
            const active = selectedId === item.id;
            return (
              <div
                key={item.id}
                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                onClick={() => onSelect(item)}
              >
                <span className={styles.itemLabel}>{item.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContextTab({ body }) {
  const [selected, setSelected] = useState(null);

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

  // Messages
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    accordionSections.push({
      key: 'messages',
      title: t('ui.context.messages'),
      items: body.messages.map((msg, i) => ({
        id: `msg__${i}`,
        label: `[${i}] ${msg?.role || 'unknown'}`,
        role: msg?.role || 'unknown',
        blocks: parseContentBlocks(msg?.content),
      })),
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

  const selectedItem = selected;

  return (
    <div className={styles.root}>
      {/* Left accordion */}
      <div className={styles.sidebar}>
        {accordionSections.map((sec) => (
          <AccordionSection
            key={sec.key}
            title={sec.title}
            items={sec.items}
            selectedId={selectedItem?.id}
            onSelect={(item) => setSelected(item)}
          />
        ))}
      </div>

      {/* Right content */}
      <div className={styles.content}>
        {selectedItem == null ? (
          <div className={styles.contentEmpty}>
            <Text type="secondary">{t('ui.context.selectPrompt')}</Text>
          </div>
        ) : (
          <div key={selectedItem.id} className={styles.contentInner}>
            {selectedItem.role && (
              <div className={styles.roleHeader}>
                <span className={`${styles.roleBadge} ${styles[`role_${selectedItem.role}`] || ''}`}>
                  {selectedItem.role}
                </span>
                <span className={styles.roleLabel}>{selectedItem.label}</span>
              </div>
            )}
            <RenderBlocks blocks={selectedItem.blocks} />
          </div>
        )}
      </div>
    </div>
  );
}
