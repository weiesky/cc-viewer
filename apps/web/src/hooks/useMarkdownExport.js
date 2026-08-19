import { useRef, useCallback } from 'react';
import { message } from 'antd';
import { apiUrl } from '../utils/apiUrl';
import { t } from '../i18n';

// 共享 markdown 导出动作：4 个 handler（save-as .md / copy / save-as image / save-to-project）
// 调用者通过 getter 函数传参（每次触发时读最新值，避免闭包陈旧）：
//   getText()           — 需要导出的 markdown 源文本
//   getSnapshotTarget() — save-as-image 的 DOM 快照目标，返回 Element
//   onDone?()           — 每次 handler 完成后调用（通常用于关闭下拉菜单）
export function useMarkdownExport({ getText, getSnapshotTarget, onDone }) {
  const savingRef = useRef(false);

  const handleCopy = useCallback((e) => {
    e?.stopPropagation();
    const text = getText();
    if (text == null) return;
    navigator.clipboard.writeText(text)
      .then(() => message.success(t('ui.copySuccess')))
      .catch(() => {});
    onDone?.();
  }, [getText, onDone]);

  const handleSaveAs = useCallback(async (e) => {
    e?.stopPropagation();
    onDone?.();
    const text = getText();
    if (text == null) return;
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const defaultName = `content-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.md`;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [getText, onDone]);

  const handleSaveAsImage = useCallback((e) => {
    e?.stopPropagation();
    onDone?.();
    if (savingRef.current) return;
    const target = getSnapshotTarget?.();
    if (!target) return;
    savingRef.current = true;

    // 目标元素可能是 overflow-y:auto 的滚动容器（FileContentView 的 .markdownPreview
    // 就是典型场景），html2canvas 读 DOM 时会受 CSS overflow/height 裁剪，只抓得到
    // 视口范围内的内容。这里临时把 height 撑到 scrollHeight、overflow 解到 visible，
    // 截图完再恢复；scrollTop 先归零保证从头开始，restore 时再写回。
    // 扩张→截→恢复整条路径都同步；html2canvas 内部虽然是 Promise，但读 DOM 是一次
    // 性 snapshot（Promise 之前完成），所以等它 resolve/reject 再还原即可。
    const prev = {
      height: target.style.height,
      maxHeight: target.style.maxHeight,
      overflow: target.style.overflow,
      overflowY: target.style.overflowY,
      scrollTop: target.scrollTop,
    };
    const needsExpand = target.scrollHeight > target.clientHeight;
    if (needsExpand) {
      target.scrollTop = 0;
      target.style.height = target.scrollHeight + 'px';
      target.style.maxHeight = 'none';
      target.style.overflow = 'visible';
      target.style.overflowY = 'visible';
    }
    const restore = () => {
      if (needsExpand) {
        target.style.height = prev.height;
        target.style.maxHeight = prev.maxHeight;
        target.style.overflow = prev.overflow;
        target.style.overflowY = prev.overflowY;
        target.scrollTop = prev.scrollTop;
      }
    };

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    import('html2canvas').then(({ default: html2canvas }) => {
      html2canvas(target, {
        backgroundColor: isDark ? '#0a0a0a' : '#ffffff',
        scale: 2,
        useCORS: true,
      }).then(canvas => {
        restore();
        canvas.toBlob(blob => {
          if (!blob) { savingRef.current = false; return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `content-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          canvas.width = 0;
          canvas.height = 0;
          savingRef.current = false;
        }, 'image/png');
      }).catch((err) => { restore(); console.warn('html2canvas render failed:', err); savingRef.current = false; });
    }).catch((err) => { restore(); console.warn('html2canvas load failed:', err); savingRef.current = false; });
  }, [getSnapshotTarget, onDone]);

  const handleSaveToProject = useCallback(async (e) => {
    e?.stopPropagation();
    onDone?.();
    const text = getText();
    if (text == null) return;
    const defaultName = `content-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.md`;
    const fileName = window.prompt(t('ui.saveToProject.prompt'), defaultName);
    if (!fileName) return;
    try {
      const res = await fetch(apiUrl('/api/file-content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fileName, content: text }),
      });
      if (res.ok) {
        message.success(t('ui.saveToProject.success', { name: fileName }));
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.error || t('ui.saveFailed'));
      }
    } catch (err) {
      message.error(err.message || t('ui.saveFailed'));
    }
  }, [getText, onDone]);

  return { handleCopy, handleSaveAs, handleSaveAsImage, handleSaveToProject };
}
