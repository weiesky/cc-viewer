---
"cc-viewer": patch
---

Footer geo badge (CountryFlag) now only mounts for Anthropic official subscriptions — the endpoint must be official (proxyOfficialDefault) AND plan-usage headers must have been seen; third-party proxy / self-hosted profile users no longer see the flag or fire the ipinfo.io/ipwho.is/ipapi.co lookups.
