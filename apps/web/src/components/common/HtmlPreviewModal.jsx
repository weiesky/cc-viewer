import React from 'react';
import { Modal } from 'antd';
import { apiUrl } from '../../utils/apiUrl';

/**
 * Shared HTML file preview modal (sandboxed iframe over /api/file-raw).
 * Extracted from FileExplorer so both the sidebar tree and the file-browser
 * modal reuse the same security-relevant iframe wiring.
 */
export default function HtmlPreviewModal({ path, onClose, zIndex = 1100 }) {
  if (!path) return null;
  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      closable
      maskClosable
      zIndex={zIndex}
      width="calc(100vw - 80px)"
      title={<span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{path.split('/').pop() || 'Preview'}</span>}
      styles={{
        header: { background: 'var(--bg-container)', borderBottom: '1px solid var(--border-primary)', padding: '12px 20px' },
        body: { background: '#fff', height: 'calc(100vh - 160px)', overflow: 'hidden', padding: 0 },
        mask: { background: 'rgba(0,0,0,0.7)' },
        content: { background: 'var(--bg-container)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 0 },
      }}
      centered
    >
      <iframe
        // Path-style URL (not ?path=...): relative `<script src="sorter.js">` in
        // the HTML then resolves to `/api/file-raw/<dir>/sorter.js` (same dir),
        // which c8/nyc-style coverage reports depend on. Each path segment is
        // encoded individually so the separating slashes survive.
        src={apiUrl('/api/file-raw/' + path.split('/').map(encodeURIComponent).join('/'))}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title={path}
        // Only allow-scripts, in sync with the server CSP (intersection applies).
        // No popup / form: c8/nyc reports are purely static interactions
        // (sortable / folding / inline location.hash jumps) and need neither.
        sandbox="allow-scripts"
      />
    </Modal>
  );
}
