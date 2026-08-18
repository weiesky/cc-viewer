# ListSkills

Lists the user's enabled claude.ai skills, optionally filtered by keyword.

## When to Use

- You need the authoritative list of skills currently enabled — before invoking one, or to confirm what a `SuggestSkills` card added.
- The user asks which skills they have.

## Parameters

- `keywords` (array of strings, optional): Filter the list — up to 8 items, each 1–64 characters. Omit to list everything.

## Examples

### Example 1: List enabled skills

```
ListSkills()
```

### Example 2: Filter by keyword

```
ListSkills(keywords=["review"])
```

## Notes

- If the catalog is unreachable (forbidden), the tool degrades to an empty list with a warning rather than failing.
- This lists *enabled* skills; use `SuggestSkills` to surface skills the user could add.
