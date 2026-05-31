## ADDED Requirements

### Requirement: Workflow Capability Detection
The system SHALL classify a repository as workflow-capable if and only if at least one of `<repo>/.claude/commands/workflow/` or `<repo>/.claude/skills/workflow/` exists as a directory, and SHALL render the read-only Workflow board for that repo only when it is so classified.

#### Scenario: Repo with workflow skills directory is detected
- **WHEN** a pane's repo contains `<repo>/.claude/skills/workflow/` (e.g. the skipa repo, which holds `next.sh`, `epics.sh`, `issues.sh`, and `jira.sh`)
- **THEN** the app marks the repo workflow-capable and offers the Workflow board for that repo

#### Scenario: Repo with only the commands directory is detected
- **WHEN** a repo contains `<repo>/.claude/commands/workflow/` but no `<repo>/.claude/skills/workflow/`
- **THEN** the app still marks the repo workflow-capable

#### Scenario: Repo without workflow tooling shows no board
- **WHEN** a repo has neither `<repo>/.claude/commands/workflow/` nor `<repo>/.claude/skills/workflow/`
- **THEN** the app does not render a Workflow board and does not attempt to run any workflow script for that repo

### Requirement: Run Repo Scripts Read-Only With Repo As Working Directory
The system SHALL execute the target repo's own copy of `next.sh`, `epics.sh`, and `issues.sh` with the child process working directory set to the repo root, and SHALL never substitute an app-bundled or other-repo copy, because each repo's scripts carry repo-specific constants (e.g. `JIRA_PROJECT_KEY="SKIPA"`) and resolve auth via `git rev-parse --show-toplevel`.

#### Scenario: Scripts run from the repo's own path with cwd = repo
- **WHEN** the board loads for `<repo>`
- **THEN** the app spawns `<repo>/.claude/skills/workflow/<script>` with the child process working directory set to `<repo>`
- **AND** it does not run any app-bundled or other-repo copy of the script

#### Scenario: Repo-specific auth resolves against the running repo
- **WHEN** a workflow script invokes `git rev-parse --show-toplevel` to locate `.claude/settings.local.json`
- **THEN** because cwd is the repo root, the resolved settings file is `<repo>/.claude/settings.local.json`

### Requirement: Render next.sh Markdown Output Directly
The system SHALL treat the stdout of `next.sh [epic]` as Markdown and render it directly, without expecting or parsing a temp-file path from it.

#### Scenario: next.sh stdout rendered as markdown
- **WHEN** `next.sh` exits 0 and prints Markdown to stdout
- **THEN** the app renders that stdout as the board's "next" view as Markdown

#### Scenario: next.sh scoped to an epic
- **WHEN** the user scopes the board to an epic key `<KEY>`
- **THEN** the app runs `next.sh <KEY>` and renders its Markdown stdout

### Requirement: Parse Temp-File-Path JSON Outputs
The system SHALL treat the single line printed by `epics.sh list`, `epics.sh get <key>`, `issues.sh <feature|task|bug|request> list`, and `issues.sh <feature|task|bug|request> get <key>` as a filesystem path to a temp JSON file (the `jira_output` pattern), and SHALL read and JSON-parse that file rather than parsing the stdout line itself.

#### Scenario: list output parsed from the referenced temp file
- **WHEN** `epics.sh list` prints a path such as `${TMPDIR}/jira_<pid>_<ns>.json` and exits 0
- **THEN** the app reads that file and parses an array of `{key, summary, status, type?, epic?}` objects

#### Scenario: epic get output parsed with children rollup
- **WHEN** `epics.sh get <key>` succeeds
- **THEN** the parsed object exposes `{key, summary, status, children:{total, by_status:[{status,count}], issues:[…]}}`

#### Scenario: issue get adds assignee and link fields
- **WHEN** `issues.sh <type> get <key>` succeeds
- **THEN** the parsed object additionally exposes `assignee` as `{account_id, display_name}` or `null`, plus `subtasks[]`, `blocked_by[]`, and `blocks[]`

### Requirement: Read-Only Guarantee — No Write Verbs
The system SHALL invoke only the read verbs `next.sh`, `<script> list`, and `<script> get`, and SHALL never invoke `create`, `update`, `transition`, `rank`, or `delete`, even though `issues.sh` exposes those write verbs in the same CLI dispatch, in order to preserve closure-ownership (the user runs the slash commands themselves).

#### Scenario: Write verbs are never spawned
- **WHEN** the board renders or refreshes for any repo
- **THEN** every workflow process the app spawns is either `next.sh` or uses a command verb of `list` or `get`
- **AND** no spawned process passes `create`, `update`, `transition`, `rank`, or `delete`

#### Scenario: No automatic slash-command execution
- **WHEN** the user views the board
- **THEN** the app does not auto-run any `/workflow:*` slash command, leaving closure and transition actions to the user

### Requirement: Surface Auth And Exit-Code Errors
The system SHALL check each workflow script's exit code and, on a nonzero exit (e.g. missing `.claude/settings.local.json`, or empty `.env.JIRA_USER_EMAIL`/`.env.JIRA_API_TOKEN`, for which the scripts print `ERROR:` to stderr and exit 1), SHALL surface a per-repo error showing the captured stderr instead of rendering a blank or partial board.

#### Scenario: Missing settings file surfaces an error
- **WHEN** a workflow script exits nonzero because `<repo>/.claude/settings.local.json` is absent and prints `ERROR: settings.local.json not found ...` to stderr
- **THEN** the app shows that error message for the repo and does not show an empty board

#### Scenario: Empty token surfaces an error
- **WHEN** `.env.JIRA_USER_EMAIL` or `.env.JIRA_API_TOKEN` is empty so the script exits 1 with `ERROR: JIRA_USER_EMAIL or JIRA_API_TOKEN not found ...`
- **THEN** the app surfaces the auth error for the repo rather than a blank board

### Requirement: Temp-File Cleanup
The system SHALL delete each `jira_output` temp JSON file it reads after parsing it, including on parse failure, and SHALL not leak `jira_*` or `workflow_next_*` artifacts from board operations.

#### Scenario: Temp JSON deleted after successful parse
- **WHEN** the app reads and parses the temp file named by a `list` or `get` invocation
- **THEN** the app deletes that temp file after parsing

#### Scenario: Temp JSON deleted on parse failure
- **WHEN** the temp file named by a `list` or `get` invocation cannot be parsed as JSON
- **THEN** the app surfaces an error AND still deletes the temp file so it does not leak

### Requirement: On-Demand Board Refresh
The system SHALL re-run the relevant read-only scripts and re-render the board when the user requests a refresh, replacing the previously displayed data with freshly fetched results.

#### Scenario: Refresh re-runs the read scripts
- **WHEN** the user triggers a refresh of the board for `<repo>`
- **THEN** the app re-executes the applicable read verbs (`next.sh`, `list`, or `get`) with cwd = `<repo>` and replaces the displayed data with the new results
