# Provider: jira

Jira Cloud REST API v3 via `curl`. Reads `jira.baseUrl` and `jira.projectKey`
from `.claude/workflow.yaml`; auth from env `JIRA_EMAIL` and `JIRA_API_TOKEN`
(basic auth). If either env var is unset, follow the Errors guidance in
`../providers.md` (offer untracked or stop).

`ref` format: an issue key like `PROJ-123`.

Common auth prefix (used in every call):
```bash
AUTH="-u ${JIRA_EMAIL}:${JIRA_API_TOKEN}"
BASE="${JIRA_BASEURL}"   # from config jira.baseUrl
```

- **resolve(ref)** —
  ```bash
  curl -s $AUTH "$BASE/rest/api/3/issue/PROJ-123?fields=summary,description,status" \
    -H "Accept: application/json"
  ```
  Return `{ title: fields.summary, description: fields.description,
  status: fields.status.name, url: "$BASE/browse/PROJ-123" }`.

- **list_open()** — JQL for the user's open issues in the project:
  ```bash
  curl -s $AUTH -G "$BASE/rest/api/3/search" \
    --data-urlencode 'jql=project=PROJ AND assignee=currentUser() AND statusCategory!=Done ORDER BY updated DESC' \
    --data-urlencode 'fields=summary,status' --data-urlencode 'maxResults=30' \
    -H "Accept: application/json"
  ```
  Map issues to `{ ref: key, title: fields.summary, status: fields.status.name }`.

- **set_status(ref, st)** — Jira moves status via *transitions*, not direct
  writes. Find the transition whose target status name equals `st`, then POST it:
  ```bash
  # 1. list available transitions
  curl -s $AUTH "$BASE/rest/api/3/issue/PROJ-123/transitions" -H "Accept: application/json"
  # 2. pick the transition where .transitions[].to.name == st  -> TRANSITION_ID
  # 3. apply
  curl -s $AUTH -X POST "$BASE/rest/api/3/issue/PROJ-123/transitions" \
    -H "Content-Type: application/json" \
    -d '{"transition":{"id":"TRANSITION_ID"}}'
  ```
  If no transition leads to `st` from the current status, report it (the Jira
  workflow may not allow that move) and continue untracked for this event.

- **create(title, desc)** —
  ```bash
  curl -s $AUTH -X POST "$BASE/rest/api/3/issue" \
    -H "Content-Type: application/json" \
    -d '{"fields":{"project":{"key":"PROJ"},"summary":"TITLE",
         "description":{"type":"doc","version":1,"content":[{"type":"paragraph",
         "content":[{"type":"text","text":"DESC"}]}]},
         "issuetype":{"name":"Task"}}}'
  ```
  Return `{ ref: <key from response>, url: "$BASE/browse/<key>" }`.

## Verify your setup (dry run)

```bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "$JIRA_BASEURL/rest/api/3/myself" -H "Accept: application/json"
```
Expected: your account JSON (not 401).
