// Remote-admin elevation for management routes (container / cloud deployment).
//
// cc-viewer's sensitive management endpoints are gated on `isLocal` (loopback socket
// peer) — a model that assumes the admin sits on the host machine. In a single-container
// or cloud deployment the admin's browser is remote, so `isLocal` is false and every
// management call 403s even after the caller has authenticated (password-login cookie or
// `?token=` URL).
//
// `server.js handleRequest` therefore computes `isAdmin = isLocal || authenticated-remote`
// (mirroring decideAuth's remote-allow branches) and attaches it as `req.ccvIsAdmin`
// before dispatch. Management handlers call `isAdminReq(req, isLocal)` instead of a bare
// `isLocal` check so an authenticated remote admin is treated like the loopback admin.
//
// IMPORTANT: this must NOT be used for the internal machine bridges (events.js hook
// notifies, ask-perm.js streamChunk) — those carry INTERNAL_TOKEN from the local claude
// child process and must stay strictly loopback. Only human-facing management routes use
// isAdminReq.

/**
 * Is this request from an admin — loopback, or an authenticated remote client?
 * @param {object} req  the incoming request (server.js sets req.ccvIsAdmin after auth)
 * @param {boolean} isLocal  loopback socket peer (the dispatch-threaded flag)
 * @returns {boolean}
 */
export function isAdminReq(req, isLocal) {
  return isLocal === true || req?.ccvIsAdmin === true;
}
