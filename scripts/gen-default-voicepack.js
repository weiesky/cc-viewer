#!/usr/bin/env node
// Generate a chiptune mascot voice pack ("default-pixel-buddy") — 8-bit-style cues
// covering every voice-pack event — into public/voice-packs/default/.
//
// ⚠️ The pack CURRENTLY shipped in that dir is a different, hand-maintained one
// ("default-butler", recorded .MP3s). Running this script overwrites it with the
// chiptune set + rewrites pack.json's name to default-pixel-buddy. To avoid an
// accidental clobber, this script REFUSES to run when the dir already holds a
// differently-named pack.json — pass --force to regenerate the chiptune pack anyway.
//
// Usage:
//   node scripts/gen-default-voicepack.js [--force]
//   node scripts/gen-default-voicepack.js --merge --only <keys> [--dir <packDir>]
//
// Merge mode (the sanctioned way to add cues to a SHIPPED pack without replacing
// its hand-recorded audio): read the existing pack.json, synthesize ONLY the
// requested events as <eventKey>.wav, and merge those entries into its events
// table (name/displayName/placeholder/voiceLines/cues are preserved). Events
// whose pattern entry is `null` are intentionally NOT synthesized — they map to
// an existing recording (e.g. agentLoopEnd reuses each pack's turnEnd audio) and
// the pack.json entry is edited by hand.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_KEYS } from '../packages/core/src/voice-pack-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAMPLE_RATE = 22050;
const BITS = 16;
const CHANNELS = 1;
const ATTACK_SECONDS = 0.005;   // very fast attack — gives chiptune "pluck" character
const RELEASE_SECONDS = 0.025;  // slightly longer release with quadratic curve below

// Each pattern is an array of segments:
//   { wave: 'sine'|'square', freq, freqEnd?, ms, vol }
// freqEnd (optional) glides the pitch linearly from `freq` to `freqEnd` over the
// segment's duration — that's how "Bi-poop?" gets its rising inquiry inflection
// and how "Wee-doo~" gets its falling tail.
//
// Volumes are deliberately low (≈ 0.20-0.28). Square waves are harmonic-rich
// and read louder than sines at the same numeric volume.
//
// A `null` pattern means "no synthesized cue": the event maps to an existing
// recording in each shipped pack (agentLoopEnd reuses the turnEnd audio —
// semantically exact). The key stays listed so the EVENT_KEYS coverage check
// below treats the pack as complete by construction.
const PATTERNS = {
  // "Bi-poop?" — short low chirp, gap, rising "poop?" inquiry
  planApproval: [
    { wave: 'square', freq: 587, ms: 120, vol: 0.22 },
    { freq: 0, ms: 50, vol: 0 },
    { wave: 'square', freq: 659, freqEnd: 880, ms: 200, vol: 0.22 },
  ],
  // "Pip pip!" — two identical bouncy chirps, high pitch
  askQuestion: [
    { wave: 'square', freq: 1175, ms: 75, vol: 0.24 },
    { freq: 0, ms: 70, vol: 0 },
    { wave: 'square', freq: 1175, ms: 75, vol: 0.24 },
  ],
  // "Wee-doo~ ♪" — descending arpeggio with a glide tail for the satisfied finish.
  // 659Hz 起点是历史值（曾为避让已删除的 timeoutWarning60s 880Hz 警报刻意降调），
  // 现可自由调整；保留是因为现有 default-pack 音色已稳定，不必无故 churn。
  turnEnd: [
    { wave: 'square', freq: 659, ms: 110, vol: 0.24 },
    { freq: 0, ms: 30, vol: 0 },
    { wave: 'square', freq: 523, ms: 110, vol: 0.24 },
    { freq: 0, ms: 30, vol: 0 },
    { wave: 'square', freq: 440, freqEnd: 330, ms: 280, vol: 0.24 },
  ],
  // "Dee-dee!" — short rising two-note "ready" cue for the loop start. Deliberately
  // distinct from askQuestion's repeated equal chirps (an inquiry) and from the
  // turnEnd arpeggio (a finish): this is a pickup, not a question or a completion.
  agentLoopStart: [
    { wave: 'square', freq: 523, ms: 90, vol: 0.22 },
    { freq: 0, ms: 40, vol: 0 },
    { wave: 'square', freq: 784, freqEnd: 988, ms: 150, vol: 0.22 },
  ],
  // Loop end reuses each pack's recorded turnEnd cue (it IS the same semantic
  // boundary) — nothing to synthesize. pack.json entries are edited by hand.
  agentLoopEnd: null,
};

// Defensive: PATTERNS must cover every EVENT_KEYS entry so the bundled default
// pack is complete. If someone adds a new event to voice-pack-events.js but
// forgets to add a pattern here, fail loudly at script run time.
{
  const missing = EVENT_KEYS.filter((k) => !(k in PATTERNS));
  if (missing.length > 0) {
    console.error(`[voice-pack] gen-default-voicepack.js missing PATTERNS for: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Phase-accumulating oscillator with linear pitch glide + AR envelope (fast
// linear attack, quadratic release). Phase carries across frequency changes
// inside a segment so glides don't pop at the boundary.
function buildPcm(pattern) {
  const totalSamples = pattern.reduce((n, seg) => n + Math.round(SAMPLE_RATE * seg.ms / 1000), 0);
  const pcm = Buffer.alloc(totalSamples * 2);
  let cursor = 0;
  let phase = 0;
  for (const seg of pattern) {
    const count = Math.round(SAMPLE_RATE * seg.ms / 1000);
    const attackSamples = Math.min(Math.floor(SAMPLE_RATE * ATTACK_SECONDS), Math.floor(count / 8));
    const releaseSamples = Math.min(Math.floor(SAMPLE_RATE * RELEASE_SECONDS), Math.floor(count / 3));
    const wave = seg.wave || 'sine';
    const freqStart = seg.freq;
    const freqEnd = seg.freqEnd != null ? seg.freqEnd : seg.freq;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      const currentFreq = freqStart + (freqEnd - freqStart) * t;
      // Silence segments still advance the cursor but contribute zero amplitude.
      if (freqStart === 0 && freqEnd === 0) {
        pcm.writeInt16LE(0, cursor); cursor += 2;
        continue;
      }
      phase += (2 * Math.PI * currentFreq) / SAMPLE_RATE;
      let sample;
      if (wave === 'square') {
        sample = ((phase % (2 * Math.PI)) < Math.PI) ? 1 : -1;
      } else {
        sample = Math.sin(phase);
      }
      // AR envelope — linear attack, quadratic release (cubic feels too quick;
      // linear release has audible cutoff). Sustain is implicit at peak volume.
      let env = seg.vol;
      if (i < attackSamples) {
        env *= i / attackSamples;
      } else if (i > count - releaseSamples) {
        const rt = (count - i) / releaseSamples;
        env *= rt * rt;
      }
      const v = Math.max(-1, Math.min(1, sample * env)) * 0x7FFF;
      pcm.writeInt16LE(v | 0, cursor);
      cursor += 2;
    }
  }
  return pcm;
}

function buildWav(pcm) {
  const byteRate = SAMPLE_RATE * CHANNELS * BITS / 8;
  const blockAlign = CHANNELS * BITS / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Onomatopoeia table — what each cue is meant to sound like, for anyone
// generating their own replacements.
const CUES = {
  planApproval:       'Bi-poop?  (短低 + 上扬"问"句)',
  askQuestion:        'Pip pip!  (两短促跳跳)',
  turnEnd:            'Wee-doo~ ♪  (下行小调，满足)',
  agentLoopStart:     'Dee-dee!  (短促上行双音，"开工")',
  agentLoopEnd:       '(复用各语音包 turnEnd 录音，无合成音)',
};

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const MERGE = argv.includes('--merge');
function _argValue(flag) {
  const i = argv.indexOf(flag);
  return (i >= 0 && i + 1 < argv.length) ? argv[i + 1] : null;
}
const ONLY = (_argValue('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = _argValue('--dir')
  ? join(process.cwd(), _argValue('--dir'))
  : join(__dirname, '..', 'apps', 'web', 'public', 'voice-packs', 'default');

// ── Merge mode: add/refresh ONLY the requested synthesized events inside an
// existing (shipped) pack. Everything else in pack.json is preserved. ────────
if (MERGE) {
  if (ONLY.length === 0) {
    console.error('[voice-pack] --merge requires --only <eventKey[,eventKey…]>');
    process.exit(1);
  }
  const packPath = join(OUT_DIR, 'pack.json');
  if (!existsSync(packPath)) {
    console.error(`[voice-pack] --merge needs an existing pack.json at ${packPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(packPath, 'utf-8'));
  manifest.events = manifest.events || {};
  manifest.cues = manifest.cues || {};
  for (const key of ONLY) {
    if (!(key in PATTERNS)) {
      console.error(`[voice-pack] unknown event key for --only: ${key}`);
      process.exit(1);
    }
    if (PATTERNS[key] === null) {
      console.log(`[voice-pack] ${key}: no synthesized pattern (maps to an existing recording) — edit pack.json by hand`);
      continue;
    }
    const wav = buildWav(buildPcm(PATTERNS[key]));
    const filePath = join(OUT_DIR, `${key}.wav`);
    writeFileSync(filePath, wav);
    manifest.events[key] = { file: `${key}.wav`, size: wav.length };
    manifest.cues[key] = CUES[key];
    console.log(`[voice-pack] wrote ${filePath} (${wav.length} bytes)`);
  }
  writeFileSync(packPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[voice-pack] merged into ${packPath}`);
  process.exit(0);
}

// 防误覆盖：若目标目录已存在「异名」pack.json（如随仓发布的 default-butler），需显式 --force 才覆盖。
const existingPackPath = join(OUT_DIR, 'pack.json');
if (!FORCE && existsSync(existingPackPath)) {
  let existingName = '';
  try { existingName = JSON.parse(readFileSync(existingPackPath, 'utf-8')).name || ''; } catch { /* 坏文件视为无名，放行 */ }
  if (existingName && existingName !== 'default-pixel-buddy') {
    console.error(`[voice-pack] ${OUT_DIR} 已存在异名默认包「${existingName}」，本脚本会用 default-pixel-buddy 覆盖它。`);
    console.error('[voice-pack] 如确需重新生成 chiptune 占位包，请加 --force：node scripts/gen-default-voicepack.js --force');
    process.exit(1);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const manifest = {
  name: 'default-pixel-buddy',
  displayName: 'Pixel Buddy · 像素小宠物 (默认)',
  // Intentional chiptune SFX (not silent placeholders); placeholder:false marks them as real audio.
  // Note: the dir's currently-shipped pack is default-butler, not this one (see header).
  placeholder: false,
  events: {},
  cues: { ...CUES },
};
for (const [eventKey, pattern] of Object.entries(PATTERNS)) {
  if (pattern === null) {
    // No synthesized cue (see the PATTERNS comment) — the pixel pack maps the
    // event to its turnEnd wav so a full regeneration still ships complete.
    if (manifest.events.turnEnd) {
      manifest.events[eventKey] = { ...manifest.events.turnEnd };
      console.log(`[voice-pack] ${eventKey}: aliased to the turnEnd wav (no synthesized pattern)`);
    }
    continue;
  }
  const wav = buildWav(buildPcm(pattern));
  const path = join(OUT_DIR, `${eventKey}.wav`);
  writeFileSync(path, wav);
  manifest.events[eventKey] = { file: `${eventKey}.wav`, size: wav.length };
  console.log(`[voice-pack] wrote ${path} (${wav.length} bytes)`);
}
writeFileSync(join(OUT_DIR, 'pack.json'), JSON.stringify(manifest, null, 2));
console.log(`[voice-pack] wrote ${join(OUT_DIR, 'pack.json')}`);
