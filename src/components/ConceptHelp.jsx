import React, { useState, useCallback } from 'react';
import { Modal, Spin } from 'antd';
import { renderMarkdown } from '../utils/markdown';
import { getLang } from '../i18n';
import styles from './ConceptHelp.module.css';

const KNOWN_DOCS = new Set([
  'Tool-Bash', 'Tool-Read', 'Tool-Edit', 'Tool-Write', 'Tool-Glob', 'Tool-Grep',
  'Tool-NotebookEdit', 'Tool-WebFetch', 'Tool-WebSearch',
  'Tool-Task', 'Tool-Agent', 'Tool-TaskOutput', 'Tool-TaskStop',
  'Tool-TaskCreate', 'Tool-TaskGet', 'Tool-TaskUpdate', 'Tool-TaskList',
  'Tool-EnterPlanMode', 'Tool-ExitPlanMode',
  'Tool-AskUserQuestion', 'Tool-Skill',
  'Tool-getDiagnostics', 'Tool-executeCode',
  'MainAgent', 'Tools', 'CacheRebuild', 'BodyDiffJSON', 'TranslateContextPollution',
]);

export default function ConceptHelp({ doc }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState('');
  const [title, setTitle] = useState('');

  if (!doc || !KNOWN_DOCS.has(doc)) return null;

  const loadDoc = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    setHtml('');
    setTitle(doc);

    const lang = getLang();
    let md = null;

    try {
      const res = await fetch(`/api/concept?lang=${lang}&doc=${encodeURIComponent(doc)}`);
      if (res.ok) {
        md = await res.text();
      }
    } catch (_) {
      // ignore
    }

    if (md) {
      const firstLine = md.match(/^#\s+(.+)/m);
      if (firstLine) setTitle(firstLine[1]);
      setHtml(renderMarkdown(md));
    } else {
      setHtml('<p>Document not found.</p>');
    }
    setLoading(false);
  }, [doc]);

  return (
    <>
      <span className={styles.helpBtn} onClick={(e) => { e.stopPropagation(); loadDoc(); }}>?</span>
      <Modal
        title={title}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={640}
        styles={{
          header: { background: 'var(--bg-elevated)' },
          body: { background: 'var(--bg-card)', padding: '16px 24px 24px' },
          content: { background: 'var(--bg-elevated)', padding: '12px 20px' },
        }}
      >
        {loading ? (
          <div className={styles.spinWrap}><Spin /></div>
        ) : (
          <div className={styles.modalBody} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </Modal>
    </>
  );
}
