import { isUtf8 } from 'node:buffer';

export function getUtf16Encoding(input) {
  const littleEndian = input[0] === 0xff && input[1] === 0xfe;
  const bigEndian = input[0] === 0xfe && input[1] === 0xff;
  if (!littleEndian && !bigEndian) return null;
  // A UTF-32LE BOM starts with the UTF-16LE prefix. Never guess through it.
  if (littleEndian && input[2] === 0 && input[3] === 0) return null;
  const payload = input.subarray(2);
  if (payload.length % 2 !== 0) return null;
  const text = bigEndian ? Buffer.from(payload).swap16().toString('utf16le') : payload.toString('utf16le');
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0 || code === 0xfffd) return null;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
  }
  return bigEndian ? 'utf16be' : 'utf16le';
}

// Inspect the entire already-bounded buffer before it can become editable text.
// Legacy encodings without a reliable BOM intentionally fall back to download
// rather than being decoded into corruptible replacement characters. ESC and
// backspace are accepted for ANSI logs and terminal progress output.
export function isBinaryBuffer(input) {
  if (input.length === 0 || getUtf16Encoding(input)) return false;
  let controls = 0;
  for (const byte of input) {
    if (byte === 0) return true;
    if (byte < 0x08 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b) || byte === 0x7f) controls++;
  }
  return controls / input.length > 0.02 || !isUtf8(input);
}
