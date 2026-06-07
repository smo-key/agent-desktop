# Provider: local

No external tracker. Used when `provider: local` (the scaffold default) or when
the user declines to file a free-form task.

- **resolve(ref)** — there is nothing to fetch. `ref` is a short kebab slug
  derived from the task description (it usually equals the change name). Return
  `{ title: <description first line>, description: <the text>, status: "", url: "" }`.
- **list_open()** — read `openspec/changes/*/` (excluding `archive/`). Each
  un-archived change is a candidate; return `{ ref: <change-name>, title:
  <proposal.md first heading>, status: <workflow.json.lastEvent or ""> }`.
- **set_status(ref, st)** — no external system. Record it: set `lastEvent` in the
  change's `workflow.json` (the status string itself is informational only). Do
  not print noise on every call.
- **create(title, desc)** — nothing to create remotely; the OpenSpec change *is*
  the record. Return `{ ref: <change-name>, url: "" }`.

No credentials, network, or CLI required.
