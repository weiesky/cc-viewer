import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';

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
 * @param {string} extractNameScript - path to lib/extract-plugin-name.mjs
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
      execFile('node', [extractNameScript, tmpFile], { timeout: 5000 }, (err, stdout) => {
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
