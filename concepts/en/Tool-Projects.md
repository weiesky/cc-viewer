# Projects

Manages project documents in the user's Claude project knowledge base: read, search, write, and delete docs, or fetch project info.

## When to Use

- Persist a document (deliverable, notes, reference material) into the user's project so it survives the session.
- Read or search existing project docs to ground the current task in prior context.
- Upload a local file into the project without loading its contents into context.
- Remove an outdated project doc.

## Parameters

- `method` (string, required): One of `project_info`, `project_read`, `project_search`, `project_write`, `project_delete`.
- `path` (string, optional): For `project_read`/`project_write`/`project_delete`: the doc path. For `project_write`: an existing path is replaced in place; a new bare filename (no "/") is namespaced to `claude/<name>`.
- `content` (string, optional): For `project_write`: inline doc text. Mutually exclusive with `local_path`.
- `local_path` (string, optional): For `project_write`: a file inside the working directory to upload — contents never enter your context. Mutually exclusive with `content`.
- `present_to_user` (boolean, optional): For `project_write`: mark this doc as the deliverable the user needs to see. Defaults to false; leave unset for routine saves and bulk writes.
- `query` (string, optional): For `project_search`: knowledge-base query.
- `n` (number, optional): For `project_search`: number of hits (default 5).

## Examples

### Example 1: Write the deliverable into the project

```
Projects(
  method="project_write",
  path="claude/migration-plan.md",
  local_path="./migration-plan.md",
  present_to_user=true
)
```

Uploads the local file without pulling its content into context, and flags it as the user's deliverable.

### Example 2: Search the knowledge base

```
Projects(method="project_search", query="authentication refresh tokens", n=5)
```

## Notes

- `content` is for text you compose inline; `local_path` is for anything already on disk — never mix the two.
- Use `present_to_user=true` sparingly: only for the one doc the user asked for or must act on.
