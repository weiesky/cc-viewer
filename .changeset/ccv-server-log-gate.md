---
"cc-viewer": patch
---

fix(server): gate all `[ccv:*]` diagnostic console output on `CCV_DEBUG` so a down/flaky upstream or other recoverable noise no longer spams the terminal; set `CCV_DEBUG=1` to restore the previous per-tag capped logging.
