# Maintainer Guide

## Standard release flow

Use the Release workflow as the normal way to create the version tag and publish a release.

1. Merge the release changes into `main`.
2. Confirm `package.json` and the current `CHANGELOG.md` entry use the intended version.
3. Open **Actions → Release → Run workflow**.
4. Keep the workflow definition branch on `main`.
5. Enter the exact tag `v<package.json version>`, for example `v2.3.0`.
6. Select `normal` for `publish_mode`.
7. Run the workflow.

When the requested tag does not exist, the workflow starts from the exact current `origin/main` commit, verifies the requested tag against `package.json`, runs syntax checks, tests, the packed-package smoke test, and release metadata validation, then creates and pushes the tag. It checks out and verifies that exact tag before inspecting or publishing npm.

When the tag already exists, the workflow treats it as immutable, verifies that it is reachable from `main`, checks that its package version matches the tag, and resumes the idempotent npm and GitHub Release checks.

Tag-triggered runs remain supported, but the tag must already exist. Manual Release runs are the preferred path because they validate the current `main` commit before creating the tag.

## First npm publication bootstrap

The first publication of a new npm package cannot use Trusted Publishing because the npm package settings do not exist yet. Use the Release workflow's explicit `bootstrap` publication mode exactly once.

The bootstrap token must be a granular npm access token with package read/write access and non-interactive publishing permission. Store it only as the GitHub Actions repository secret named `NPM_TOKEN`; never commit it to the repository or write it into workflow logs.

For the first publication:

1. Open **Actions → Release → Run workflow**.
2. Keep the workflow definition branch on `main`.
3. Enter the exact tag required by `package.json`.
4. Select `bootstrap` for `publish_mode`.
5. Run the workflow.

The same tag-first validation applies: checks complete before the workflow creates and pushes a missing tag, and npm publication begins only after the exact tag is checked out and verified.

Bootstrap mode is rejected when the npm package or exact version already exists. The token is exposed only to the guarded bootstrap publication step. Tag-triggered releases and manual runs in `normal` mode never receive `NPM_TOKEN`.

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
2. Update `package.json`, `CHANGELOG.md`, README version examples, and shared manifest behavior together.
3. Run `npm run check`, `npm test`, `npm run test:package`, and `npm pack --dry-run`.
4. Confirm CI passes on Windows, Linux, and macOS with Node.js 18, 20, 22, and 24.
5. Confirm actionlint and ShellCheck pass.
6. Run the Release workflow manually from `main` with the exact `v<package.json version>` tag and `publish_mode=normal`.
7. Confirm the workflow creates or verifies the tag before the npm inspection and publication steps.
8. Verify npm publication includes provenance.
9. Verify the clean public npm end-to-end step passes before the GitHub Release appears.
10. Confirm `npm view codex-model-router version` and `npx --yes codex-model-router@<version> --version`.

## Manual release retry

Open **Actions → Release → Run workflow**, keep the workflow definition on `main`, and enter the exact version tag in the required `tag` field.

Select publication mode as follows:

- `bootstrap`: only for the first creation of the npm package.
- `normal`: every later version and every idempotent retry after the package exists.

A missing tag may be created by either manual mode after all checks pass. Publication mode controls npm authentication, not tag creation. An existing tag is never moved.

The branch selector chooses which workflow definition to run; it is not the release target. The workflow either validates the existing tag or creates the missing exact tag from current `main`, then checks out that exact tag before npm publication.

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

A failed npm publication leaves the validated version tag in place but does not create a GitHub Release. Fix the npm authentication or Trusted Publisher relationship, then rerun the exact existing tag with the correct publication mode. The workflow will verify the tag, skip an already-published npm version when applicable, repeat public end-to-end verification, and create the missing GitHub Release.

Delete or recreate a tag manually only when npm does not contain that version and the existing tag is demonstrably wrong. Published npm versions are immutable and must never be reused.
