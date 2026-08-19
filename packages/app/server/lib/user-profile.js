import { userInfo, platform } from 'node:os';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// MIME type allowlist (SVG excluded to prevent XSS)
const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

// macOS user profile (avatar + display name), cached once
let _osProfile = null;
let _osProfilePromise = null;

/**
 * Resolve avatar value: supports URL, data URI, and local file path.
 * @param {string} value - avatar value
 * @returns {string|null} value usable in <img src>, or null
 */
function resolveAvatar(value) {
  if (!value) return null;

  // data URI — return as-is
  if (value.startsWith('data:')) return value;

  // URL — return as-is
  if (value.startsWith('http://') || value.startsWith('https://')) return value;

  // File path
  try {
    const absPath = resolve(value);
    if (!existsSync(absPath)) return null;

    // Size check
    const stat = statSync(absPath);
    if (stat.size > MAX_AVATAR_SIZE) return null;

    // Extension allowlist
    const ext = extname(absPath).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) return null;

    const buf = readFileSync(absPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Get macOS system username and avatar (singleton cached).
 */
async function _getOsProfile() {
  if (_osProfile) return _osProfile;
  if (_osProfilePromise) return _osProfilePromise;
  _osProfilePromise = _getOsProfileImpl();
  _osProfile = await _osProfilePromise;
  _osProfilePromise = null;
  return _osProfile;
}

async function _getOsProfileImpl() {
  const info = userInfo();
  const name = info.username || 'User';
  let displayName = name;
  let avatarBase64 = null;

  if (platform() === 'darwin') {
    try {
      const { stdout: rn } = await execFileAsync('dscl', ['.', '-read', `/Users/${name}`, 'RealName'], { encoding: 'utf-8', timeout: 3000 });
      const match = rn.match(/RealName:\n?\s*(.+)/);
      if (match && match[1].trim()) displayName = match[1].trim();
    } catch { }

    try {
      const { stdout } = await execAsync(`dscl . -read /Users/${name} JPEGPhoto | tail -1 | xxd -r -p`, { timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'buffer' });
      if (stdout && stdout.length > 100) {
        avatarBase64 = `data:image/jpeg;base64,${stdout.toString('base64')}`;
      }
    } catch { }
  }

  return { name: displayName, avatar: avatarBase64 };
}

/**
 * Get user profile.
 * Priority: CCV_USER_NAME/CCV_USER_AVATAR env vars > OS detection
 */
export async function getUserProfile() {
  const osProfile = await _getOsProfile();

  const name = process.env.CCV_USER_NAME || osProfile.name;

  let avatar = osProfile.avatar;
  if (process.env.CCV_USER_AVATAR) {
    const resolved = resolveAvatar(process.env.CCV_USER_AVATAR);
    if (resolved !== null) avatar = resolved;
  }

  return { name, avatar };
}

/** Clear cache (for testing only) */
export function clearProfileCache() {
  _osProfile = null;
  _osProfilePromise = null;
}
