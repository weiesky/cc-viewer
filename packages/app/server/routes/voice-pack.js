// Voice-pack routes (moved verbatim from server.js handleRequest).
// Manages user-uploaded audio + serves the bundled "皇上系列" default pack.
// Uploads are loopback-only — LAN clients can play but not write.
import { lstatSync, statSync, createReadStream } from 'node:fs';
import { LOG_DIR } from '../../findcc.js';
import {
  saveAudio as vpSaveAudio,
  listUserAudio as vpListUserAudio,
  deleteUserAudio as vpDeleteUserAudio,
  getUserAudioPath as vpGetUserAudioPath,
  getBundledPackPath as vpGetBundledPackPath,
  listDefaultPack as vpListDefaultPack,
  listBundledPacks as vpListBundledPacks,
  isDefaultPackPlaceholder as vpIsDefaultPackPlaceholder,
  mimeForFormat as vpMime,
  isValidId as vpIsValidId,
  BUNDLED_PACK_IDS as VP_BUNDLED_PACK_IDS,
  EVENT_KEYS as VP_EVENT_KEYS,
  MAX_AUDIO_BYTES as VP_MAX_BYTES,
} from '../lib/voice-pack-manager.js';

function voicePackList(req, res) {
  try {
    const userAudio = vpListUserAudio(LOG_DIR);
    const bundledPacks = vpListBundledPacks();
    // SUNSET-MARKER: ccv-voice-pack-defaultPack-flat-shape
    // Legacy defaultPack / defaultPackPlaceholder fields kept alongside the
    // new bundledPacks[] for one release so any out-of-tree consumer (mobile
    // app shell, third-party fork) doesn't break on the shape change.
    // Drop after 1.6.273+. New code should iterate bundledPacks.
    const defaultPack = vpListDefaultPack();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      userAudio,
      bundledPacks,
      defaultPack,
      defaultPackPlaceholder: vpIsDefaultPackPlaceholder(),
      eventKeys: VP_EVENT_KEYS,
      maxBytes: VP_MAX_BYTES,
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'list failed', detail: err?.message }));
  }
}

function voicePackUpload(req, res, parsedUrl, isLocal) {
  // Loopback-only — refuse LAN clients even if they hold a valid token.
  // The token already gates LAN access but voice-pack writes touch the local FS
  // and end up reachable from every client; keep the write side strictly local.
  if (!isLocal) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upload allowed from loopback only' }));
    return;
  }
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing boundary' }));
    return;
  }
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > VP_MAX_BYTES + 4096) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `File too large (max ${VP_MAX_BYTES} bytes)` }));
    return;
  }
  const boundary = boundaryMatch[1];
  const chunks = [];
  let totalSize = 0;
  let aborted = false;
  req.on('data', chunk => {
    totalSize += chunk.length;
    if (totalSize > VP_MAX_BYTES + 4096) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `File too large (max ${VP_MAX_BYTES} bytes)` }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      const buf = Buffer.concat(chunks);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) throw new Error('Malformed multipart');
      const headerStr = buf.slice(0, headerEnd).toString();
      const nameMatch = headerStr.match(/filename="([^"]+)"/);
      const originalName = nameMatch ? nameMatch[1].replace(/[\x00-\x1f/\\]/g, '_') : 'upload';
      const bodyStart = headerEnd + 4;
      const closingBoundary = Buffer.from('\r\n--' + boundary);
      const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
      const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);
      const result = vpSaveAudio(LOG_DIR, originalName, fileData, { isLoopback: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      const status = err?.code === 'TOO_LARGE' ? 413 : err?.code === 'BAD_FORMAT' ? 415 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || 'Upload failed' }));
    }
  });
}

function voicePackDelete(req, res, parsedUrl, isLocal) {
  if (!isLocal) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Delete allowed from loopback only' }));
    return;
  }
  const url = parsedUrl.pathname;
  const id = url.slice('/api/voice-pack/delete/'.length);
  if (!vpIsValidId(id)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid id' }));
    return;
  }
  const ok = vpDeleteUserAudio(LOG_DIR, id);
  res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok }));
}

// Serve audio — supports HTTP Range so iOS Safari / mobile players can seek mp3
// (Safari refuses to start playback when the server returns 200 without Accept-Ranges).
// Path forms:
//   /api/voice-pack/audio/<packId>/<eventKey>  — bundled pack (default, sanguo, …)
//   /api/voice-pack/audio/<uuid>               — user-uploaded file
function voicePackAudio(req, res, parsedUrl) {
  const url = parsedUrl.pathname;
  const tail = url.slice('/api/voice-pack/audio/'.length);
  let resolved = null;
  let isBundled = false;
  // Iterate the explicit BUNDLED_PACK_IDS list so an unknown prefix can never
  // accidentally hit the bundled branch — falls through to the uuid lookup,
  // which is whitelisted by isValidId.
  for (const packId of VP_BUNDLED_PACK_IDS) {
    const prefix = `${packId}/`;
    if (tail.startsWith(prefix)) {
      const eventKey = tail.slice(prefix.length);
      resolved = vpGetBundledPackPath(packId, eventKey);
      isBundled = true;
      break;
    }
  }
  if (!isBundled) {
    resolved = vpGetUserAudioPath(LOG_DIR, tail);
  }
  if (!resolved) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  // Cache strategy:
  //   - default-pack: short max-age + must-revalidate, no `immutable` — the on-disk
  //     file *can* change when a placeholder is replaced by a real recording at the
  //     same path. `must-revalidate` keeps the file out of the stale bucket once
  //     max-age expires. Paired with the ETag below, this lets browsers
  //     conditional-request and pick up regenerated audio after a `gen-default-voicepack`
  //     run — without an ETag they'd silently serve cached stale content.
  //   - user audio: content-addressed by UUID (delete + re-upload always mints a
  //     new id), so safe to mark immutable for a full day. Loopback-only writes,
  //     so the LAN audience cannot mutate.
  const cacheControl = isBundled
    ? 'public, max-age=300, must-revalidate'
    : 'private, max-age=86400, immutable';
  try {
    // Symlink hardening: refuse to serve symlinks even though the routing layer
    // already enforces the id whitelist. A local attacker who can write to
    // LOG_DIR/voice-packs/ could otherwise drop `<uuid>.mp3 → /etc/passwd` and
    // have it streamed over LAN. Same family as the file-access-policy realpath
    // check used elsewhere in server.js for /api/read-file.
    const ls = lstatSync(resolved.path);
    if (ls.isSymbolicLink()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const stat = statSync(resolved.path);
    const fileSize = stat.size;
    // ETag = "<size>-<mtime ms>" — cheap, stable across restarts, changes whenever
    // the file is rewritten. Honors If-None-Match → 304 so a regenerated default
    // pack actually reaches the browser instead of being silently served stale.
    const etag = `"${fileSize.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
      res.end();
      return;
    }
    const mime = vpMime(resolved.format);
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end < fileSize && start <= end) {
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': mime,
            'Cache-Control': cacheControl,
            ETag: etag,
          });
          createReadStream(resolved.path, { start, end }).pipe(res);
          return;
        }
      }
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
      ETag: etag,
    });
    createReadStream(resolved.path).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Read failed', detail: err?.message }));
  }
}

export const voicePackRoutes = [
  { method: 'GET', match: 'exact', path: '/api/voice-pack/list', handler: voicePackList },
  { method: 'POST', match: 'exact', path: '/api/voice-pack/upload', handler: voicePackUpload },
  { method: 'DELETE', match: 'prefix', path: '/api/voice-pack/delete/', handler: voicePackDelete },
  { method: 'GET', match: 'prefix', path: '/api/voice-pack/audio/', handler: voicePackAudio },
];
