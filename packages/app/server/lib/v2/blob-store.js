// Wire Format v2 — content-addressed blob store for body.tools / body.system
// (docs/refactor/WIRE_FORMAT_V2.md §7).
//
// key = sha256(JSON.stringify(value)) hex, first 16 chars. File content is the
// raw JSON value. Writes go through writeFileAtomicSync (tmp → fsync → rename):
// the blob is the ONE durability barrier of the write-order protocol — its
// journal reference may only become durable after the blob itself (spec §1.3).

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { blobPath, writeFileAtomicSync } from './layout.js';

export class BlobStore {
  /** @param {object} paths - sessionPaths() object for one session */
  constructor(paths) {
    this._paths = paths;
    this._written = new Set(); // refs confirmed on disk this process lifetime
  }

  /**
   * Store a JSON-serializable value, return its ref ('sha256-<hex16>').
   * Idempotent: same content → same ref, at most one disk write per process
   * (existsSync re-check makes restarts cheap too). Returns null for
   * undefined/null values so callers can spread `...(ref && {tools: ref})`.
   *
   * KEEP IN SYNC: replay.js `blobRefOf` re-implements this exact formula
   * (sha256 of JSON.stringify, hex, first 16) so the verifier can compare v1
   * inline values against journal refs WITHOUT reading blob files — change the
   * hash, the slice length, or the serialization here and the verify gate
   * silently produces false diffs/OKs unless blobRefOf changes with it.
   */
  put(value) {
    if (value === undefined || value === null) return null;
    const json = JSON.stringify(value);
    const ref = 'sha256-' + createHash('sha256').update(json).digest('hex').slice(0, 16);
    if (this._written.has(ref)) return ref;
    const finalPath = blobPath(this._paths, ref);
    if (!existsSync(finalPath)) {
      writeFileAtomicSync(finalPath, json);
    }
    this._written.add(ref);
    return ref;
  }
}
