/**
 * Wire v3 (V3.S3a) — metadata-row adapters for the request list.
 *
 * A row is adapted into the minimal entry-shaped object the existing list
 * pipeline reads (visibleRequests relevance filter, RequestList row fields,
 * selection helpers), so the flagged path swaps the DATA SOURCE instead of
 * forking every consumer. Deep fields (body.messages/system/tools,
 * response.body.content) are intentionally absent — the detail view fetches
 * them on demand (V3.S3b `/api/v2-entry`), and `_v3Row` marks the shape for
 * the few call sites that must branch.
 */

/** Adapt one server metadata row to the list-item shape. */
export function rowToListItem(row) {
  const hasResponse = row.status != null || row.usage;
  return {
    timestamp: row.timestamp,
    url: row.url,
    proxyUrl: row.proxyUrl,
    proxyRole: row.proxyRole,
    duration: row.duration,
    inProgress: row.inProgress === true,
    isHeartbeat: row.kind === 'heartbeat',
    isCountTokens: row.kind === 'countTokens',
    mainAgent: row.mainAgent === true,
    teammate: row.teammate,
    body: { model: row.model },
    response: hasResponse ? { status: row.status ?? 0, body: row.usage ? { usage: row.usage } : {} } : null,
    // detail-fetch identity (V3.S3b): (sessionId, seq) → /api/v2-entry
    _seq: row.seq,
    _seqEpoch: `v2:${row.sessionId}`,
    _v3Row: row,
  };
}

/**
 * Type tag for a list item: server-computed on the rows path (falling back to
 * kind-derived coarse type while a live row's classification is pending),
 * client classifyRequest on the legacy path. Returns {type, subType}.
 */
export function listItemType(req, nextReq, classifyRequest) {
  const row = req._v3Row;
  if (!row) return classifyRequest(req, nextReq);
  if (row.typeTag) return { type: row.typeTag.type, subType: row.typeTag.subType ?? undefined };
  if (row.mainAgent) return { type: 'MainAgent', subType: undefined };
  if (row.kind === 'teammate') return { type: 'Teammate', subType: undefined };
  if (row.kind === 'countTokens') return { type: 'Count', subType: undefined };
  return { type: 'SubAgent', subType: undefined };
}
