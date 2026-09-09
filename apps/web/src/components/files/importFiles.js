import { Modal, message } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';

// Shared external-file import pipeline, used by both the sidebar FileExplorer
// and the remote FileBrowserModal. Verbatim move from FileExplorer.jsx — keep
// behavior in sync between the two surfaces by editing here only.

export function isExternalFileDrag(e) {
  return e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/x-internal-move');
}

// Extract top-level FileSystemEntry objects during the drop handler's sync phase — items go stale afterwards.
export function getTopLevelEntries(items) {
  if (!items || !items.length) return null;
  const first = items[0];
  if (typeof first.webkitGetAsEntry !== 'function') return null;
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind !== 'file') continue;
    const entry = items[i].webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  return entries.length ? entries : null;
}

// Read a DirectoryReader in batches until an empty array (Chrome caps each call at 100 entries — looping is mandatory).
function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const acc = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) resolve(acc);
          else { acc.push(...batch); readBatch(); }
        },
        reject
      );
    };
    readBatch();
  });
}

const SKIP_ENTRY_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.localized']);

// Recursively expand an entry tree into {file, relPath} records; depth cap 32 guards against symlink loops.
export async function expandEntries(entries, depth) {
  if (depth > 32) return [];
  const results = [];
  for (const entry of entries) {
    if (!entry || SKIP_ENTRY_NAMES.has(entry.name)) continue;
    if (entry.isFile) {
      try {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        const rel = entry.fullPath ? (entry.fullPath.startsWith('/') ? entry.fullPath.slice(1) : entry.fullPath) : file.name;
        results.push({ file, relPath: rel });
      } catch (e) {
        console.warn('[importFiles] skip unreadable file', entry.name, e && e.message);
      }
    } else if (entry.isDirectory) {
      try {
        const reader = entry.createReader();
        const children = await readAllEntries(reader);
        const sub = await expandEntries(children, depth + 1);
        results.push(...sub);
      } catch (e) {
        console.warn('[importFiles] skip unreadable dir', entry.name, e && e.message);
      }
    }
  }
  return results;
}

// Import external files (batch folder drops keep their directory structure).
// payload: { topEntries, flatFiles } (synchronously extracted in the drop handler) or a plain File[] (fallback).
// onFileRenamed is injected by the caller: FileExplorer passes its own prop (ChatView refresh chain),
// FileBrowserModal passes handleAfterMutation (refreshes modal + sidebar together).
export async function importFiles(payload, targetDir, { onFileRenamed } = {}) {
  // 1. Normalize to {file, relPath}[]
  let entries = [];
  const topEntries = payload && payload.topEntries;
  const flatFiles = payload && payload.flatFiles;
  const isEntryShape = Array.isArray(topEntries) || Array.isArray(flatFiles);
  if (isEntryShape && topEntries && topEntries.length > 0) {
    // FileSystemEntry present: scanning can take a while — show a loading toast
    const hideScan = message.loading(t('ui.importScanning'), 0);
    let scanFailed = false;
    try {
      entries = await expandEntries(topEntries, 0);
    } catch (e) {
      console.warn('[importFiles] expandEntries failed, falling back to flat files', e);
      scanFailed = true;
    } finally {
      hideScan();
    }
    // On scan failure (or an empty scan), fall back to the browser-flattened flatFiles (top-level files at least import)
    if ((scanFailed || entries.length === 0) && flatFiles && flatFiles.length > 0) {
      entries = flatFiles.map(f => ({ file: f, relPath: f.name }));
    }
  } else if (isEntryShape && flatFiles && flatFiles.length > 0) {
    // Browser without webkitGetAsEntry → flat fallback
    entries = flatFiles.map(f => ({ file: f, relPath: f.name }));
  } else if (Array.isArray(payload)) {
    // Plain File[] payload (kept for compatibility)
    entries = payload.map(f => ({ file: f, relPath: f.name }));
  }
  if (entries.length === 0) {
    // Dropped but nothing importable (empty folder / only filtered OS files)
    if ((topEntries && topEntries.length > 0) || (flatFiles && flatFiles.length > 0)) {
      message.info(t('ui.importNoFiles'));
    }
    return;
  }

  // 2. Large-batch warning
  if (entries.length > 1000) {
    const proceed = await new Promise(resolve => {
      Modal.confirm({
        title: t('ui.importConfirmLarge', { count: entries.length }),
        okText: t('ui.ok'),
        cancelText: t('ui.cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!proceed) return;
  }

  // 3. Concurrent uploads (limit 3) with a persistent loading toast (total is known)
  const total = entries.length;
  let successCount = 0;
  const failures = [];
  let firstOkRelPath = null;
  const hideLoading = message.loading(t('ui.importingProgress', { total }), 0);

  let idx = 0;
  const worker = async () => {
    while (idx < entries.length) {
      const myIdx = idx++;
      const { file, relPath } = entries[myIdx];
      const lastSlash = relPath.lastIndexOf('/');
      const subDir = lastSlash >= 0 ? relPath.slice(0, lastSlash) : '';
      const finalDir = [targetDir, subDir].filter(Boolean).join('/');
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(apiUrl(`/api/import-file?dir=${encodeURIComponent(finalDir)}`), { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) {
          failures.push({ name: relPath, error: data.error || 'Import failed' });
        } else {
          successCount++;
          if (!firstOkRelPath) firstOkRelPath = data.relPath || relPath;
        }
      } catch (err) {
        failures.push({ name: relPath, error: err.message || 'Import failed' });
      }
    }
  };
  const parallel = Math.min(3, entries.length);
  await Promise.all(Array.from({ length: parallel }, () => worker()));
  hideLoading();

  // 4. Summary toasts
  if (failures.length === 0) {
    if (successCount === 1) {
      message.success(t('ui.fileImported', { name: firstOkRelPath }));
    } else {
      message.success(t('ui.filesImported', { count: successCount }));
    }
  } else {
    const preview = failures.slice(0, 3).map(f => f.name).join(', ');
    const more = failures.length > 3 ? ` (+${failures.length - 3})` : '';
    if (successCount > 0) {
      message.warning(t('ui.importPartialFailed', { ok: successCount, failed: failures.length, names: preview + more }));
    } else {
      message.error(t('ui.importAllFailed', { failed: failures.length, names: preview + more }));
    }
  }

  if (successCount > 0 && onFileRenamed) {
    onFileRenamed(null, firstOkRelPath);
  }
}
