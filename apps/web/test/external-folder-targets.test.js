import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', path), 'utf8');
const memory = src('components/common/MemoryDetailModal.jsx');
const skills = src('components/settings/SkillsManagerModal.jsx');
const imSkills = src('components/settings/ImSkillsModal.jsx');
const desktop = src('components/dashboard/AppHeader.jsx');
const mobile = src('Mobile.jsx');
const browser = src('components/files/FileBrowserModal.jsx');
const viewer = src('components/files/FileContentView.jsx');

describe('CLAUDE.md and skill folder-entry wiring', () => {
  it('puts the CLAUDE.md folder icon before its title, never in memory-detail mode', () => {
    assert.match(memory, /linkMode === 'passthrough' && onOpenFolder && <OpenFolderIcon/);
    assert.match(memory, /title=\{t\('ui\.openFolder'\)\} size=\{16\} onClick=\{onOpenFolder\}/);
    assert.ok(memory.indexOf('<OpenFolderIcon') < memory.indexOf('memoryDetailTitleText'));
    for (const host of [desktop, mobile]) {
      assert.match(host, /onOpenFolder=\{this\.openClaudeMdFolder\}/);
      assert.match(host, /const base = \{ name: title, id \}/);
      assert.match(host, /kind: 'claude-md', id: detail\.id/);
      assert.match(host, /target=\{this\.state\._targetBrowser\.target\}/);
      assert.match(host, /rootLabel=\{this\.state\._targetBrowser\.label\}/);
      assert.match(host, /zIndex=\{1120\}/);
      assert.match(host, /_targetBrowser: null/);
    }
  });

  it('forwards the viewed project and instance to the new FileBrowserModal', () => {
    // The whole point of mounting FileBrowserModal from AppHeader/Mobile with a
    // target is that its /api/target-files calls stay scoped to the project the
    // user is looking at (not the bound project). If we ever drop the
    // project/instance props here, the modal silently reverts to the bound
    // project — the exact regression the file-browser view-scope fix introduced.
    // AppHeader reads from props (viewProject/viewedInstance), Mobile from state
    // (viewedProject/viewedInstance) — both naming conventions are in use.
    for (const host of [desktop, mobile]) {
      const mount = host.slice(host.indexOf('_targetBrowser && ('), host.indexOf('_targetBrowser && (') + 800);
      assert.match(mount, /project=\{this\.(props|state)\.(viewProject|viewedProject)\b/,
        'FileBrowserModal must receive the viewed project');
      assert.match(mount, /instance=\{this\.(props|state)\.viewedInstance\}/,
        'FileBrowserModal must receive the viewed instance');
    }
  });

  it('keeps mobile detail and skill loading in the viewed project scope', () => {
    const claudeList = mobile.slice(mobile.indexOf('loadClaudeMdList ='), mobile.indexOf('// 点击 chip'));
    const detail = mobile.slice(mobile.indexOf('loadClaudeMdDetail ='), mobile.indexOf('openClaudeMdFolder ='));
    const skillList = mobile.slice(mobile.indexOf('reloadFsSkills ='), mobile.indexOf('// 打开 skills'));
    for (const block of [claudeList, detail, skillList]) {
      assert.match(block, /project: this\.state\.viewedProject \|\| this\.state\.projectName/);
      assert.match(block, /instance: this\.state\.viewedInstance/);
    }
    assert.match(detail, /withViewParams\(`\/api\/claude-md\?id=/);
  });

  it('adds folder entries to user/project cards and plugin chips, not builtins', () => {
    const cards = skills.slice(skills.indexOf('<div className={styles.skillCardTitleRow}>'), skills.indexOf('<div className={styles.skillCardActions}>'));
    const plugins = skills.slice(skills.indexOf('pluginSkills.map'), skills.indexOf('{/* Builtin：'));
    const builtins = skills.slice(skills.indexOf('{/* Builtin：'));
    for (const block of [cards, plugins]) {
      assert.match(block, /s\.path && onOpenFolder && <OpenFolderIcon/);
      assert.match(block, /onClick=\{\(\) => onOpenFolder\(s\)\}/);
    assert.ok(cards.indexOf('<OpenFolderIcon') < cards.indexOf('{s.name}</div>'));
    assert.ok(plugins.indexOf('<OpenFolderIcon') < plugins.indexOf('{s.name}</span>'));
    }
    assert.doesNotMatch(builtins, /OpenFolderIcon/);
    assert.match(desktop, /onOpenFolder=\{this\.openSkillFolder\}/);
    assert.match(mobile, /onOpenFolder=\{this\.openSkillFolder\}/);
    assert.doesNotMatch(imSkills, /onOpenFolder/);
    for (const host of [desktop, mobile]) {
      assert.match(host, /kind: 'skill', source: skill\.source, path: skill\.path/);
    }
  });
});

describe('target-scoped file browser read-only boundaries', () => {
  it('uses a target listing endpoint and clears state on target/view changes', () => {
    assert.match(browser, /function targetFilesUrl\(target, path\)/);
    assert.match(browser, /params\.set\('targetPath', target\.path\)/);
    assert.match(browser, /params\.set\('id', target\.id\)/);
    assert.match(browser, /\/api\/target-files\?\$\{params\.toString\(\)\}/);
    assert.match(browser, /setCurrentPath\(targetPath\)/);
    assert.match(browser, /targetInfo\?\.rootKind === 'home' \? '~'/);
    assert.match(browser, /setExpandedPaths\(new Set\(ancestorsOf\(targetPath\)\)\)/);
    assert.match(browser, /dirRequests\.current\.get\(path\)/);
    assert.match(browser, /const entries = target \? data\.entries : data/);
    assert.match(browser, /targetPathRef\.current = data\.targetPath/);
    assert.match(browser, /const readOnly = isExternal/);
  });

  it('disables every mutation surface, including previews and drag events', () => {
    for (const token of [
      'disabled={readOnly}',
      'draggable={!readOnly}',
      'onDragStart={readOnly ? undefined : handleDragStartRow}',
      'onDragStart={readOnly ? undefined : handleDragStartCell}',
      'if (!readOnly) importFiles(',
      'if (!readOnly) moveFile(',
      'if (readOnly) return;',
      '{!readOnly && <>',
      'readOnly={readOnly}',
    ]) assert.ok(browser.includes(token), `missing read-only guard ${token}`);
    assert.match(viewer, /readOnly = false/);
    assert.match(viewer, /!mdxParseErrored && !readOnly/);
    assert.match(viewer, /if \(readOnly \|\| !isDirty\) return/);
    assert.match(viewer, /readOnly=\{readOnly\}/);
    assert.match(viewer, /editable=\{!readOnly\}/);
    assert.match(viewer, /\{!readOnly && <button/);
    assert.match(viewer, /if \(readOnly\) return;\n    setCurrentContent/);
  });

  it('uses authorized absolute paths for previews and direct download, not OS open', () => {
    assert.match(browser, /const itemPath = item\.absPath \|\| childPath;\n    const ext = \(item\.name \|\| ''\)\.split\('\.'\)\.pop\(\)\.toLowerCase\(\);\n    if \(ext === 'html'/);
    assert.match(browser, /setHtmlPreviewPath\(itemPath\)/);
    assert.match(browser, /isSystemOpenFile\(item\.name\)\) downloadFile\(itemPath/);
    assert.match(browser, /else setPreviewFile\(itemPath\)/);
    assert.match(browser, /encodeURIComponent\(item\.absPath \|\| childPath\)/);
    assert.match(browser, /FileContentView filePath=\{previewFile\}.*readOnly=\{readOnly\}/);
    assert.match(browser, /zIndex=\{zIndex \+ 20\}/);
    assert.match(browser, /styles\.treePaneMobile/);
  });
});
