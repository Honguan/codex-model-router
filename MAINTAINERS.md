# Maintainer Guide

## npm Trusted Publishing setup

This one-time npm account configuration cannot be committed to the repository.

On the npm package settings page for `codex-model-router`, add a GitHub Actions trusted publisher with:

```text
Organization or user: Honguan
Repository: codex-model-router
Workflow filename: release.yml
Environment: leave empty unless the workflow is updated to use one
```

The workflow uses only `contents: write` and `id-token: write`, does not read `NPM_TOKEN`, and publishes with provenance. Remove the old `NPM_TOKEN` repository secret after one Trusted Publishing release succeeds.

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

## Compatibility update checklist

For every release that changes generated paths, TOML fields, models, or Codex integration:

1. Review the official Codex subagent, skill, and configuration references.
2. Record the exact Codex CLI version used as the compatibility baseline.
3. Run the compatibility smoke check in CI.
4. Update README paths and minimum version claims.
5. Test project and global scope separately.
6. Preserve Windows junction, POSIX symlink, LF/CRLF, and user-modification tests.

## Recovery

A failed npm publication does not create a GitHub Release. Fix the Trusted Publisher or workflow problem, then re-run by deleting and recreating the unpublished tag only after verifying that npm does not already contain the version. Published npm versions are immutable and must never be reused.
