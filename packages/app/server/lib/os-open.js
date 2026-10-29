// Shared OS-integration helpers (open in file manager / terminal) used by both
// the project-scoped routes (files-fs.js) and the target-mode write routes
// (target-files-fs.js). Centralizing the platform branches keeps the two call
// surfaces from drifting apart (a Windows quoting or Linux terminal-fallback fix
// must apply to both). Pure argv spawning — no shell — so no metachar injection.
//
// L1 (lib): must NOT import from routes/ (verify:boundaries).
import { execFile, spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { reportSwallowed } from './error-report.js';

// Reveal a file (select it) or open a directory in the OS file manager.
// - macOS: `open -R <path>` selects files AND opens directories in place.
// - Windows: `explorer /select,"<path>"` (verbatim args; a dir path opens it).
// - Linux: no select concept — open the path itself when it is a directory,
//   otherwise its parent. (xdg-open on a FILE would launch the default app, so
//   callers pass `isDir` to pick the directory to show.)
export function revealInOs(fullPath, { isDir = false } = {}) {
  const plat = process.platform;
  if (plat === 'darwin') {
    execFile('open', ['-R', fullPath], () => {});
  } else if (plat === 'win32') {
    // windowsVerbatimArguments: Node would otherwise re-quote the spaced path into
    // a form explorer cannot parse. No cmd.exe is involved, so no metachar risk;
    // Windows filenames cannot contain `"`.
    const child = spawn('explorer.exe', [`/select,"${fullPath}"`], { windowsVerbatimArguments: true, windowsHide: true });
    child.on('error', (err) => { reportSwallowed('osOpen.reveal', err); });
  } else {
    execFile('xdg-open', [isDir ? fullPath : dirname(fullPath)], () => {});
  }
}

// Open an OS terminal with cwd = dir. Linux probes common emulators with piped
// stdio so the next candidate is tried after ENOENT, falling back to xdg-open.
export function openTerminalAt(dir) {
  const plat = process.platform;
  if (plat === 'darwin') {
    const child = spawn('open', ['-a', 'Terminal', dir], { stdio: 'ignore', detached: true });
    child.on('error', (err) => { reportSwallowed('osOpen.terminal', err, { terminal: 'Terminal.app' }); });
    child.unref();
  } else if (plat === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd: dir, stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', (err) => { reportSwallowed('osOpen.terminal', err, { terminal: 'cmd.exe' }); });
    child.unref();
  } else {
    const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
    const tryTerminal = (index) => {
      if (index >= terminals.length) {
        const child = spawn('xdg-open', [dir], { stdio: 'ignore', detached: true });
        child.on('error', (err) => { reportSwallowed('osOpen.terminal', err, { terminal: 'xdg-open' }); });
        child.unref();
        return;
      }
      const term = terminals[index];
      let child;
      try {
        if (term === 'gnome-terminal') child = spawn(term, ['--working-directory=' + dir], { stdio: 'pipe' });
        else if (term === 'konsole') child = spawn(term, ['--workdir', dir], { stdio: 'pipe' });
        else child = spawn(term, [], { cwd: dir, stdio: 'pipe' });
      } catch { tryTerminal(index + 1); return; }
      child.once('error', (err) => { reportSwallowed('osOpen.terminal', err, { terminal: term }); tryTerminal(index + 1); });
      child.once('spawn', () => { for (const s of [child.stdin, child.stdout, child.stderr]) s?.destroy(); child.unref(); });
    };
    tryTerminal(0);
  }
}
