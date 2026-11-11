// Adapted from dsh-workspace-explorer src/vendor/archive/inflate.js
// Upstream revision: 19f1fbc83c5cb98c8139dc75bf5d28767813fdca (MIT).
import { ArchiveError, concatBytes, toBytes } from './util.js';

const capabilityCache = new Map();
export function isDecompressionSupported(format = 'deflate-raw') {
  if (typeof DecompressionStream !== 'function') return false;
  if (capabilityCache.has(format)) return capabilityCache.get(format);
  try {
    new DecompressionStream(format);
    capabilityCache.set(format, true);
    return true;
  } catch {
    capabilityCache.set(format, false);
    return false;
  }
}

export async function inflateBytes(input, format = 'deflate-raw', options = {}) {
  const bytes = toBytes(input);
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new ArchiveError('Invalid decompression limit.', 'BAD_LIMIT');
  }
  if (!isDecompressionSupported(format)) {
    throw new ArchiveError(`Decompression is unavailable for ${format}.`, 'NO_DECOMPRESSION', { format });
  }
  if (maxBytes === 0) return { bytes: new Uint8Array(0), truncated: bytes.length > 0 };

  const stream = new DecompressionStream(format);
  const writer = stream.writable.getWriter();
  // A bounded reader may cancel early, which is expected to reject the writer.
  const writeDone = writer.write(bytes).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > maxBytes) {
        const take = maxBytes - total;
        if (take > 0) chunks.push(value.subarray(0, take));
        total += take;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch (err) {
    throw new ArchiveError(`Unable to decompress archive data: ${err?.message || 'invalid data'}`, 'INFLATE_FAILED');
  } finally {
    await writeDone;
  }
  return { bytes: concatBytes(chunks, total), truncated };
}
