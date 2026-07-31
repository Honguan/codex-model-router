# Maintainer Guide

## First npm publication bootstrap

The first publication of a new npm package cannot use Trusted Publishing because the npm package settings do not exist yet. Use the Release workflow's explicit `bootstrap` publication mode exactly once.

The bootstrap token must be a granular npm access token with package read/write access and non-interactive publishing permission. Store it only as the GitHub Actions repository secret named `NPM_TOKEN`; never commit it to the repository or write it into workflow logs.

For the first publication:

1. Open **Actions → Release → Run workflow**.
2. Keep the workflow definition branch on `main`.
3. Enter the exact existing tag, for example `v1.2.0`.
4. Select `bootstrap` for `publish_mode`.
5. Run the workflow.

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
6. Create and push the exact tag `v<package.json version>` from `main`.
7. Verify the Release workflow publishes with npm provenance.
8. Verify the clean public npm end-to-end step passes before the GitHub Release appears.
9. Confirm `npm view codex-model-router version` and `npx --yes codex-model-router@<version> --version`.

## Manual release retry

Open **Actions → Release → Run workflow**, keep the workflow definition on `main`, and enter the exact existing version tag in the required `tag` field.

Select publication mode as follows:

- `bootstrap`: only for the first creation of the npm package.
- `normal`: every later version and every idempotent retry after the package exists.

The branch selector chooses which workflow definition to run; it is not the release target. The workflow checks out the entered tag, verifies that its commit is reachable from `main`, validates that the tag matches `package.json`, and then resumes the npm and GitHub Release checks.

Never enter a branch name in the `tag` field. Never reuse a package version that already exists on npm.

## Compatibility update checklist

For every release that changes generated paths, TOML fields, models, or Codex integration:

1. Review the official Codex subagent, skill, and configuration references.
2. Record the exact Codex CLI version used as the compatibility baseline.
3. Run the compatibility smoke check in CI.
4. Update README paths and minimum version claims.
5. Test project and global scope separately.
6. Preserve Windows junction, POSIX symlink, LF/CRLF, and user-modification tests.

## Recovery

A failed npm publication does not create a GitHub Release. For an unpublished package, verify the `NPM_TOKEN` bootstrap secret and retry the exact tag with `publish_mode=bootstrap`. For an existing package, fix the Trusted Publisher relationship and retry the exact tag with `publish_mode=normal`. Delete and recreate a tag only when it was never published, points to the wrong commit, and npm does not already contain that version. Published npm versions are immutable and must never be reused.
