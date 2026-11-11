import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBinaryBuffer } from '../server/lib/binary-sniff.js';

describe('binary content sniffing', () => {
  it('accepts empty, ordinary, and multilingual UTF-8 text', () => {
    for (const input of ['', 'hello\nworld\t!\r\n', '﻿hello', '中文内容\nÉmile']) {
      assert.equal(isBinaryBuffer(Buffer.from(input)), false);
    }
  });

  it('accepts BOM-marked UTF-16 for reliable text decoding', () => {
    assert.equal(isBinaryBuffer(Buffer.from([0xff, 0xfe, 0x41, 0x00])), false);
    assert.equal(isBinaryBuffer(Buffer.from([0xfe, 0xff, 0x00, 0x41])), false);
  });

  it('rejects NUL and invalid UTF-8', () => {
    assert.equal(isBinaryBuffer(Buffer.from([0x41, 0x00, 0x42])), true);
    assert.equal(isBinaryBuffer(Buffer.from([0xff, 0x41, 0x00])), true);
    assert.equal(isBinaryBuffer(Buffer.from([0xc3, 0x28])), true);
    assert.equal(isBinaryBuffer(Buffer.from([0x41, 0x01, 0x01, 0x01])), true);
    assert.equal(isBinaryBuffer(Buffer.alloc(200, 0x41)), false);
  });

  it('allows multibyte UTF-8 across any byte offset', () => {
    for (let prefixLength = 0; prefixLength < 4; prefixLength++) {
      assert.equal(isBinaryBuffer(Buffer.concat([Buffer.alloc(prefixLength, 0x41), Buffer.from('中')])), false);
    }
  });

  it('rejects an invalid byte before a valid suffix', () => {
    const input = Buffer.concat([Buffer.from([0xc3, 0x28]), Buffer.alloc(100, 0x41), Buffer.from('中')]);
    assert.equal(isBinaryBuffer(input), true);
  });

  it('rejects incomplete UTF-8 at EOF and invalid sequences', () => {
    for (const bytes of [[0xff], [0xe4], [0x41, 0x80], [0xff, 0xe4, 0xb8, 0xad], [0x41, 0xe0, 0x80, 0x80]]) {
      assert.equal(isBinaryBuffer(Buffer.from(bytes)), true, Buffer.from(bytes).toString('hex'));
    }
  });

  it('accepts ANSI colors and terminal backspace formatting', () => {
    const logs = '\x1b[31mERROR\x1b[0m failed\n'.repeat(200) + '50%\b\b\b100%';
    assert.equal(isBinaryBuffer(Buffer.from(logs)), false);
  });

  it('rejects an invalid byte beyond an initially valid prefix', () => {
    assert.equal(isBinaryBuffer(Buffer.concat([Buffer.alloc(8192, 0x41), Buffer.from([0xff])])), true);
  });
});
