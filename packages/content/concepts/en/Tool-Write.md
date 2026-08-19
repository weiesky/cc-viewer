# Write

Creates a new file or fully replaces the contents of an existing one on the local filesystem. Because it replaces everything at the target path, it should be reserved for genuine creation or intentional full rewrites.

## When to Use

- Creating a brand-new source file, test, or configuration that does not yet exist
- Generating a fresh fixture, snapshot, or data file from scratch
- Performing a complete rewrite where an incremental `Edit` would be more complex than starting over
- Emitting a requested artifact such as a schema, migration, or build script that the user explicitly asked you to produce

## Parameters

- `file_path` (string, required): Absolute path of the file to write. Any parent directories must already exist.
- `content` (string, required): The full text to write to the file. This becomes the entire file body.

## Examples

### Example 1: Create a new helper module
Call `Write` with `file_path: "/Users/me/app/src/utils/slugify.ts"` and provide the implementation as `content`. Use this only after verifying that the file does not already exist.

### Example 2: Regenerate a derived artifact
After the schema source changes, rewrite `/Users/me/app/generated/schema.json` in one `Write` call using the freshly generated JSON as `content`.

### Example 3: Replace a small fixture file
For a throwaway test fixture where every line changes, `Write` can be clearer than a sequence of `Edit` calls. Read the file first, confirm the scope, then overwrite.

## Notes

- Before overwriting an existing file, you must call `Read` on it in the current session. `Write` refuses to clobber unseen content.
- Prefer `Edit` for any change that touches only part of a file. `Edit` sends just the diff, which is faster, safer, and easier to review.
- Do not proactively create Markdown documentation, `README.md`, or changelog files unless the user explicitly asks for them.
- Do not add emoji, marketing copy, or decorative banners unless the user requests that style.
- Verify the parent directory exists first with a `Bash` `ls` call; `Write` does not create intermediate folders.
- Supply the content exactly as you want it persisted; there is no templating or post-processing.
