# Maintainer Guide

## npm Trusted Publishing setup

The npm package must already have a GitHub Actions trusted publisher configured before a normal release can publish.

On the npm package settings page for `codex-model-router`, configure:

```text
Organization or user: Honguan
Repository: codex-model-router
Workflow filename: release.yml
Environment: leave empty unless the workflow is updated to use one
```

The same relationship can be configured by an authenticated maintainer with npm 11.15.0 or newer:

```sh
npm trust github codex-model-router \
  --repo Honguan/codex-model-router \
  --file release.yml \
  --allow-publish \
  --yes
npm trust list codex-model-router
```

Releases use `contents: write` and `id-token: write`, publish through OIDC, and request npm provenance. The release workflow does not use `NPM_TOKEN`.

## Standard release: create the tag first

Every new release must use the manual `prepare-and-release` action. This creates and verifies the Git tag before the publication job can start.

1. Merge the complete release change into `main`.
2. Confirm `package.json` and the newest `CHANGELOG.md` heading contain the same version.
3. Open **Actions → Release → Run workflow**.
4. Keep the workflow definition branch on `main`.
5. Enter the exact new tag, for example `v2.3.0`.
6. Select `prepare-and-release`.
7. Run the workflow.

The workflow then performs two distinct jobs.

### Job 1: prepare_tag

- Checks out the exact current `origin/main` commit.
- Requires the requested tag to equal `v<package.json version>`.
- Refuses to continue when the remote tag already exists.
- Runs syntax checks, unit tests, packed-package smoke tests, and release metadata validation.
- Creates and pushes the tag only after all validation succeeds.
- Verifies that the remote tag points to the validated `main` commit.
- Contains no npm publication step.

### Job 2: release

- Starts only after `prepare_tag` succeeds.
- Checks out the now-existing exact tag, never `main`.
- Verifies the local and remote tag commits match and that the tag is reachable from `main`.
- Revalidates the package version, tests, and release metadata.
- Publishes through npm Trusted Publishing only when that exact version is not already present.
- Waits for public registry propagation.
- Runs the clean public npm end-to-end verification.
- Creates the GitHub Release only after public verification succeeds.

GitHub does not start a second workflow run for a tag pushed with the workflow `GITHUB_TOKEN`. For that reason the workflow uses two jobs in one run, while still requiring the remote tag to exist before the publication job begins.

## Manual retry for an existing tag

Use a retry only after the exact tag already exists and points to the intended release commit.

1. Open **Actions → Release → Run workflow**.
2. Keep the workflow definition branch on `main`.
3. Enter the existing exact tag.
4. Select `retry-release`.
5. Run the workflow.

A retry:

- Does not create, move, or overwrite tags.
- Fails when the remote tag does not exist.
- Checks out and verifies the exact tag.
- Skips npm publication when the exact version already exists.
- Repeats public registry verification and creates the GitHub Release idempotently.

Do not use `retry-release` to publish unmerged code or a branch name. Never move a tag for a version already published to npm.

## External tag push

A maintainer may also create and push an exact `v*` tag manually after completing the same local checks. A tag push enters the publication job directly and must pass all tag, ancestry, version, test, metadata, npm, and public verification checks.

The preferred and documented path is still `prepare-and-release`, because it validates `main` before creating the tag.

## Release checklist

1. Verify all related Issues and pull-request checks are complete.
2. Update `package.json`, `CHANGELOG.md`, README examples, and shared manifest behavior together.
3. Run `npm run check`, `npm test`, `npm run test:package`, and `npm pack --dry-run`.
4. Confirm CI passes on Windows, Linux, and macOS with Node.js 18, 20, 22, and 24.
5. Confirm actionlint and ShellCheck pass.
6. Confirm npm Trusted Publishing still names `Honguan/codex-model-router` and `release.yml`.
7. Run the Release workflow with the exact new tag and `prepare-and-release`.
8. Confirm `prepare_tag` creates the remote tag before the `release` job starts.
9. Verify npm publication includes provenance.
10. Verify the clean public npm end-to-end step passes before the GitHub Release appears.
11. Confirm `npm view codex-model-router version` and `npx --yes codex-model-router@<version> --version`.

## Compatibility update checklist

For every release that changes generated paths, TOML fields, models, or Codex integration:

1. Review the official Codex subagent, skill, and configuration references.
2. Record the exact Codex CLI version used as the compatibility baseline.
3. Run the compatibility smoke check in CI.
4. Update README paths and minimum version claims.
5. Test project and global scope separately.
6. Preserve Windows junction, POSIX symlink, LF/CRLF, and user-modification tests.

## Recovery

A failed `prepare_tag` job creates no tag and performs no npm publication. Fix the reported validation or test failure, then run `prepare-and-release` again with the same requested new tag.

A failed `release` job may leave the tag present while npm or the GitHub Release is incomplete. Fix the Trusted Publisher, package, registry, or workflow issue and run `retry-release` for that existing tag.

Delete or recreate a tag only when npm does not contain that version and the existing tag is demonstrably wrong. Published npm versions are immutable and their tags must never be moved or reused.
