import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_MIME,
  AUDIO_EXTENSIONS,
  audioExtOf,
  sniffAudioMime,
  parseByteRange,
} from '../server/lib/audio-stream.js';

describe('audioExtOf', () => {
  it('derives the lowercased extension cross-platform', () => {
    assert.equal(audioExtOf('/a/b/song.MP3'), '.mp3');
    assert.equal(audioExtOf('C:\\dir\\track.FLAC'), '.flac');
    assert.equal(audioExtOf('song.ogg'), '.ogg');
  });
  it('returns empty for no extension and dotfiles', () => {
    assert.equal(audioExtOf('/a/b/README'), '');
    assert.equal(audioExtOf('.gitignore'), '');
  });
});

describe('AUDIO_MIME / AUDIO_EXTENSIONS', () => {
  it('maps every supported extension to an audio/* MIME', () => {
    for (const ext of AUDIO_EXTENSIONS) {
      assert.ok(AUDIO_MIME[ext], `missing MIME for ${ext}`);
      assert.ok(AUDIO_MIME[ext].startsWith('audio/'), `non-audio MIME for ${ext}`);
    }
  });
  it('uses container-correct types per RFC', () => {
    assert.equal(AUDIO_MIME['.mp3'], 'audio/mpeg');
    assert.equal(AUDIO_MIME['.opus'], 'audio/ogg'); // RFC 7845 §9
    assert.equal(AUDIO_MIME['.oga'], 'audio/ogg');
    assert.equal(AUDIO_MIME['.m4a'], 'audio/mp4'); // RFC 4337
    assert.equal(AUDIO_MIME['.flac'], 'audio/flac'); // RFC 9639
    assert.equal(AUDIO_MIME['.aac'], 'audio/aac');
  });
});

describe('sniffAudioMime', () => {
  it('falls back to the extension MIME on empty/short buffer', () => {
    assert.equal(sniffAudioMime(null, '.mp3'), 'audio/mpeg');
    assert.equal(sniffAudioMime(Buffer.alloc(0), '.wav'), 'audio/wav');
    assert.equal(sniffAudioMime(Buffer.from([0xff]), '.flac'), 'audio/flac');
  });
  it('detects the Ogg container (covers opus/vorbis/ogg-flac)', () => {
    const ogg = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);
    assert.equal(sniffAudioMime(ogg, '.opus'), 'audio/ogg');
  });
  it('detects native FLAC', () => {
    assert.equal(sniffAudioMime(Buffer.from([0x66, 0x4c, 0x61, 0x43]), '.flac'), 'audio/flac');
  });
  it('detects WAV via RIFF....WAVE', () => {
    const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    assert.equal(sniffAudioMime(wav, '.wav'), 'audio/wav');
  });
  it('detects MP4/M4A via ftyp at offset 4, always audio/mp4', () => {
    const m4a = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
    assert.equal(sniffAudioMime(m4a, '.m4a'), 'audio/mp4');
    // A generic MP4 brand still resolves to audio/mp4 on this audio-only route.
    const mp4 = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    assert.equal(sniffAudioMime(mp4, '.m4a'), 'audio/mp4');
  });
  it('detects ID3-tagged MP3 and ADTS AAC distinctly', () => {
    // ID3 + ADTS frame after the tag → aac. tag size 0, frame at offset 10.
    const id3Adts = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xf1])]);
    assert.equal(sniffAudioMime(id3Adts, '.aac'), 'audio/aac');
    // ID3 + MP3 frame (FF FB, layer bits≠00) → mpeg.
    const id3Mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb])]);
    assert.equal(sniffAudioMime(id3Mp3, '.mp3'), 'audio/mpeg');
  });
  it('recognizes MPEG-2 ADTS (FF F0/F8) as well as MPEG-4 (FF F1/F9)', () => {
    assert.equal(sniffAudioMime(Buffer.from([0xff, 0xf0, 0x50]), '.aac'), 'audio/aac');
    assert.equal(sniffAudioMime(Buffer.from([0xff, 0xf8, 0x50]), '.aac'), 'audio/aac');
  });
  it('falls back to the extension MIME when an ID3 tag overruns the sniff window', () => {
    // A large ID3v2 tag (declared size 0x7f7f7f7f) that we cannot scan past: trust
    // the .aac extension rather than guessing audio/mpeg.
    const bigTag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]);
    assert.equal(sniffAudioMime(bigTag, '.aac'), 'audio/aac');
    assert.equal(sniffAudioMime(bigTag, '.mp3'), 'audio/mpeg');
  });
  it('detects bare ADTS and MP3 frames', () => {
    assert.equal(sniffAudioMime(Buffer.from([0xff, 0xf1, 0x50]), '.aac'), 'audio/aac');
    assert.equal(sniffAudioMime(Buffer.from([0xff, 0xfb, 0x90]), '.mp3'), 'audio/mpeg');
  });
  it('never returns video/* and falls back on unknown bytes', () => {
    const r = sniffAudioMime(Buffer.from([0x00, 0x01, 0x02, 0x03]), '.mp3');
    assert.equal(r, 'audio/mpeg');
    assert.ok(!r.startsWith('video/'));
  });
});

describe('parseByteRange', () => {
  const size = 1000;
  it('parses open and closed ranges', () => {
    assert.deepEqual(parseByteRange('bytes=0-', size), { start: 0, end: 999 });
    assert.deepEqual(parseByteRange('bytes=10-99', size), { start: 10, end: 99 });
  });
  it('clamps end beyond EOF', () => {
    assert.deepEqual(parseByteRange('bytes=0-999999999', size), { start: 0, end: 999 });
  });
  it('supports suffix ranges, clamping N>=size to the whole file', () => {
    assert.deepEqual(parseByteRange('bytes=-100', size), { start: 900, end: 999 });
    assert.deepEqual(parseByteRange('bytes=-5000', size), { start: 0, end: 999 });
  });
  it('accepts a case-insensitive range unit', () => {
    assert.deepEqual(parseByteRange('Bytes=0-1', size), { start: 0, end: 1 });
  });
  it('returns unsatisfiable for start>=size and suffix 0 and empty file', () => {
    assert.equal(parseByteRange('bytes=1000-', size), 'unsatisfiable');
    assert.equal(parseByteRange('bytes=2000-3000', size), 'unsatisfiable');
    assert.equal(parseByteRange('bytes=-0', size), 'unsatisfiable');
    assert.equal(parseByteRange('bytes=0-', 0), 'unsatisfiable');
  });
  it('returns null (ignore → 200) for malformed, multi-range, and start>end', () => {
    assert.equal(parseByteRange('bytes=', size), null);
    assert.equal(parseByteRange('bytes=0-100,200-300', size), null);
    assert.equal(parseByteRange('items=0-10', size), null);
    assert.equal(parseByteRange('bytes=200-100', size), null);
    assert.equal(parseByteRange(undefined, size), null);
  });
});
