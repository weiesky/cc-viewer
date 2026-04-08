export function extractApiErrorMessage(status, errorText) {
  try {
    const errorJson = JSON.parse(errorText);
    if (errorJson?.error?.message) return errorJson.error.message;
    if (errorJson?.message) return errorJson.message;
  } catch { }
  return `API Error (${status}): ${String(errorText).slice(0, 200)}`;
}

export function formatProxyRequestError(err) {
  let msg = err?.message || String(err);
  if (err?.cause) {
    msg += ` (${err.cause.message || err.cause.code || err.cause})`;
  }
  if (msg.includes('HEADERS_TIMEOUT')) msg = 'Upstream headers timeout';
  if (msg.includes('BODY_TIMEOUT')) msg = 'Upstream body timeout';
  return `[CC-Viewer Proxy] Request failed: ${msg}`;
}
