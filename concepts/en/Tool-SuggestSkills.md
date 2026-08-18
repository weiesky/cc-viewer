# SuggestSkills

Renders a card of standalone skills the user can add (skills that are not yet enabled), based on topic keywords.

## When to Use

- The user's request matches skills they don't have enabled (`trigger="user_asked"` when they asked, `trigger="proactive"` when you suggest unprompted).

## Parameters

- `keywords` (array of strings, required): Topic keywords from the user's request. 1–8 items, each 1–64 characters.
- `contextLabel` (string, optional): Short label tying the suggestion to the request (max 128 characters).
- `trigger` (string, optional): How this suggestion started — `user_asked` or `proactive`.

## Examples

### Example 1: Suggest skills by topic

```
SuggestSkills(keywords=["data visualization", "charts"], contextLabel="For building the dashboard", trigger="user_asked")
```

Already-enabled skills are filtered out of the result.

## Notes

- Renders a suggestion card only — adding a skill happens out of band; call `ListSkills` afterwards to confirm.
- Disabled under HIPAA enterprise configurations.
