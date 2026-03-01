import React, { useState } from 'react';
import { Typography, Empty } from 'antd';
import { RightOutlined, DownOutlined } from '@ant-design/icons';
import { renderMarkdown } from '../utils/markdown';
import { t } from '../i18n';
import styles from './ContextTab.module.css';

const { Text } = Typography;

/**
 * 将 messages 数组中每条消息格式化为 Markdown 文本
 */
function formatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  return messages.map((msg, i) => {
    const role = msg?.role || 'unknown';
    let content = '';
    if (typeof msg?.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg?.content)) {
      content = msg.content
        .map((block) => {
          if (!block) return '';
          if (block.type === 'text') return block.text || '';
          if (block.type === 'tool_use') return `\`\`\`json\n${JSON.stringify(block, null, 2)}\n\`\`\``;
          if (block.type === 'tool_result') {
            const resultContent =
              typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                ? block.content.map((c) => c?.text || '').join('\n')
                : JSON.stringify(block.content, null, 2);
            return `**[tool_result]**\n${resultContent}`;
          }
          return JSON.stringify(block, null, 2);
        })
        .join('\n\n');
    } else {
      content = JSON.stringify(msg?.content, null, 2);
    }
    return { index: i, role, content };
  });
}

/**
 * 将 system 数组/字符串格式化为 Markdown 文本
 */
function formatSystem(system) {
  if (!system) return null;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (item.type === 'text') return item.text || '';
        return JSON.stringify(item, null, 2);
      })
      .join('\n\n---\n\n');
  }
  return JSON.stringify(system, null, 2);
}

/**
 * 将 tools 数组中单个工具格式化为 Markdown 文本
 */
function formatTool(tool) {
  const name = tool?.name || 'unknown';
  const desc = tool?.description || '';
  const schema = tool?.input_schema || tool?.parameters || null;
  let md = `## ${name}\n\n`;
  if (desc) md += `${desc}\n\n`;
  if (schema) {
    md += `**Parameters:**\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n`;
  }
  return md;
}

// ──────────────────────────────────────────────────────────────────────────────
// 手风琴子项
// ──────────────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────────────
// 主组件
// ──────────────────────────────────────────────────────────────────────────────
export default function ContextTab({ body }) {
  const [selected, setSelected] = useState(null);

  if (!body || typeof body !== 'object') {
    return (
      <div className={styles.emptyWrap}>
        <Empty description={t('ui.context.noData')} />
      </div>
    );
  }

  // ── 构建手风琴数据 ──────────────────────────────────────────────────────────
  const accordionSections = [];

  // 系统提示词
  const systemText = formatSystem(body.system);
  if (systemText != null) {
    accordionSections.push({
      key: 'system',
      title: t('ui.context.systemPrompt'),
      items: [
        {
          id: 'system__0',
          label: t('ui.context.systemPrompt'),
          markdown: systemText,
        },
      ],
    });
  }

  // 消息列表
  const msgItems = formatMessages(body.messages);
  if (msgItems && msgItems.length > 0) {
    accordionSections.push({
      key: 'messages',
      title: t('ui.context.messages'),
      items: msgItems.map((m) => ({
        id: `msg__${m.index}`,
        label: `[${m.index}] ${m.role}`,
        markdown: m.content,
      })),
    });
  }

  // 工具列表
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    accordionSections.push({
      key: 'tools',
      title: t('ui.context.tools'),
      items: body.tools.map((tool, i) => ({
        id: `tool__${i}`,
        label: tool?.name || `Tool ${i}`,
        markdown: formatTool(tool),
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

  const selectedMarkdown = selected?.markdown || null;

  return (
    <div className={styles.root}>
      {/* 左侧手风琴 */}
      <div className={styles.sidebar}>
        {accordionSections.map((sec) => (
          <AccordionSection
            key={sec.key}
            title={sec.title}
            items={sec.items}
            selectedId={selected?.id}
            onSelect={(item) => setSelected(item)}
          />
        ))}
      </div>

      {/* 右侧内容区 */}
      <div className={styles.content}>
        {selectedMarkdown == null ? (
          <div className={styles.contentEmpty}>
            <Text type="secondary">{t('ui.context.selectPrompt')}</Text>
          </div>
        ) : (
          <div
            className={`chat-md ${styles.markdownBody}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedMarkdown) }}
          />
        )}
      </div>
    </div>
  );
}
