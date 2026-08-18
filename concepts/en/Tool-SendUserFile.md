# SendUserFile

Sends one or more files to the user — generated artifacts, screenshots, reports — with control over how the client presents them.

## When to Use

- You produced a file the user needs (a report, an image, an HTML page) and want to surface it, not just mention its path.
- Replying with an attachment (`status="normal"`), or proactively surfacing something the user hasn't asked for but needs to see now (`status="proactive"`).

## Parameters

- `files` (array of strings, required): File paths (absolute or relative to cwd) to send to the user. Always pass an array, even for a single file.
- `caption` (string, optional): Short caption for the file(s).
- `status` (string, required): `proactive` when surfacing a file the user hasn't asked for and needs to see now — a generated artifact, a completed report; `normal` when replying to something the user just said.
- `display` (string, optional): `render` opens the file inline in the side panel (HTML, SVG, Mermaid, images, PDFs); `attach` shows a download card only (deliverables the user will save and open elsewhere). Omit to let the client decide by file type.

## Examples

### Example 1: Deliver a generated report

```
SendUserFile(
  files=["./out/weekly-report.html"],
  caption="Weekly usage report",
  status="proactive",
  display="render"
)
```

## Notes

- Requires the session to allow sending files (a settings/feature-gated capability); not offered in brief mode.
- Choose `display="attach"` for files the user saves and opens in another app; `render` for anything they should look at immediately.
