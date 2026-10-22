---
"cc-viewer": patch
---

feat(web): move the proxy hot-switch chip (and its SDK launch-model fallback) out of the PC header into the chat input bar — it sits right of the Enter hint, next to the send button. In PTY mode with the terminal open (input bar unmounted) the chip returns to its old header slot as a fallback so the entry never disappears; it shows in `--sdk` mode too. iPad gains the chip in pad view (default iPad keeps the phone layout, entry via the hamburger menu); pure-mobile layout is unchanged. The header no longer shows the chip permanently (only as the PTY-terminal-open fallback); header/menu ProxyModal entries are retained; Electron native-tab mode does not show the chip.
