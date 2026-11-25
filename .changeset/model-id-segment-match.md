---
"cc-viewer": patch
---

fix(server): model system-prompt matching now treats the model ID as structured segments instead of an opaque substring. Matching first pins the model family via the ident chain (ignoring case and any vendor prefix like `vendor/`), and the version only ranks entries within a family — it never vetoes a match, so an ID with a vendor prefix or a version bump (e.g. `vendor/DeepSeek-V4.1-Flash-1017`) now hits its family preset (`deepseek-v4-flash`), and an unseen version (e.g. `GLM-5.4` or `GLM-6`) lands on the closest entry of its family line instead of the fallback. Both layers keep the legacy substring predicate as a fallback so non-canonical names still hit. `presets/index.json` is untouched, so all `.builtin-disabled.json` tombstones stay valid.
