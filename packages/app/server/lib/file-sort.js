// Shared directory-listing sort comparator. Used by /api/files (project view)
// and /api/target-files (CLAUDE.md / skill / memory browser). Pure functions
// so the rules can be unit-tested without a server.
//
// Ordering contract:
//  - directories always come before files (regardless of the requested key);
//  - null / non-finite metric values (stat failure, directories' size) sort
//    AFTER real values;
//  - `name` is the stable tie-breaker so re-sorting the same listing is
//    deterministic;
//  - `order` reverses only the metric comparison, not the directory-first
//    rule (directories stay on top even in desc).

const SORT_KEYS = new Set(['name', 'size', 'mtime']);
const ORDERS = new Set(['asc', 'desc']);

export function normalizeSortParams(searchParams) {
  const sortRaw = (searchParams && searchParams.get && searchParams.get('sort')) || '';
  const orderRaw = (searchParams && searchParams.get && searchParams.get('order')) || '';
  const sort = SORT_KEYS.has(sortRaw) ? sortRaw : 'name';
  const order = ORDERS.has(orderRaw) ? orderRaw : 'asc';
  return { sort, order };
}

function compareName(a, b) {
  return String(a.name).localeCompare(String(b.name));
}

// `sort` is one of 'name' | 'size' | 'mtime'; `order` is 'asc' | 'desc'.
// Ordering rules:
//  - Directories always rank before files (order does not flip this).
//  - Within each kind, the metric (or name) is reversed when order is desc —
//    matching the file-manager convention the user expects when clicking a
//    column header twice. The sidebar tree never sends a sort param, so the
//    tree's listing always stays in name-asc via the default call; the grid's
//    non-default sort is isolated under its own cache key (see
//    fileBrowserPrefs.dirCacheKey).
//  - Null / non-finite metrics always rank last (never flipped by order),
//    with name as tie-breaker.
export function compareEntries(sort, order) {
  const metricKey = sort === 'mtime' ? 'mtimeMs' : sort;
  const desc = order === 'desc';
  return (a, b) => {
    const aDir = a.type === 'directory';
    const bDir = b.type === 'directory';
    if (aDir !== bDir) return aDir ? -1 : 1;
    if (aDir) {
      const cmp = compareName(a, b);
      return desc ? -cmp : cmp;
    }
    if (sort === 'name') {
      const cmp = compareName(a, b);
      return desc ? -cmp : cmp;
    }
    // Files: nulls last, then metric asc/desc, then name asc.
    const aNum = typeof a[metricKey] === 'number' && Number.isFinite(a[metricKey]);
    const bNum = typeof b[metricKey] === 'number' && Number.isFinite(b[metricKey]);
    if (aNum && bNum) {
      const av = a[metricKey];
      const bv = b[metricKey];
      if (av !== bv) return desc ? bv - av : av - bv;
      return compareName(a, b);
    }
    if (aNum) return -1;
    if (bNum) return 1;
    return compareName(a, b);
  };
}
