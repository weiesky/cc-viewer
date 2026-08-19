# Read

Loads the contents of a single file from the local filesystem. Supports plain text, source code, images, PDFs, and Jupyter notebooks, returning results with 1-based line numbers in `cat -n` style.

## When to Use

- Reading a source file at a known path before editing or analysis
- Inspecting configuration files, lockfiles, logs, or generated artifacts
- Viewing screenshots or diagrams the user pasted into the conversation
- Extracting a specific page range from a long PDF manual
- Opening a `.ipynb` notebook to review code cells, markdown, and cell outputs together

## Parameters

- `file_path` (string, required): Absolute path to the target file. Relative paths are rejected.
- `offset` (integer, optional): 1-based line number to start reading from. Useful for large files when paired with `limit`.
- `limit` (integer, optional): Maximum number of lines to return starting at `offset`. Defaults to 2000 lines from the top of the file when omitted.
- `pages` (string, optional): Page range for PDF files, for example `"1-5"`, `"3"`, or `"10-20"`. Required for PDFs longer than 10 pages; maximum 20 pages per request.

## Examples

### Example 1: Read an entire small file
Call `Read` with only `file_path` set to `/Users/me/project/src/index.ts`. Up to 2000 lines are returned with line numbers, which is usually sufficient for editing context.

### Example 2: Page through a long log
Use `offset: 5001` and `limit: 500` on a multi-thousand-line log file to retrieve a narrow window without wasting context tokens.

### Example 3: Extract specific PDF pages
For a 120-page PDF at `/tmp/spec.pdf`, set `pages: "8-15"` to pull only the chapter you need. Omitting `pages` on a large PDF produces an error.

### Example 4: View an image
Pass the absolute path of a PNG or JPG screenshot. The image is rendered visually so Claude Code can reason about it directly.

## Notes

- Always prefer absolute paths. If the user provides one, trust it as-is.
- Lines longer than 2000 characters are truncated; treat the returned content as possibly clipped for extremely wide data.
- Reading multiple independent files? Issue several `Read` calls in the same response so they run in parallel.
- `Read` cannot list directories. Use a `Bash` `ls` call or the `Glob` tool instead.
- Reading an existing but empty file returns a system reminder rather than file bytes, so handle that signal explicitly.
- A successful `Read` is required before you can use `Edit` on the same file in the current session.
