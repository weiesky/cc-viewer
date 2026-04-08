import React, { useState, useCallback } from 'react';
import { Modal, Spin } from 'antd';
import { renderMarkdown } from '../utils/markdown';
import { apiUrl } from '../utils/apiUrl';
import { getLang } from '../i18n';
import { isMobile } from '../env';
import styles from './ConceptHelp.module.css';

const KNOWN_DOCS = new Set([
  'Tool-Bash', 'Tool-Read', 'Tool-Edit', 'Tool-Write', 'Tool-Glob', 'Tool-Grep',
  'Tool-NotebookEdit', 'Tool-WebFetch', 'Tool-WebSearch',
  'Tool-Task', 'Tool-Agent', 'Tool-TaskOutput', 'Tool-TaskStop',
  'Tool-TaskCreate', 'Tool-TaskGet', 'Tool-TaskUpdate', 'Tool-TaskList',
  'Tool-TeamCreate', 'Tool-TeamDelete', 'Tool-SendMessage',
  'SubAgent-Search',
  'Tool-EnterPlanMode', 'Tool-ExitPlanMode',
  'Tool-AskUserQuestion', 'Tool-Skill',
  'Tool-getDiagnostics', 'Tool-executeCode', 'Tool-EnterWorktree',
  'MainAgent', 'Teammate', 'BodyFields', 'ResponseFields', 'Tools', 'ToolsFirst', 'CacheRebuild', 'BodyDiffJSON', 'TranslateContextPollution', 'KVCacheContent', 'ProxySwitch', 'GlobalSettings',
]);

export default function ConceptHelp({ doc, zIndex }) {
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
      const res = await fetch(apiUrl(`/api/concept?lang=${lang}&doc=${encodeURIComponent(doc)}`));
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

  const modalStyles = isMobile ? {
    header: { padding: '8px 12px', margin: 0 },
    body: { maxHeight: '80vh', overflow: 'auto', padding: '8px 10px' },
    content: { padding: 0 },
  } : {
    body: { padding: '16px 24px 24px', background: 'var(--bg-container)', borderRadius: '4px' },
    content: { padding: '12px 20px' },
  };

  return (
    <>
      <span className={styles.helpBtn}
        onClick={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); loadDoc(); }}
        onMouseDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
      >?</span>
        <Modal
          title={title}
          open={open}
          onCancel={() => setOpen(false)}
          footer={null}
          width={isMobile ? '98vw' : 800}
          centered={isMobile}
          styles={modalStyles}
          {...(zIndex ? { zIndex } : {})}
          wrapProps={{ onMouseDown: (e) => e.stopPropagation() }}
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
