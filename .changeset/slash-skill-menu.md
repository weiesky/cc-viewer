---
"cc-viewer": patch
---

feat(chat): typing `/` opens a grouped skill menu (personal / built-in). Picking a skill inserts `/name ` into the composer for argument entry instead of sending. Data comes from the SDK's supportedCommands() (broadcast as an sdk-skills frame with reconnect replay), falling back to /api/skills in PTY mode, before first init, or on failure.
