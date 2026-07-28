// Best-effort recursive removal with native retries for transient filesystem errors.
//
// Each caller first stops the server resources that can write into the directory.
// fs.rm then handles transient EBUSY/ENOTEMPTY/EPERM failures with its built-in
// retry policy. A final cleanup failure is harmless because every test uses a
// unique directory under os.tmpdir().
import { rm } from 'node:fs/promises';

export async function rmBestEffort(dir) {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch { /* isolated test cleanup; the OS will reap any leftover temp directory */ }
}
