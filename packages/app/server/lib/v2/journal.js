// Wire Format v2 — journal writer (docs/refactor/WIRE_FORMAT_V2.md §4).
//
// The journal is the single ordering axis. Two-phase, append-only:
//   req line  — built in the SAME synchronous segment as the request initiation
//               (the caller allocates seq via nextSeq() there; enqueuing later
//               is fine, MUTATING history lines is not);
//   done line — on completion/error.
// The reader folds the two phases by seq; a req without a done is in-flight
// (or the process died) — that IS the v1 placeholder, minus the duplicated body.

import { iterateJsonlLines } from './jsonl-read.js';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { shardPartsDir } from './layout.js';
import { reportSwallowed } from '../../lib/error-report.js';

export class Journal {
  /**
   * @param {object} paths - sessionPaths() object
   * @param {{appendTo: Function}} queue - AsyncWriteQueue (explicit-path API)
   */
  constructor(paths, queue) {
    this._paths = paths;
    this._queue = queue;
    // Seed from any existing journal so seq stays monotonic per session FILE,
    // not per Journal instance (spec §4 "session 内单调"). Without this, a
    // session-object recreation onto the same dir (workspace switch A→B→A,
    // resetSessions, process re-attach) would restart at 1 and collide with
    // prior lines — the reader folds by seq, so collisions silently corrupt.
    // Journal lines are small; a one-time full read at session bind is cheap.
    //
    // Sharding (2026-11): after a rotation the live journal restarts EMPTY while
    // the archived `parts/<N>/journal.jsonl` hold the earlier seqs. A restart
    // that re-seeds only from the live journal would restart at 1 and collide
    // with every frozen shard. Seed from the max across the live journal AND
    // every archived shard.
    this._seq = Journal._maxSeqIn(paths.journalPath);
    const shardMax = Journal._maxSeqAcrossShards(paths.journalPath);
    if (shardMax > this._seq) this._seq = shardMax;
  }

  /** Max journal seq across the session's archived `parts/<N>/` shards (0 when
   *  none/unreadable). Sits in journal.js (not shard-manager) to avoid an
   *  import cycle — shard-manager's rotate path constructs Journal. */
  static _maxSeqAcrossShards(journalPath) {
    const partsDir = shardPartsDir(dirname(journalPath));
    let names;
    // A non-ENOENT readdir failure must not silently reseed seq at 1 — that
    // collides with every frozen shard's seqs. Report and keep the 0 fallback
    // only for the genuinely-absent parts/ dir.
    try { names = readdirSync(partsDir, { withFileTypes: true }); }
    catch (err) {
      if (err && err.code !== 'ENOENT') reportSwallowed('v2-journal.shard-seq-scan', err);
      return 0;
    }
    let max = 0;
    for (const e of names) {
      if (!e.isDirectory()) continue;
      const n = Journal._maxSeqIn(join(partsDir, e.name, 'journal.jsonl'));
      if (n > max) max = n;
    }
    return max;
  }

  static _maxSeqIn(journalPath) {
    try {
      let max = 0;
      // Per-line regex instead of JSON.parse: tolerant of a truncated tail
      // line and ~10x cheaper on large journals. Streamed line-by-line
      // (issue #129): a whole-file read past Node's string cap would land in
      // the catch below and silently RESET seq to 0 — colliding with every
      // existing line, which the reader folds into corrupted sessions.
      for (const line of iterateJsonlLines(journalPath)) {
        const m = /"seq":\s*(\d+)/.exec(line);
        if (!m) continue;
        const n = Number(m[1]);
        if (n > max) max = n;
      }
      return max;
    } catch {
      return 0; // unreadable journal → fresh numbering beats crashing the writer
    }
  }

  /** Allocate the next initiation-order seq. MUST be called in the request's
   *  synchronous initiation segment (§3.7 guard — completion order must never
   *  become the semantic order). */
  nextSeq() {
    return ++this._seq;
  }

  /** Enqueue a req-phase line. `fields` carries the spec §4 req schema minus ph. */
  writeReq(fields, onDone) {
    this._queue.appendTo(this._paths.journalPath, JSON.stringify({ ph: 'req', ...fields }) + '\n', onDone);
  }

  /** Enqueue a done-phase line. */
  writeDone(fields, onDone) {
    this._queue.appendTo(this._paths.journalPath, JSON.stringify({ ph: 'done', ...fields }) + '\n', onDone);
  }
}
