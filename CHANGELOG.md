# Changelog

## 1.1.1 - 2026-07-31

- Fix Bash quoting in the npm release workflow.
- Upgrade GitHub Actions to Node.js 24-compatible releases.
- Publish only from version tags or an explicit manual workflow run.
- Publish and verify the npm package before creating the GitHub Release.
- Add release-tag and package-version consistency checks.
- Improve npm installation, project/global scope, safety, and recovery documentation.
- Add package discovery metadata and a private security-reporting policy.
- Verify that the packed CLI version matches `package.json`.

## 1.1.0 - 2026-07-31

- Change Sol from read-only review to `workspace-write` review and implementation when explicitly delegated.
- Preserve review-first routing while allowing Sol to apply confirmed high-risk fixes.
- Add safe migration from managed 1.0.0 Sol and skill templates.
- Add npm publication metadata and concise publishing instructions.

## 1.0.0 - 2026-07-31

- Safely patch real-world Codex TOML while preserving comments, BOM, and line endings.
- Add reversible `--set-default` support for Terra/high.
- Add idempotent install and uninstall state cleanup.
- Expand `doctor` validation for config, agents, skill, backup, hashes, and unsafe paths.
- Add zero-write `--dry-run` previews.
- Add Windows, Linux, and macOS CI plus packed-package smoke tests.
- Document project/global installation, manual overrides, recovery, and routing limits.
