# Changelog

## 2.3.0 - 2026-08-02

- Add `enable`, `disable`, and `status` as the preferred user-facing lifecycle commands.
- Keep `install`, `uninstall`, and `doctor` as backward-compatible aliases.
- Support all install options, including reasoning overrides and `--set-default`, through `enable`.
- Make `disable` remove only unchanged package-managed routing and unchanged package-managed V2 configuration.
- Rewrite README installation, global scope, status, V2, and removal instructions around `npx codex-model-router`.
- Add lifecycle, help-output, and packed-package coverage for the npx-first commands.

## 2.2.0 - 2026-08-01

- Add explicit `v2 enable`, `v2 disable`, and `v2 status` commands for the undocumented Codex multi-agent V2 setting.
- Keep experimental V2 disabled during every normal install and preserve all pre-existing V2 configuration.
- Track only the exact marked V2 block created by this package and remove it automatically during uninstall when unchanged.
- Preserve unrelated UTF-8 BOM, comments, ordering, and LF/CRLF content while using the shared scope lock and atomic replacement.
- Report managed, disabled, unmanaged, missing, untracked, invalid, and user-modified V2 states.
- Document that experimental V2 does not guarantee the effective child-agent model and is outside compatibility guarantees.

## 2.1.0 - 2026-08-01

- Change Luna's default reasoning effort from max to xhigh.
- Add install-time reasoning controls for all managed agents or individual Terra, Luna, and Sol agents.
- Preserve package-managed custom reasoning values across later installs while retaining user-modified file protection.
- Validate supported GPT-5.6 reasoning efforts before any filesystem writes.

## 2.0.0 - 2026-08-01

- Keep the user-selected primary model unchanged by default; Terra/high is now explicit through --set-default only.
- Add a fixed Terra/high planning and verification agent while preserving existing specialized agents.
- Promote Luna to max reasoning for most clear, bounded implementation work.
- Restrict Sol/medium to read-only last-resort logic rescue after Terra investigation and replanning fail.
- Split compact routing guidance from the progressively loaded implementation-planning skill.
- Add plan conformance versus requirement correctness checks, local correction versus replanning, and bounded iteration rules.
- Add cache-friendly same-thread deltas and self-contained snapshots for new agent threads.
- Migrate recognized 1.x managed templates without overwriting user-modified files.

## 1.2.0 - 2026-07-31

- Unify package version, defaults, and managed templates into one source of truth.
- Install the current Sol workspace-write template directly and safely migrate known older templates.
- Reject symbolic-link and Windows-junction path escapes before reads or writes.
- Add scope-level process locking with conservative stale-lock recovery.
- Add transaction journals, fault-tested rollback, and conflict-safe interrupted-operation recovery.
- Add exact Codex compatibility and troubleshooting guidance.
- Generate GitHub Release notes from only the current changelog entry.
- Migrate the release workflow to npm Trusted Publishing with provenance.
- Require an explicit version tag for manual Release retries and verify that tag against `main`.
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
