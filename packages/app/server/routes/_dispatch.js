// Lightweight in-house HTTP route dispatcher (no framework).
//
// Replaces the giant `if (url === ... && method === ...)` chain that used to live
// inside server.js's handleRequest. Each domain module under server/routes/ exports
// an ordered array of route descriptors; server.js concatenates them IN THE SAME
// ORDER as the original if-chain and hands the array here. dispatch() walks the list
// top-to-bottom and invokes the first matching handler — byte-for-byte the same
// matching semantics as the old chain (order is load-bearing for prefix-vs-exact and
// method-distinguished duplicates like GET vs POST /api/file-content).
//
// Descriptor shape (one of):
//   { method, match: 'exact'|'prefix', path, handler }
//   { predicate: (url, method) => boolean, handler }   // for compound conditions
//
// Handler signature: (req, res, parsedUrl, isLocal, deps) => void | Promise<void>
// `deps` is the singleton dependency bag built once in server.js (reassignable state
// via getters, shared Maps by reference, helpers, constants).

function matches(route, url, method) {
  if (route.predicate) return route.predicate(url, method);
  if (route.method !== method) return false;
  return route.match === 'prefix' ? url.startsWith(route.path) : url === route.path;
}

/**
 * Build a dispatcher over an ordered list of route descriptors.
 * Returns an async function(req, res, parsedUrl, isLocal, deps) => boolean,
 * resolving true if a route handled the request, false if none matched
 * (caller then falls through to the static-file / 404 path).
 */
export function createDispatcher(routes) {
  return async function dispatch(req, res, parsedUrl, isLocal, deps) {
    const url = parsedUrl.pathname;
    const method = req.method;
    for (const route of routes) {
      if (matches(route, url, method)) {
        await route.handler(req, res, parsedUrl, isLocal, deps);
        return true;
      }
    }
    return false;
  };
}
