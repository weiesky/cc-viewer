export function restartPollDecision({ responseOk = true, info, previousProcessId, targetVersion } = {}) {
  if (!responseOk) return 'error';
  if (!info || !previousProcessId || info.processId === previousProcessId) return 'wait';
  return info.version === targetVersion ? 'reload' : 'restored';
}

export function downloadPercent({ downloaded, total } = {}) {
  return Number.isFinite(downloaded) && Number.isFinite(total) && total > 0 ? Math.min(100, Math.floor(downloaded / total * 100)) : null;
}
