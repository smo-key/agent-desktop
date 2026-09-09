## 1. Workflow

- [x] 1.1 `gate`: drop `git tag`/`git push <tag>` from the sync step; export `release_sha`
- [x] 1.2 `create-release`: delete stale drafts for the tag, fail on a published one, pin `target_commitish` to `release_sha`
- [x] 1.3 `build`: check out `release_sha` instead of the tag
- [x] 1.4 `publish-release`: check out `release_sha`, create + push the annotated tag, then undraft
- [x] 1.5 Update header/job comments and README "Releases" section; `actionlint` passes

## 2. Specs

- [x] 2.1 Delta for `release-pipeline` (tag-after-build, retryable failed attempts)
- [x] 2.2 Rebase the `windows-x64-support` delta's "Single GitHub Release" requirement onto the new wording so archiving it later does not revert this change
