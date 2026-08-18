# LSP

Queries Language Server Protocol (LSP) servers for code intelligence — definitions, references, hovers, symbols, implementations, and call hierarchy. More precise than text search because it understands code semantically.

## When to Use

- Jump to a symbol's definition (`goToDefinition`) or find every reference (`findReferences`)
- Read type signatures / documentation for a symbol (`hover`)
- List symbols in one file (`documentSymbol`) or search them across the project (`workspaceSymbol`)
- Find implementations of an interface or abstract method (`goToImplementation`)
- Walk the call hierarchy of a function (`prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`)

## Activation

- Inactive until a code-intelligence plugin for the language is installed (the server binary is installed separately).
- The tool only appears when an LSP client is connected.

## Parameters

- `operation` (string, required): one of the operations listed above.
- `filePath` (string, required): the file to operate on.
- `line` (number, required): 1-based line number, as shown in the editor.
- `character` (number, required): 1-based character offset, as shown in the editor.

## Notes

- Requires a configured LSP server for that file type; otherwise the call returns an error.
- Line and character are 1-based (editor coordinates), not 0-based.
- Prefer LSP over `Grep` when you need semantic navigation (true definition/reference) rather than a textual match.

## Related Concepts

- Complements `Read` and `Edit` when navigating and changing code.
