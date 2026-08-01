# Maintainer Guide

## First npm publication bootstrap

The first publication of a new npm package cannot use Trusted Publishing because the npm package settings do not exist yet. Use the Release workflow's explicit `bootstrap` publication mode exactly once.

The bootstrap token must be a granular npm access token with package read/write access and non-interactive publishing permission. Store it only as the GitHub Actions repository secret named `NPM_TOKEN`; never commit it to the repository or write it into workflow logs.

For the first publication:

1. Open **Actions → Release → Run workflow**.
2. Keep the workflow definition branch on `main`.
3. Enter the exact version tag required by `package.json`, for example `v1.2.0`.
4. Select `bootstrap` for `publish_mode`.
5. Run the workflow.

The tag may already exist. When it does, the workflow checks out that exact tag and verifies that it is reachable from `main`.

When the tag does not yet exist, a manual bootstrap run starts from the exact current `origin/main` commit, verifies the requested tag matches `v<package.json version>`, runs all tests, validates the release metadata and current Changelog entry, and only then creates and pushes the tag. Normal mode and tag-triggered runs are never allowed to create a missing tag.

Bootstrap mode is rejected when the npm package or exact version already exists. The token is exposed only to the guarded bootstrap step. Tag-triggered releases and manual runs in `normal` mode never receive `NPM_TOKEN`.

After the first version is published, configure Trusted Publishing as described below. Once a later release succeeds through OIDC, delete the `NPM_TOKEN` repository secret.

## npm Trusted Publishing setup

This one-time npm account configuration cannot be committed to the repository.

On the npm package settings page for `codex-model-router`, add a GitHub Actions trusted publisher with:

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

Normal releases use only `contents: write` and `id-token: write` and publish with provenance.

## Release checklist

1. Verify all Issues and pull-request checks are complete.
2. Update `package.json`, `CHANGELOG.md`, README version examples, and the shared manifest behavior together.
3. Run `npm run check`, `npm test`, `npm run test:package`, and `npm pack --dry-run`.
4. Confirm CI passes on Windows, Linux, and macOS with Node.js 18, 20, 22, and 24.
5. Confirm actionlint and ShellCheck pass.
6. For normal releases, create and push the exact tag `v<package.json version>` from `main`.
7. For the first package publication only, the manual bootstrap flow may create the missing exact tag after all validations pass.
8. Verify the Release workflow publishes with npm provenance.
9. Verify the clean public npm end-to-end step passes before the GitHub Release appears.
10. Confirm `npm view codex-model-router version` and `npx --yes codex-model-router@<version> --version`.

## Manual release retry

Open **Actions → Release → Run workflow**, keep the workflow definition on `main`, and enter the exact version tag in the required `tag` field.

Select publication mode as follows:

- `bootstrap`: only for the first creation of the npm package; it may safely create the missing exact version tag from current `main` after validation.
- `normal`: every later version and every idempotent retry after the package exists; the tag must already exist.

The branch selector chooses which workflow definition to run; it is not the release target. For an existing tag, the workflow checks out that tag, verifies that its commit is reachable from `main`, validates that the tag matches `package.json`, and then resumes the npm and GitHub Release checks.

Never enter a branch name in the `tag` field. Never reuse a package version that already exists on npm. Never use bootstrap mode for later versions.

## Compatibility update checklist

For every release that changes generated paths, TOML fields, models, or Codex integration:

1. Review the official Codex subagent, skill, and configuration references.
2. Record the exact Codex CLI version used as the compatibility baseline.
3. Run the compatibility smoke check in CI.
4. Update README paths and minimum version claims.
5. Test project and global scope separately.
6. Preserve Windows junction, POSIX symlink, LF/CRLF, and user-modification tests.

## Recovery

A failed npm publication does not create a GitHub Release. For an unpublished package, verify the `NPM_TOKEN` bootstrap secret and run the exact version with `publish_mode=bootstrap`; the workflow can create the missing tag safely when necessary. For an existing package, fix the Trusted Publisher relationship and retry the existing exact tag with `publish_mode=normal`.

Delete or recreate a tag manually only when npm does not contain that version and the existing tag is demonstrably wrong. Published npm versions are immutable and must never be reused.
