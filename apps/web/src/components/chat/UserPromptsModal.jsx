import React, { useMemo, useState } from 'react';
import { Button, Collapse, Modal, Tabs } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { classifyUserContent, isMainAgent, extractDisplayText } from '@ccv/core/contentFilter';
import { parseImOrigin } from '../../utils/imOrigin';
import { parsePromptSegments } from '../../utils/promptSegments';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import { t } from '../../i18n';
import styles from './UserPromptsModal.module.css';

// 用户 Prompt 汇总弹窗：左侧头像导航气泡里的「more」入口打开。
// 数据从 props.requests（mainAgent 请求流）提取，与原汉堡菜单「查看用户 Prompt」口径一致。

// 从消息列表中提取用户文本
function extractUserTexts(messages) {
  const userMsgs = [];   // 纯用户文本（不含系统标签），用于去重
  const fullTexts = [];  // 完整文本（含系统标签），用于展示
  let slashCmd = null;
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      const text = extractDisplayText(parseImOrigin(msg.content).text);
      if (!text) continue;
      if (/Implement the following plan:/i.test(text)) continue;
      userMsgs.push(text);
      fullTexts.push(text);
    } else if (Array.isArray(msg.content)) {
      const { commands, textBlocks } = classifyUserContent(msg.content);
      // 取最后一个 slash command（与之前行为一致）
      if (commands.length > 0) {
        slashCmd = commands[commands.length - 1];
      }
      // 过滤掉 plan prompt
      const userParts = [];
      for (const b of textBlocks) {
        if (/Implement the following plan:/i.test((b.text || '').trim())) continue;
        userParts.push(b.text.trim());
      }
      // 收集完整文本用于 context 视图
      const allParts = msg.content
        .filter(b => b.type === 'text' && b.text?.trim())
        .map(b => b.text.trim());
      if (userParts.length > 0) {
        userMsgs.push(userParts.join('\n'));
        fullTexts.push(allParts.join('\n'));
      }
    }
  }
  return { userMsgs, fullTexts, slashCmd };
}

function extractUserPrompts(requests) {
  const prompts = [];
  const seen = new Set();
  let prevSlashCmd = null;
  const mainAgentRequests = (requests || []).filter(r => isMainAgent(r));
  for (let ri = 0; ri < mainAgentRequests.length; ri++) {
    const req = mainAgentRequests[ri];
    const messages = req.body?.messages || [];
    const timestamp = req.timestamp || '';
    const { userMsgs, fullTexts, slashCmd } = extractUserTexts(messages);

    // 斜杠命令去重
    if (slashCmd && slashCmd !== '/compact' && slashCmd !== prevSlashCmd) {
      prompts.push({ type: 'prompt', segments: [{ type: 'text', content: slashCmd }], timestamp });
    }
    prevSlashCmd = slashCmd;

    // 逐条检查用户消息，用内容哈希去重
    for (let i = 0; i < userMsgs.length; i++) {
      const key = userMsgs[i];
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = fullTexts[i] || key;
      prompts.push({ type: 'prompt', segments: parsePromptSegments(raw), timestamp });
    }
  }
  return prompts;
}

function buildTextModeContent(promptData) {
  const blocks = [];
  for (const p of promptData) {
    const textParts = (p.segments || [])
      .filter(seg => seg.type === 'text')
      .map(seg => seg.content);
    if (textParts.length > 0) blocks.push(textParts.join('\n'));
  }
  return blocks.join('\n\n\n');
}

function renderOriginalPrompt(p) {
  const textSegments = p.segments.filter(seg => seg.type === 'text');
  if (textSegments.length === 0) return null;
  return (
    <div className={styles.textPromptCard}>
      {textSegments.map((seg, j) => (
        <pre key={j} className={styles.preText}>{seg.content}</pre>
      ))}
    </div>
  );
}

function renderTextPrompt(p) {
  return (
    <div className={styles.textPromptCard}>
      {p.segments.map((seg, j) => {
        if (seg.type === 'text') {
          return (
            <pre key={j} className={styles.preText}>{seg.content}</pre>
          );
        }
        return (
          <Collapse
            key={j}
            size="small"
            className={styles.systemCollapse}
            items={[{
              key: `sys-${j}`,
              label: <span className={styles.systemLabel}>{seg.label}</span>,
              children: (
                <pre className={styles.preSys}>{seg.content}</pre>
              ),
            }]}
          />
        );
      })}
    </div>
  );
}

export default function UserPromptsModal({ open, requests, onClose }) {
  const [viewMode, setViewMode] = useState('original');
  // 打开时才聚合（O(N) 扫描请求流）；关闭期间不占用 render 开销。
  const promptData = useMemo(
    () => (open ? extractUserPrompts(requests) : []),
    [open, requests],
  );

  const handleExportTxt = () => {
    if (!promptData || promptData.length === 0) return;
    const blocks = [];
    for (const p of promptData) {
      const lines = [];
      const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : '';
      if (ts) lines.push(`${ts}:\n`);
      // 只输出纯文本 segments，跳过 system 标签
      const textParts = (p.segments || [])
        .filter(seg => seg.type === 'text')
        .map(seg => seg.content);
      if (textParts.length > 0) lines.push(textParts.join('\n'));
      blocks.push(lines.join('\n'));
    }
    if (blocks.length === 0) return;
    const blob = new Blob([blocks.join('\n\n\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `user-prompts-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      title={`${t('ui.userPrompt')} (${promptData.length}${t('ui.promptCountUnit')})`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      styles={{ mask: BLUR_MASK_STYLE }}
    >
      <div className={styles.promptExportBar}>
        <Button icon={<DownloadOutlined />} onClick={handleExportTxt}>
          {t('ui.exportPromptsTxt')}
        </Button>
      </div>
      <Tabs
        activeKey={viewMode}
        onChange={setViewMode}
        size="small"
        items={[
          { key: 'original', label: t('ui.promptModeOriginal') },
          { key: 'context', label: t('ui.promptModeContext') },
          { key: 'text', label: t('ui.promptModeText') },
        ]}
      />
      {viewMode === 'text' ? (
        <textarea
          readOnly
          className={styles.promptTextarea}
          value={buildTextModeContent(promptData)}
        />
      ) : (
        <div className={styles.promptScrollArea}>
          {promptData.length === 0 && (
            <div className={styles.promptEmpty}>{t('ui.noPrompt')}</div>
          )}
          {promptData.map((p, i) => {
            const ts = p.timestamp ? new Date(p.timestamp).toLocaleString() : t('ui.unknownTime');
            return (
              <div key={i}>
                <div className={styles.promptTimestamp}>
                  {ts}:
                </div>
                {viewMode === 'original'
                  ? renderOriginalPrompt(p)
                  : renderTextPrompt(p)}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
