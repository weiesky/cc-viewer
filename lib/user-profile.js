import { userInfo, platform } from 'node:os';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// macOS user profile (avatar + display name), cached once
let _userProfile = null;
let _userProfilePromise = null;

export async function getUserProfile() {
  if (_userProfile) return _userProfile;
  if (_userProfilePromise) return _userProfilePromise;
  _userProfilePromise = _getUserProfileImpl();
  _userProfile = await _userProfilePromise;
  _userProfilePromise = null;
  return _userProfile;
}

async function _getUserProfileImpl() {
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
