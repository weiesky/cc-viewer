# Glob

Matches filenames against a glob pattern and returns the paths sorted by most recent modification time first. Optimized for locating files quickly in codebases of any size without shelling out to `find`.

## When to Use

- Enumerating every file of a specific extension (for example, all `*.ts` files under `src`)
- Discovering configuration or fixture files by naming convention (`**/jest.config.*`, `**/*.test.tsx`)
- Narrowing a search surface before running a targeted `Grep`
- Checking whether a file already exists at a known pattern before calling `Write`
- Finding recently touched files by relying on the modification-time ordering

## Parameters

- `pattern` (string, required): The glob expression to match. Supports `*` for single-segment wildcards, `**` for recursive matches, and `{a,b}` for alternatives, for example `src/**/*.{ts,tsx}`.
- `path` (string, optional): Directory in which to run the search. Must be a valid directory path when provided. Omit the field entirely to search the current working directory. Do not pass the strings `"undefined"` or `"null"`.

## Examples

### Example 1: Every TypeScript source file
Call `Glob` with `pattern: "src/**/*.ts"`. The result is a mtime-sorted list, so the most recently edited files appear first, which is useful for focusing on hot spots.

### Example 2: Locate a class definition candidate
When you suspect a class lives in a file whose name you do not know, search with `pattern: "**/*UserService*"` to narrow the candidates, then follow up with `Read` or `Grep`.

### Example 3: Parallel discovery before a larger task
In a single message, issue multiple `Glob` calls (for example one for `**/*.test.ts` and one for `**/fixtures/**`) so both run in parallel and their results can be correlated.

## Notes

- Results are ordered by file modification time (newest first), not alphabetically. Sort downstream if you need stable ordering.
- Patterns are evaluated by the tool, not by the shell; you do not need to quote or escape them as you would on the command line.
- For open-ended exploration that requires multiple rounds of searching and reasoning, delegate to an `Agent` with the Explore agent type instead of chaining many `Glob` calls.
- Prefer `Glob` over `Bash` invocations of `find` or `ls` for filename discovery; it handles permissions consistently and returns structured output.
- When looking for content inside files rather than filenames, use `Grep` instead.
