/**
 * file-types.test.js — unit tests for utils/fileTypes.js getFileType/getExt.
 *
 * Each group was paired with a deliberately-breaking mutation during authoring
 * and confirmed to FAIL (pristine green + mutant red):
 *   - flip the directory guard to run AFTER ext parsing (breaks empty-name dir)
 *   - change `dot > 0` to `dot >= 0` (dotfiles gain a bogus extension)
 *   - drop SPECIAL_FILENAMES lookup (Makefile/Dockerfile → plain)
 *   - remove .toLowerCase() (uppercase .PNG → plain)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getFileType, getExt } from '../src/utils/fileTypes.js';

describe('getFileType', () => {
  it('directory short-circuits before any name parsing (empty name safe)', () => {
    assert.equal(getFileType('', 'directory'), 'directory');
    assert.equal(getFileType('src', 'directory'), 'directory');
    assert.equal(getFileType('weird.name', 'directory'), 'directory');
  });

  it('code family', () => {
    for (const f of ['a.js', 'a.jsx', 'a.ts', 'a.tsx', 'a.py', 'a.go', 'a.rs', 'a.rb',
      'A.java', 'a.c', 'a.cpp', 'a.h', 'a.php', 'a.sql', 'a.vue', 'a.svelte',
      'a.kt', 'a.swift', 'a.lua', 'a.r', 'a.sh', 'a.bash', 'a.zsh']) {
      assert.equal(getFileType(f, 'file'), 'code', f);
    }
  });

  it('markup family', () => {
    for (const f of ['a.html', 'a.htm', 'a.xml', 'a.css', 'a.scss', 'a.sass', 'a.less']) {
      assert.equal(getFileType(f, 'file'), 'markup', f);
    }
  });

  it('data family', () => {
    for (const f of ['a.json', 'a.yml', 'a.yaml', 'a.toml', 'a.ini', 'a.env', 'a.conf', 'a.lock', 'a.map']) {
      assert.equal(getFileType(f, 'file'), 'data', f);
    }
  });

  it('document family', () => {
    for (const f of ['a.md', 'a.markdown', 'a.txt', 'a.rst', 'a.log']) {
      assert.equal(getFileType(f, 'file'), 'document', f);
    }
  });

  it('image family (svg is image, not markup)', () => {
    for (const f of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.svg', 'a.bmp', 'a.ico', 'a.icns', 'a.webp', 'a.avif']) {
      assert.equal(getFileType(f, 'file'), 'image', f);
    }
  });

  it('video / audio / archive / pdf / office / font / binary', () => {
    assert.equal(getFileType('a.mp4', 'file'), 'video');
    assert.equal(getFileType('a.mov', 'file'), 'video');
    assert.equal(getFileType('a.mp3', 'file'), 'audio');
    assert.equal(getFileType('a.flac', 'file'), 'audio');
    for (const f of ['a.zip', 'a.tar', 'a.gz', 'a.tgz', 'a.bz2', 'a.xz', 'a.7z', 'a.rar']) {
      assert.equal(getFileType(f, 'file'), 'archive', f);
    }
    assert.equal(getFileType('a.pdf', 'file'), 'pdf');
    for (const f of ['a.doc', 'a.docx', 'a.xls', 'a.xlsx', 'a.ppt', 'a.pptx', 'a.odt', 'a.ods', 'a.odp']) {
      assert.equal(getFileType(f, 'file'), 'office', f);
    }
    for (const f of ['a.woff', 'a.woff2', 'a.ttf', 'a.otf', 'a.eot']) {
      assert.equal(getFileType(f, 'file'), 'font', f);
    }
    for (const f of ['a.exe', 'a.dll', 'a.so', 'a.dylib', 'a.bin', 'a.class', 'a.jar', 'a.wasm', 'a.db', 'a.sqlite']) {
      assert.equal(getFileType(f, 'file'), 'binary', f);
    }
  });

  it('extension is case-insensitive', () => {
    assert.equal(getFileType('PHOTO.PNG', 'file'), 'image');
    assert.equal(getFileType('Archive.ZIP', 'file'), 'archive');
    assert.equal(getFileType('Doc.PDF', 'file'), 'pdf');
  });

  it('double extension classifies by the last one (tar.gz → archive)', () => {
    assert.equal(getFileType('a.tar.gz', 'file'), 'archive');
  });

  it('dotfiles are NOT misread as extensions (leading dot, no other dot)', () => {
    assert.equal(getFileType('.gitignore', 'file'), 'plain');
    assert.equal(getFileType('.env', 'file'), 'plain');
    assert.equal(getFileType('.eslintrc', 'file'), 'plain');
  });

  it('well-known extension-less filenames map to data (build/config semantics)', () => {
    assert.equal(getFileType('Makefile', 'file'), 'data');
    assert.equal(getFileType('Dockerfile', 'file'), 'data');
    assert.equal(getFileType('LICENSE', 'file'), 'data');
    assert.equal(getFileType('README', 'file'), 'data');
  });

  it('unknown / extension-less falls back to plain', () => {
    assert.equal(getFileType('a.unknownext', 'file'), 'plain');
    assert.equal(getFileType('noextension', 'file'), 'plain');
    assert.equal(getFileType('', 'file'), 'plain');
    assert.equal(getFileType(undefined, 'file'), 'plain');
  });

  it('handles paths by taking the basename', () => {
    assert.equal(getFileType('src/components/App.tsx', 'file'), 'code');
    assert.equal(getFileType('docs/guide/README.md', 'file'), 'document');
  });
});

describe('getExt', () => {
  it('extracts lowercased extension consistent with getFileType', () => {
    assert.equal(getExt('a.TSX'), 'tsx');
    assert.equal(getExt('src/a.PNG'), 'png');
    assert.equal(getExt('.gitignore'), '');
    assert.equal(getExt('noext'), '');
    assert.equal(getExt('a.tar.gz'), 'gz');
  });
});
