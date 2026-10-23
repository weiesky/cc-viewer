// Human-readable schedule descriptions + task status derivation for the scheduled-task
// modal. Pure functions (no React) so they're directly unit-testable.
//
// Timezone (review P1-5): the server schedules in ITS local timezone, so all displayed
// times are formatted with `timeZone: serverTimezone` — a LAN/remote viewer in another
// timezone must see the server's wall clock, not the browser's.

import { t, getLang } from '../i18n.js';

const ISO_WEEKDAY_LONG = {}; // lang → Intl.DateTimeFormat cache

function _weekdayName(isoDay) {
  const lang = getLang();
  if (!ISO_WEEKDAY_LONG[lang]) {
    ISO_WEEKDAY_LONG[lang] = new Intl.DateTimeFormat(lang, { weekday: 'long' });
  }
  // 2024-01-01 is a Monday → ISO day 1. Add (isoDay-1) days.
  const d = new Date(2024, 0, 1 + ((isoDay - 1) % 7));
  return ISO_WEEKDAY_LONG[lang].format(d);
}

/** One-line schedule description for the list. Falls back gracefully on bad input (P3-6).
 * Times render in the SERVER timezone (pass serverTimezone), matching formatNextRun. */
export function describeSchedule(schedule, serverTimezone) {
  try {
    if (!schedule || typeof schedule !== 'object') return t('ui.schedule.previewInvalid');
    switch (schedule.kind) {
      case 'hourly':
        return t('ui.schedule.summary.hourly', { minute: String(schedule.minute).padStart(2, '0') });
      case 'daily':
        return t('ui.schedule.summary.daily', { time: schedule.time });
      case 'weekdays':
        return t('ui.schedule.summary.weekdays', { time: schedule.time });
      case 'weekly':
        return t('ui.schedule.summary.weekly', { day: _weekdayName(schedule.day), time: schedule.time });
      case 'cron':
        return t('ui.schedule.summary.cron', { expr: schedule.expr });
      case 'once':
        return t('ui.schedule.summary.once', { at: formatTimestamp(schedule.at, serverTimezone) });
      default:
        return t('ui.schedule.previewInvalid');
    }
  } catch {
    return t('ui.schedule.previewInvalid');
  }
}

/** Task list status: running > completed > error > paused > active. */
export function deriveTaskUiStatus(task) {
  if (!task || typeof task !== 'object') return 'active';
  if (task.running) return 'running';
  if (task.completedAt != null) return 'completed';
  if (task.lastResult === 'error' || task.lastResult === 'failed') return 'error';
  if (task.enabled === false) return 'paused';
  return 'active';
}

/** Format a fire time in the SERVER's timezone (not the browser's). */
export function formatNextRun(ms, serverTimezone) {
  if (ms == null || !Number.isFinite(ms)) return t('ui.schedule.nextRunNone');
  try {
    const fmt = new Intl.DateTimeFormat(getLang(), {
      timeZone: serverTimezone || undefined,
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return fmt.format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

/** Short timestamp for once-schedule summaries and run history rows. */
export function formatTimestamp(ms, serverTimezone) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  try {
    const fmt = new Intl.DateTimeFormat(getLang(), {
      timeZone: serverTimezone || undefined,
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return fmt.format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

/** Run-status → i18n label. */
export function runStatusLabel(status) {
  const key = `ui.schedule.runStatus.${status}`;
  const v = t(key);
  return v === key ? status : v;
}

// Server reason codes (snake_case / kebab) → i18n key suffix (camelCase). review P1-3.
const REASON_KEY = {
  no_live_session: 'noLiveSession',
  sdk_unavailable: 'sdkUnavailable',
  spawn_unavailable: 'spawnUnavailable',
  not_initialized: 'notInitialized',
  busy: 'busy',
  paused: 'paused',
  stale: 'stale',
  interrupted: 'interrupted',
  timeout: 'timeout',
  aborted: 'aborted',
  queue_rejected: 'queueRejected',
  'turn-error': 'turnError',
  'no result message': 'noResult',
  internal: 'internal',
};

/** Localized reason text for a run's failure/skip reason code. */
export function reasonLabel(reason) {
  if (!reason) return '';
  const suffix = REASON_KEY[reason] || 'internal';
  const key = `ui.schedule.reason.${suffix}`;
  const v = t(key);
  return v === key ? String(reason) : v;
}

/** Localized API error text for a route error code. */
export function errorLabel(code) {
  if (!code) return t('ui.schedule.error.forbidden');
  const key = `ui.schedule.error.${code}`;
  const v = t(key);
  return v === key ? String(code) : v;
}
