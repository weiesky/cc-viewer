// Adapted from dsh-workspace-explorer src/vendor/archive/detect.js
// Upstream revision: 19f1fbc83c5cb98c8139dc75bf5d28767813fdca (MIT).
import { toBytes } from './util.js';

export const EXT_TO_FORMAT = {
  zip: 'zip', tar: 'tar', gz: 'gzip', tgz: 'tar.gz', 'tar.gz': 'tar.gz',
  '7z': '7z', rar: 'rar', xz: 'xz', 'tar.xz': 'xz', txz: 'xz',
  bz2: 'bz2', 'tar.bz2': 'bz2', tbz2: 'bz2', tbz: 'bz2',
};

export function extensionOf(filename = '') {
  const base = String(filename).split(/[\\/]/).pop().toLowerCase();
  for (const ext of ['tar.gz', 'tar.xz', 'tar.bz2']) {
    if (base.endsWith(`.${ext}`)) return ext;
  }
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

const MAGIC_CHECKS = [
  { format: 'zip', test: b => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b
    && ((b[2] === 0x03 && b[3] === 0x04) || (b[2] === 0x05 && b[3] === 0x06) || (b[2] === 0x07 && b[3] === 0x08)) },
  { format: 'gzip', test: b => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b },
  { format: '7z', test: b => b.length >= 6 && b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf && b[4] === 0x27 && b[5] === 0x1c },
  { format: 'rar', test: b => b.length >= 4 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 },
  { format: 'xz', test: b => b.length >= 6 && b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58 && b[4] === 0x5a && b[5] === 0x00 },
  { format: 'bz2', test: b => b.length >= 3 && b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68 },
];

export function sniffFormat(input) {
  const b = toBytes(input);
  for (const check of MAGIC_CHECKS) if (check.test(b)) return check.format;
  if (b.length >= 263 && b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74 && b[260] === 0x61 && b[261] === 0x72
    && (b[262] === 0x00 || b[262] === 0x20)) return 'tar';
  return null;
}

export function detect(input, filename = '') {
  const bytes = toBytes(input);
  const extension = extensionOf(filename);
  const magic = sniffFormat(bytes);
  const format = magic === 'gzip' && (extension === 'tar.gz' || extension === 'tgz')
    ? 'tar.gz' : magic || EXT_TO_FORMAT[extension] || null;
  return {
    format,
    supported: format === 'zip' || format === 'tar' || format === 'gzip' || format === 'tar.gz',
    source: magic ? 'magic' : format ? 'extension' : 'none',
    extension,
  };
}
