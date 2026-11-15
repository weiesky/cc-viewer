import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FILE_DRAG_TYPE, FOLDER_DRAG_TYPE, isFileDrag, getDraggedFilePath, getDraggedEntry, formatFolderPath, planFileDropInput, quotePathForTerminal } from '../src/utils/fileDragDrop.js';
import { toWorkspacePath } from '../src/utils/gitWorkspacePath.js';

function drag(types, path = '') {
  return { dataTransfer: { types, getData: (type) => type === 'text/plain' ? path : '' } };
}

describe('file browser drag payload', () => {
  it('accepts only marked internal files', () => {
    assert.equal(isFileDrag(drag(['text/x-internal-move', FILE_DRAG_TYPE])), true);
    assert.equal(isFileDrag(drag(['text/x-internal-move'])), false);
    assert.equal(isFileDrag(drag(['text/plain'])), false);
    assert.equal(isFileDrag(drag(['Files'])), false);
    assert.equal(isFileDrag(null), false);
  });

  it('returns paths only for valid file drags', () => {
    assert.equal(getDraggedFilePath(drag(['text/x-internal-move', FILE_DRAG_TYPE], 'src/a b.txt')), 'src/a b.txt');
    assert.equal(getDraggedFilePath(drag(['text/x-internal-move'], 'src')), null);
    assert.equal(getDraggedFilePath(drag(['text/x-internal-move', FILE_DRAG_TYPE], 'src/a\nb')), null);
    assert.equal(getDraggedFilePath(drag(['text/x-internal-move', FILE_DRAG_TYPE], '')), null);
  });
  it('accepts marked directories and preserves their type', () => {
    assert.equal(isFileDrag(drag(['text/x-internal-move', FOLDER_DRAG_TYPE])), true);
    assert.deepEqual(getDraggedEntry(drag(['text/x-internal-move', FOLDER_DRAG_TYPE], 'src/assets')), { path: 'src/assets', isDir: true });
    assert.equal(getDraggedEntry(drag(['text/x-internal-move', FOLDER_DRAG_TYPE], 'a\0b')), null);
    assert.deepEqual(getDraggedEntry(drag(['text/x-internal-move', FILE_DRAG_TYPE], 'src/a.txt')), { path: 'src/a.txt', isDir: false });
  });

  it('shortens only intermediate folder path segments', () => {
    assert.equal(formatFolderPath('src'), 'src');
    assert.equal(formatFolderPath('src/assets'), 'src/assets');
    assert.equal(formatFolderPath('src/components/chat'), 'src/…/chat');
    assert.equal(formatFolderPath('/Users/sky/project/assets/'), '/Users/…/assets');
    assert.equal(formatFolderPath('C:\\Users\\sky\\assets'), 'C:/…/assets');
    assert.equal(formatFolderPath('/'), '/');
    assert.equal(formatFolderPath('C:\\'), 'C:');
    assert.equal(formatFolderPath('//server/share/dir'), '/server/…/dir');
  });

  it('rejects unsafe folder labels', () => {
    assert.equal(formatFolderPath('a\nb'), '');
    assert.equal(formatFolderPath(''), '');
  });
});

describe('file drop terminal input', () => {
  it('quotes spaces, Unicode and single quotes without submitting', () => {
    assert.equal(planFileDropInput('src/a b.txt'), "'src/a b.txt' ");
    assert.equal(planFileDropInput("src/你's.txt"), "'src/你'\\''s.txt' ");
    assert.equal(quotePathForTerminal('a$b`c`'), "'a$b`c`'");
    const data = planFileDropInput('src/a b.txt', { bracketedPasteMode: true });
    assert.equal(data, "\x1b[200~'src/a b.txt' \x1b[201~");
    assert.ok(!data.includes('\r') && !data.includes('\n'));
  });

  it('uses the shell-specific quoting for scratch terminals', () => {
    assert.equal(quotePathForTerminal('a b.txt', 'cmd.exe'), '"a b.txt"');
    assert.equal(quotePathForTerminal('a&b.txt', 'cmd'), '"a&b.txt"');
    assert.equal(quotePathForTerminal('%PATH%', 'cmd'), '');
    assert.equal(planFileDropInput('a"b', { shell: 'cmd.exe' }), null);
    assert.equal(quotePathForTerminal("it's.txt", 'pwsh'), "'it''s.txt'");
    assert.equal(quotePathForTerminal("a\\'b", 'fish'), "'a\\\\\\'b'");
    assert.equal(quotePathForTerminal('a\rb'), '');
  });

  it('rejects control bytes, including bracket-paste injection', () => {
    assert.equal(planFileDropInput('a\rb'), null);
    assert.equal(planFileDropInput('a\x1bb'), null);
    assert.equal(planFileDropInput("a\u0085b"), null);
    assert.equal(planFileDropInput(null), null);
    assert.equal(planFileDropInput('a\x1b[201~\rb', { bracketedPasteMode: true }), null);
  });
});

describe('file browser drop wiring', () => {
  const read = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');

  it('marks files and folders while preserving directory move sources', () => {
    const source = read('components/files/FileExplorer.jsx');
    assert.ok(source.includes("e.dataTransfer.setData(isDir ? FOLDER_DRAG_TYPE : FILE_DRAG_TYPE, '1')"));
    assert.ok(source.includes("e.dataTransfer.effectAllowed = 'copyMove'"));
    assert.ok(source.includes("e.dataTransfer.setData('text/x-internal-move', '1')"));
    assert.equal(source.split("e.dataTransfer.dropEffect !== 'move'").length - 1, 2);
  });

  it('exposes git change files, folders and commits as drag sources', () => {
    const source = read('components/git/GitChanges.jsx');
    assert.ok(source.includes("import { FILE_DRAG_TYPE, FOLDER_DRAG_TYPE } from '../../utils/fileDragDrop'"));
    assert.ok(source.includes("import { toWorkspacePath } from '../../utils/gitWorkspacePath'"));
    // Same payload contract as FileExplorer; effectAllowed must stay 'copyMove' so the
    // chat/terminal drop targets (dropEffect 'copy') accept the drag.
    assert.ok(source.includes("e.dataTransfer.setData('text/plain', path)"));
    assert.ok(source.includes("e.dataTransfer.setData('text/x-internal-move', '1')"));
    assert.ok(source.includes("e.dataTransfer.setData(isDir ? FOLDER_DRAG_TYPE : FILE_DRAG_TYPE, '1')"));
    assert.ok(source.includes("e.dataTransfer.effectAllowed = 'copyMove'"));
    // Empty payload (e.g. a missing commit hash) must not be written as the path.
    assert.ok(source.includes('if (!path) return;'));
    // Directory rows always drag; renames split into pseudo-dirs are refused at dragstart.
    assert.ok(source.includes("if (dirPath.includes(' -> ')) { e.preventDefault(); return; }"));
    assert.ok(source.includes('onDragStart={handleDirDragStart}'));
    // File rows skip renames/copies; the XY status can be a pair (e.g. 'RM'), so the
    // guard rejects any status containing R or C.
    assert.ok(source.includes('const fileRowDraggable = isFileRowDraggable(file.status);'));
    assert.ok(source.includes("!status.includes('R') && !status.includes('C')"));
    assert.ok(source.includes('draggable={fileRowDraggable}'));
    assert.ok(source.includes('onDragStart={fileRowDraggable ? (e) => handleFileDragStart(e, file.fullPath) : undefined}'));
    // Every drag source is actually enabled (the `draggable` attribute is the master switch).
    assert.equal(source.split('draggable').length - 1 >= 3, true);
    // Both row types reset drag feedback on dragend.
    assert.ok(source.includes('onDragEnd={handleDragEnd}'));
    assert.ok(source.includes('onDragEnd={fileRowDraggable ? handleDragEnd : undefined}'));
    // Full payload call sites lock the path source (fullPath, not basename) and isDir arg.
    assert.ok(source.includes('writeFileDragPayload(e, toWorkspacePath(repoPath, dirPath), true)'));
    assert.ok(source.includes('writeFileDragPayload(e, toWorkspacePath(repoPath, fullPath), false)'));
    // Dragging a commit row itself passes the commit id (hash) and is wired to the DOM.
    assert.ok(source.includes('writeFileDragPayload(e, commit.hash, false)'));
    assert.ok(source.includes('onDragStart={handleCommitDragStart}'));
    assert.ok(source.includes('onDragEnd={handleCommitDragEnd}'));
    // File rows expose keyboard / no-drag affordances mirroring FileExplorer's menu.
    assert.ok(source.includes("{ key: 'attachToChat', label: t('ui.contextMenu.attachToChat') }"));
    assert.ok(source.includes("{ key: 'insertPathToChat', label: t('ui.contextMenu.insertPathToChat') }"));
    assert.ok(source.includes('onAttachToChat && onAttachToChat(resolvedPath)'));
    assert.ok(source.includes('onInsertPathToChat && onInsertPathToChat(resolvedPath)'));
    assert.ok(source.includes('styles.changeItemDragging'));
    assert.ok(source.includes('styles.dirItemDragging'));
  });

  it('attaches a local fake upload without using the real upload callback', () => {
    const input = read('components/chat/ChatInputBar.jsx');
    const view = read('components/chat/ChatView.jsx');
    assert.ok(input.includes('onDragOver={handleFileDragOver}'));
    assert.ok(input.includes('onDrop={handleFileDrop}'));
    const drop = input.slice(input.indexOf('const handleFileDrop'), input.indexOf('// 统一上传'));
    assert.ok(drop.includes('onAttachPath?.(entry.path, entry.isDir)'));
    assert.ok(!drop.includes('onUploadPath') && !drop.includes('runUpload'));
    assert.ok(view.includes("onAttachPath={(path, isDir) => this._addPendingImage(path, 'explorer', isDir)}"));
    assert.ok(view.includes('_addPendingImage = (path, source, isDir = false)'));
    assert.ok(view.includes('{ path, source, isDir }'));
    assert.ok(view.includes("const imagePaths = this.state.pendingImages.map(img => `\"${img.path.replace(/\"/g, '')}\"`).join(' ');"));
  });

  it('renders folder chips in both composer and terminal attachment strips', () => {
    const input = read('components/chat/ChatInputBar.jsx');
    const panel = read('components/terminal/TerminalPanel.jsx');
    assert.ok(input.includes("import { isFileDrag, getDraggedEntry, formatFolderPath }"));
    assert.ok(input.includes("import { getFileIcon } from '../../utils/fileIcons'"));
    assert.ok(panel.includes("import { getFileIcon } from '../../utils/fileIcons'"));
    assert.ok(panel.includes('formatFolderPath }'));
    for (const source of [input, panel]) {
      assert.ok(source.includes("getFileIcon(fileName, 'directory')"));
      assert.ok(source.includes('img.isDir ? formatFolderPath(img.path) : fileName'));
      assert.ok(source.includes('const isImage = !img.isDir &&'));
    }
  });

  it('scopes image previews to the viewed workspace', () => {
    assert.ok(read('components/chat/ChatInputBar.jsx').includes('withViewParams(`/api/file-raw?path=${encodeURIComponent(img.path)}`, { project: viewProject })'));
    assert.ok(read('components/terminal/TerminalPanel.jsx').includes('withViewParams(`/api/file-raw?path=${encodeURIComponent(img.path)}`, { project: this.props.viewProject, instance: this.props.viewInstance })'));
  });

  it('sends anchored terminal input without Enter and resets drag feedback', () => {
    const panel = read('components/terminal/TerminalPanel.jsx');
    const app = read('AppBase.jsx');
    assert.ok(panel.includes("type: 'input', data,"));
    assert.ok(panel.includes('project: this.props.viewProject || null'));
    assert.ok(panel.includes('planFileDropInput(getDraggedFilePath(e)'));
    assert.ok(panel.includes("document.addEventListener('dragend', this._resetFileDragOver)"));
    assert.ok(panel.includes("document.removeEventListener('dragend', this._resetFileDragOver)"));
    const globalDragOver = app.slice(app.indexOf('_onDragOver = (e) => {'), app.indexOf('_onDragLeave = (e) => {'));
    const internalIdx = globalDragOver.indexOf('text/x-internal-move');
    const preventIdx = globalDragOver.indexOf('e.preventDefault();');
    assert.ok(internalIdx >= 0 && preventIdx >= 0 && internalIdx < preventIdx);
  });

  it('supports SDK/scratch terminals with the same safe input path', () => {
    const scratch = read('components/terminal/ScratchTerminal.jsx');
    assert.ok(scratch.includes("from '../../utils/fileDragDrop'"));
    assert.ok(scratch.includes('onDrop={this._handleFileDrop}'));
    assert.ok(scratch.includes('planFileDropInput(getDraggedFilePath(e)'));
    assert.ok(scratch.includes('shell: this.state.shellBasename'));
    assert.ok(scratch.includes("document.addEventListener('dragend', this._resetFileDragOver)"));
    assert.ok(scratch.includes("document.removeEventListener('dragend', this._resetFileDragOver)"));
  });
});

describe('git workspace path mapping', () => {
  it('maps repo-relative paths to workspace-root-relative paths', () => {
    assert.equal(toWorkspacePath('.', 'src/a.js'), 'src/a.js');
    assert.equal(toWorkspacePath('sub', 'src/a.js'), 'sub/src/a.js');
    assert.equal(toWorkspacePath('sub', 'src'), 'sub/src');
    assert.equal(toWorkspacePath('', 'src/a.js'), 'src/a.js');
    assert.equal(toWorkspacePath(null, 'src/a.js'), 'src/a.js');
    assert.equal(toWorkspacePath(undefined, 'src/a.js'), 'src/a.js');
  });
});
