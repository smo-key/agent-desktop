## MODIFIED Requirements

### Requirement: A release runbook skill authors the notes and drives the release

The project SHALL provide a `release` skill at `.claude/skills/release/SKILL.md` that carries the whole release procedure for **both** lanes — the stable lane on `main` and the beta lane on `beta` — and the `Release` agent task in `.agent-desktop/tasks.json` SHALL do nothing but invoke it.

The procedure the skill carries SHALL cover: running the quality gate; choosing
the lane and a version valid for it; writing the `## <version> — <date>`
CHANGELOG section for everything since the last release on that lane; bumping
`package.json`; committing and pushing to that lane's branch; and NOT creating
the tag, which CI creates only after every target has built.

The skill SHALL require the release-gate dry run
(`DRY_RUN=1 ./scripts/release-gate.sh`) as a pre-flight **before** the version is
committed, because the gate is the authority on whether a version is releasable
on a lane and its refusal messages name the correct form. A release SHALL NOT be
pushed on a version the dry run refuses.

The task prompt is reduced to an invocation so the procedure has ONE home: a
prompt embedded in `tasks.json` is a single JSON string that cannot be reviewed
in a diff, cannot carry examples, and had already drifted from the pipeline it
describes.

#### Scenario: The task delegates to the skill

- **WHEN** the `Release` task definition is read
- **THEN** its prompt invokes the `release` skill and does not restate the
  release procedure

#### Scenario: The skill covers both lanes

- **WHEN** the `release` skill is read
- **THEN** it distinguishes the stable lane (`main`, suffix-free version) from
  the beta lane (`beta`, single-integer prerelease), and states which branch the
  release is pushed to in each case

#### Scenario: The version is validated before it is committed

- **WHEN** a release is prepared on either lane
- **THEN** the release-gate dry run is run for the intended version and channel
  first, and a version it refuses is corrected rather than pushed

#### Scenario: The skill still defers tagging to CI

- **WHEN** the `release` skill is followed to completion
- **THEN** no `v<version>` tag is created locally; CI creates it only after every
  target has built
