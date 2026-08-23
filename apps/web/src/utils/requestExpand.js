/**
 * Pure helper that builds the JsonViewer expandNode callback for a request body.
 * Framework-free so it can be unit-tested (see test/request-expand.test.js).
 * Holds the expand policy formerly inlined in DetailPanel.getRequestExpandNode.
 *
 * @param {object} opts
 * @param {*} opts.data - the request body (already stripped of private keys)
 * @param {string} opts.type - 'request' | 'response'
 * @param {string} opts.reqType - classifyRequest type ('MainAgent' | 'Preflight' | ...)
 * @param {Set|null} opts.filterExpandSet - reminder-filter expand refs (claudeMd / skills)
 * @returns {undefined|((level:number, value:*, field:string)=>boolean)}
 */
export function buildRequestExpandNode({ data, type, reqType, filterExpandSet }) {
  if (type !== 'request' || !data || typeof data !== 'object') return undefined;

  if (reqType === 'Preflight') {
    // Collect all object/array refs under messages and system[2] that should be expanded
    const expandRefs = new Set();
    const collectAll = (obj) => {
      if (obj && typeof obj === 'object') {
        expandRefs.add(obj);
        if (Array.isArray(obj)) obj.forEach(collectAll);
        else Object.values(obj).forEach(collectAll);
      }
    };
    if (Array.isArray(data.messages)) collectAll(data.messages);
    if (Array.isArray(data.system) && data.system.length >= 3) collectAll(data.system[2]);
    return (level, value, field) => {
      if (level < 2) return true;
      if (expandRefs.has(value)) return true;
      if (filterExpandSet && filterExpandSet.has(value)) return true;
      // expand system itself at root level so the 3rd item is visible
      if (level === 1 && field === 'system') return true;
      return false;
    };
  }

  if (reqType === 'MainAgent' && Array.isArray(data.messages) && data.messages.length === 1) {
    const msg = data.messages[0];
    const contentArr = msg && Array.isArray(msg.content) ? msg.content : null;
    const lastContent = contentArr && contentArr.length > 0 ? contentArr[contentArr.length - 1] : null;
    const expandRefs = new Set();
    const collectAll = (obj) => {
      if (obj && typeof obj === 'object') {
        expandRefs.add(obj);
        if (Array.isArray(obj)) obj.forEach(collectAll);
        else Object.values(obj).forEach(collectAll);
      }
    };
    if (lastContent) collectAll(lastContent);
    expandRefs.add(data.messages);
    if (msg && typeof msg === 'object') expandRefs.add(msg);
    if (contentArr) expandRefs.add(contentArr);
    // Expand the full system array so every segment (identity prefix, static
    // instructions, dynamic instructions) is visible on the first-turn
    // MainAgent request. CLI mode typically has 3+ segments; SDK mode has 2.
    if (Array.isArray(data.system)) collectAll(data.system);
    return (level, value, field) => {
      if (level < 2) return true;
      if (expandRefs.has(value)) return true;
      if (filterExpandSet && filterExpandSet.has(value)) return true;
      return false;
    };
  }

  if (filterExpandSet) {
    return (level, value, field) => {
      if (level < 2) return true;
      if (filterExpandSet.has(value)) return true;
      return false;
    };
  }

  return undefined;
}
