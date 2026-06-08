# Tasks

- [x] 1.1 Reword `TITLE_SYSTEM_PROMPT` in `polish.rs`: include a ticket/issue id
  only when one appears in the messages (never invent/copy); replace the `SKIPA-45`
  example with generic `PROJ-45` / `#45` formats.
- [x] 1.2 Add a unit test locking the fix (no `SKIPA`, has `PROJ-45` + `#45`,
  "only if" / "never invent" constraints present); keep the existing prompt test
  green. Run `cargo test --lib polish::`.
