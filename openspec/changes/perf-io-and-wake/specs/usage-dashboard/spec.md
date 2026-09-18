## ADDED Requirements

### Requirement: Snapshot git status is reused within a TTL
The statusline wrapper SHALL reuse the git status recorded in the pane's previous snapshot, instead of running git, while that status is for the same working directory and younger than a TTL (default 10 s, stamped as `git.checked_at` in epoch seconds when git was actually run; `AGENT_DESKTOP_GIT_TTL_SECS` overrides it and `0` disables reuse). Any doubt — no previous snapshot, a different directory, a clock that went backwards, unreadable JSON — SHALL fall through to a fresh status.

#### Scenario: Git status is reused within the TTL and refreshed after it
- **WHEN** the wrapper runs twice for the same pane and directory inside the TTL and the working tree changed in between
- **THEN** the second snapshot carries the first one's git status and `checked_at`; with the TTL disabled the change is reported, and a run for a different directory never reuses another directory's status
