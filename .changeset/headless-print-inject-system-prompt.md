---
"cc-viewer": patch
---

Headless `-p` / `--print` and one-shot `ccv run` sessions now carry ccv's enhanced context without starting the GUI. The `runProxyCommand` link runs the full system-prompt pipeline (`resolveLaunchSystemPrompt`), so `CC_SYSTEM.md` / `CC_APPEND_SYSTEM.md` / model-specific `system_prompt/` entries are injected exactly as in the PTY path — landing before a literal `--` so prompt text stays intact — and the link now sets `CCV_CLI_MODE=1`, so a one-shot run no longer prints the "CC Viewer started" GUI banner.
