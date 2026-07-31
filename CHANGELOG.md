# Changelog

## 1.2.0 - 2026-07-31

- Unify package version, defaults, and managed templates into one source of truth.
- Install the current Sol workspace-write template directly and safely migrate known older templates.
- Reject symbolic-link and Windows-junction path escapes before reads or writes.
- Add scope-level process locking with conservative stale-lock recovery.
- Add transaction journals, fault-tested rollback, and conflict-safe interrupted-operation recovery.
- Add exact Codex compatibility and troubleshooting guidance.
- Generate GitHub Release notes from only the current changelog entry.
- Migrate the release workflow to npm Trusted Publishing with provenance.
- Add actionlint and ShellCheck workflow validation.
- Add clean post-publication end-to-end verification from the public npm registry.

## 1.1.1 - 2026-07-31

- Fix npm release workflow shell quoting.
- Upgrade GitHub Actions to Node.js 24-compatible versions.
- Simplify npm installation instructions.
- Improve release reliability and documentation.

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
