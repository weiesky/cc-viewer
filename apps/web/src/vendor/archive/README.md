# Archive preview parser

Adapted from `dsh-workspace-explorer/src/vendor/archive`, revision `19f1fbc83c5cb98c8139dc75bf5d28767813fdca`, under the MIT license in `LICENSE`.

Only the portable parser was adapted. The upstream desktop UI, Windows host, shell integration, and filesystem operations are intentionally excluded.

Changes include English comments and diagnostics, structured UI notes, bounded TAR header progress and numeric fields, safe ZIP64 integers, display-only entry-name sanitization, bounded iterative trees, and stable gzip caching. No Node-specific imports or OS-dependent path handling are used.

Entry previews retain their last selected result; repeated user-initiated reads use per-call output limits rather than an irreversible cumulative budget. The gzip container is cached once with a 32 MiB output limit and released when the viewer closes. Legacy non-UTF-8 decoding is heuristic: GBK requires a plausible CJK result, otherwise the bytes are displayed as Latin-1. Ambiguous historical encodings may still need a viewer encoding selector in a future increment.
