---
"cc-viewer": patch
---

Drop 7 loop-volatile dynamic system-prompt variables (`${git.status}`, `${os.uptime}`, `${os.freeMemory}`, `${terminal.columns}`, `${terminal.rows}`, `${time.current}`, `${time.iso}`) that drifted mid-session and misled context. Removed from the default template, the Dynamic Parameter Documentation (×18 locales), and `createSystemPromptVariables`; stable identifiers (`git.branch`/`recentCommits`, `time.date`/`timezone`, etc.) stay. User templates referencing a removed placeholder keep the literal text under `missingVariableMode:'keep'`.
