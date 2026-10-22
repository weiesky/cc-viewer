import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { PLUGIN_NAME_RE } from './plugin-manifest.js';

/**
 * Upload plugin files from a file list.
 * @param {string} pluginsDir - path to plugins directory
 * @param {Array<{name: string, content: string}>} fileList - files to upload
 * @returns {number} number of files written
 * @throws {Error} on validation failure
 */
export function uploadPlugins(pluginsDir, fileList) {
  if (!Array.isArray(fileList) || fileList.length === 0) {
    throw Object.assign(new Error('No files provided'), { statusCode: 400 });
  }
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }
  let written = 0;
  for (const { name, content } of fileList) {
    if (!name || typeof content !== 'string') continue;
    const filename = name.replace(/.*[/\\]/, '');
    if (!filename.endsWith('.js') && !filename.endsWith('.mjs')) {
      throw Object.assign(new Error('Only .js or .mjs files are allowed'), { statusCode: 400 });
    }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw Object.assign(new Error('Invalid file name'), { statusCode: 400 });
    }
    writeFileSync(join(pluginsDir, filename), content, 'utf-8');
    written++;
  }
  return written;
}

/**
 * Install a plugin by downloading from a URL.
 * @param {string} pluginsDir - path to plugins directory
 * @param {string} fileUrl - URL to download from
 * @param {string} extractNameScript - path to server/lib/extract-plugin-name.mjs
 * @returns {Promise<{filename: string}>} the saved filename
 * @throws {Error} on validation or download failure
 */
export async function installPluginFromUrl(pluginsDir, fileUrl, extractNameScript) {
  if (!fileUrl) {
    throw Object.assign(new Error('URL is required'), { statusCode: 400 });
  }
  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(fileUrl);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { statusCode: 400 });
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw Object.assign(new Error('Invalid URL'), { statusCode: 400 });
  }

  // Download remote file (5MB limit, 30s timeout)
  const MAX_PLUGIN_SIZE = 5 * 1024 * 1024;
  let content;
  try {
    const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (text.length > MAX_PLUGIN_SIZE) throw new Error('File too large (max 5MB)');
    content = text;
  } catch (fetchErr) {
    throw Object.assign(new Error('Failed to fetch: ' + fetchErr.message), { statusCode: 500 });
  }

  // Extract plugin name via subprocess import()
  let saveName = '';
  const tmpFile = join(tmpdir(), `ccv-install-${Date.now()}.mjs`);
  writeFileSync(tmpFile, content, 'utf-8');
  try {
    const result = await new Promise((resolve, reject) => {
      execFile('node', [extractNameScript, tmpFile], { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
    const parsed = JSON.parse(result);
    if (parsed.name) saveName = parsed.name;
  } catch { }
  try { unlinkSync(tmpFile); } catch { }

  // Fallback: extract filename from URL path, excluding generic names
  if (!saveName) {
    const urlFilename = parsedUrl.pathname.split('/').pop();
    if (urlFilename && (urlFilename.endsWith('.js') || urlFilename.endsWith('.mjs'))
        && urlFilename !== 'index.js' && urlFilename !== 'index.mjs') {
      saveName = urlFilename.replace(/\.(js|mjs)$/, '');
    }
  }
  // Final fallback: use plugin-<timestamp>
  if (!saveName) {
    saveName = `plugin-${Date.now()}`;
  }

  let filename = (saveName.endsWith('.js') || saveName.endsWith('.mjs')) ? saveName : saveName + '.js';
  // Safety check
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    filename = `plugin-${Date.now()}.js`;
  }
  // Ensure plugins dir exists
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }
  // Deduplicate: append unique identifier for same-name files
  if (existsSync(join(pluginsDir, filename))) {
    const ext = filename.endsWith('.mjs') ? '.mjs' : '.js';
    const base = filename.slice(0, -ext.length);
    filename = `${base}-${Date.now()}${ext}`;
  }
  writeFileSync(join(pluginsDir, filename), content, 'utf-8');
  return { filename };
}

/**
 * Delete a directory plugin (service/panel plugin with plugin.json).
 * Validates: slug shape, realpath containment inside pluginsDir (symlink-safe),
 * presence of plugin.json, manifest name matching the directory name.
 * Caller must stop/unload the plugin's service BEFORE calling this (Windows: the
 * child's cwd is the plugin dir, deletion would EBUSY while it runs).
 * @param {string} pluginsDir
 * @param {string} dirName
 * @throws {Error} with statusCode on validation failure
 */
export function deletePluginDir(pluginsDir, dirName) {
  if (!dirName || !PLUGIN_NAME_RE.test(dirName)) {
    throw Object.assign(new Error('Invalid directory name'), { statusCode: 400 });
  }
  const target = join(pluginsDir, dirName);
  if (!existsSync(target)) {
    throw Object.assign(new Error('Directory not found'), { statusCode: 404 });
  }
  const realRoot = realpathSync(pluginsDir);
  const realTarget = realpathSync(target);
  const rootCmp = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
  const targetCmp = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  const rel = relative(rootCmp, targetCmp);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw Object.assign(new Error('Directory escapes plugins root'), { statusCode: 400 });
  }
  const manifestPath = join(realTarget, 'plugin.json');
  if (!existsSync(manifestPath)) {
    throw Object.assign(new Error('Not a directory plugin (missing plugin.json)'), { statusCode: 400 });
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (manifest.name && manifest.name !== dirName) {
      throw Object.assign(new Error(`Manifest name "${manifest.name}" does not match directory "${dirName}"`), { statusCode: 400 });
    }
  } catch (err) {
    if (err.statusCode) throw err;
    throw Object.assign(new Error('plugin.json is not valid JSON'), { statusCode: 400 });
  }
  rmSync(realTarget, { recursive: true, force: true });
  return { deleted: dirName };
}
