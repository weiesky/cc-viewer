---
"cc-viewer": patch
---

fix(logs): log-management modal — project switch no longer lags one round (refetch now runs in the setState callback, in both the selector change and the modal-reopen/migration-done paths), the pager is hidden entirely when a project has a single page of sessions (explicit `total > pageSize` gate instead of antd's `hideOnSinglePage`, which flickered while totals were stale mid-switch), and page-number items get a 4px gap.
