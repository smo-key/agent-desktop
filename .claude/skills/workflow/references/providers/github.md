# Provider: github

Uses the `gh` CLI against `github.project: "owner/repo"`. Requires `gh auth
status` to be logged in with `project` scope. If a command fails, follow the
Errors guidance in `../providers.md`.

`ref` format: `owner/repo#NUMBER` (issue). The Project (v2) board is the owner's
board that contains the issue; its single-select **Status** field holds the
workflow status.

- **resolve(ref)** — parse `owner/repo#N`, then:
  ```bash
  gh issue view N --repo owner/repo --json title,body,url,state
  ```
  Return `{ title, description: body, status: state, url }`.

- **list_open()** — open issues assigned to the user:
  ```bash
  gh issue list --repo owner/repo --state open --assignee @me \
    --json number,title --limit 30
  ```
  Map to `{ ref: "owner/repo#"+number, title, status: "open" }`.

- **set_status(ref, st)** — set the Project Status field for the issue. Resolve
  the project, item, field, and option ids, then edit:
  ```bash
  # 1. find the project number for the owner
  gh project list --owner OWNER --format json
  # 2. find the item id for this issue within the project
  gh project item-list NUMBER --owner OWNER --format json   # match content.url to the issue
  # 3. find the Status field id and the option id whose name == st
  gh project field-list NUMBER --owner OWNER --format json
  # 4. apply
  gh project item-edit --id ITEM_ID --field-id FIELD_ID \
     --project-id PROJECT_ID --single-select-option-id OPTION_ID
  ```
  If the issue is not on any project board, report it and treat as untracked.

- **create(title, desc)** —
  ```bash
  gh issue create --repo owner/repo --title "TITLE" --body "DESC" \
    --assignee @me
  ```
  Capture the printed URL; derive `ref` as `owner/repo#N` from it. Adding the new
  issue to the project board (so `set_status` works) is optional — if the board
  has a workflow that auto-adds issues, nothing more is needed; otherwise
  `gh project item-add NUMBER --owner OWNER --url <issue-url>`.

## Verify your setup (dry run)

```bash
gh auth status
gh issue list --repo owner/repo --state open --limit 1
```
