# Changelog

## 3.0.7 - 2026-08-03

- Define deterministic plan-artifact ownership, persistence, cleanup, and failure reporting for each workflow stage.
- Store each plan at the selected Codex scope under `model-router/workflows/<workflow_id>/PLAN.md` instead of the source tree.
- Keep Terra and pre-takeover Sol as plan-content authors and reviewers while the active writable executor persists and removes artifacts.
- Preserve plan ownership across blocked work, session recovery, replacement, cancellation, and primary-model switches.
- Add English and Traditional Chinese lifecycle documentation with version-controlled Mermaid flowcharts.

## 3.0.6 - 2026-08-02

- Install project and current-user skills under the applicable `.codex/skills/<skill-name>` directory instead of `.agents/skills`.
- Safely migrate unchanged or user-modified package-managed skills from the legacy `.agents/skills` location during reinstall.
- Restore a missing package-managed V2 marker block when `install --v2` is explicitly requested, while preserving unrelated TOML.
- Update installation-path reporting, documentation, package smoke coverage, and project/global regression tests.

## 3.0.5 - 2026-08-02

- Print the full resolved file path for every managed install, update, migration, preservation, skip, repair, and removal message.
- Replace ambiguous lifecycle aliases such as `terra`, `skill`, `planning`, and `state` with their exact Codex or user-skill file paths.
- Report package-managed V2 changes against the exact `config.toml` and `model-router-v2-state.json` paths.
- Keep empty-directory cleanup output path-based so users can see every directory considered for removal.
- Add global install and uninstall regression coverage for all managed files and key cleanup directories.

## 3.0.4 - 2026-08-02

- Repair a changed package-managed V2 marker block when `install --v2` is explicitly requested again.
- Preserve all TOML outside the marked V2 block while updating the managed state hash atomically.
- Continue preserving modified V2 during plain `install` and `uninstall` when repair was not explicitly requested.
- Print the resolved Codex agent and user-skill installation paths after a successful install.
- Clarify that custom Codex skills belong in `.agents/skills` while `.codex/skills/.system` is reserved for bundled skills.
- Add project and global regression coverage for V2 repair and installation-path reporting.

## 3.0.3 - 2026-08-02

- Validate project and global scope before V2 reads its managed state file.
- Prevent home-directory project commands from misreading an existing global V2 installation.
- Return the actionable project-scope error instead of `experimental V2 state scope mismatch`.
- Preserve existing global V2 state and configuration when an invalid project command is attempted.
- Add Windows-compatible regression coverage for the reported scope mismatch.

## 3.0.2 - 2026-08-02

- Make `install` without `--v2` disable an unchanged package-managed V2 block from an earlier installation.
- Keep `install --v2` as the only way to enable package-managed V2.
- Preserve pre-existing, untracked, or user-modified V2 configuration and return a nonzero result when managed V2 cannot be disabled safely.
- Keep routing agents installed while switching package-managed V2 off.
- Add unit, packed-package, and public-registry coverage for switching from V2 enabled to the default disabled state.

## 3.0.1 - 2026-08-02

- Restore Codex multi-agent V2 as the install-only `--v2` option.
- Keep V2 disabled for fresh installs unless `--v2` is explicitly supplied.
- Keep the public CLI limited to `install`, `uninstall`, `--help`, and `--version`; separate V2 lifecycle commands remain removed.
- Reuse the 2.x marked V2 block and state format so existing managed installations can be removed safely.
- Remove unchanged package-managed V2 configuration during uninstall while preserving pre-existing or user-modified V2 content.
- Add project, global, packed-package, and public-registry coverage for optional V2.

## 3.0.0 - 2026-08-02

- Add the evidence-first `Primary -> Luna evidence -> Terra plan -> Luna implementation -> Terra verification` workflow.
- Escalate non-PASS verification to read-only Sol plan revision, followed by Luna reimplementation and final Terra verification.
- Reuse the primary thread when its model matches Luna, Terra, or Sol, and never spawn duplicate same-model agents in one workflow.
- Keep Luna as the only workspace-write role while Terra and Sol remain read-only.
- Reduce the public CLI to `install`, `uninstall`, `--help`, `--version`, and install configuration options.
- Remove `enable`, `disable`, `status`, `doctor`, `--dry-run`, `adopt`, `repair`, experimental V2 commands, and compatibility aliases.
- Simplify README installation, configuration, removal, workflow, and safety guidance while retaining the workflow diagram.
- Preserve safe managed-template migration, path validation, locking, atomic transactions, rollback, configuration restoration, and user-modified file protection.

## 2.4.2 - 2026-08-02

- Safely migrate exact legacy home-directory Project Scope state to Global Scope during explicit global lifecycle commands.
- Keep custom `CODEX_HOME`, unsafe paths, invalid hashes, active locks, and unfinished transactions blocked.
- Preserve user-modified managed files while correcting only the state scope metadata.
- Report migration requirements through global status and zero-write dry-run output.
- Add regression coverage for migration, user changes, and non-equivalent custom scope rejection.

## 2.4.1 - 2026-08-02

- Allow explicit global lifecycle commands to run from the user home directory.
- Keep project-scope commands from treating the user home directory as a valid project root.
- Preserve protection against genuine project/global overlap caused by a custom `CODEX_HOME`.
- Add regression coverage for global enable, status, repair, V2 status, disable, and actionable project-scope errors.

## 2.4.0 - 2026-08-02

- Add primary-model-aware role inlining so Terra, Luna, and Sol primaries avoid redundant same-model subagents when their identity is available.
- Keep a deterministic Terra -> Luna -> Terra fallback when Codex does not expose the active primary model.
- Reject project/global scope overlap when a custom `CODEX_HOME` resolves to the current project's `.codex` root.
- Expand status with complete resolved paths, ownership, configured primary values, routing mode, V2 scope, reasoning warnings, and project/global definition conflicts.
- Add `status --json` and optional `status --strict-preflight` output.
- Add safe exact-template `adopt` and conservative `repair` commands for missing or stale installation state.
- Add non-blocking semantic warnings for ineffective reasoning combinations.
- Add non-billable Codex capability preflight that reports unavailable or unknown capabilities without inference calls.
- Add lifecycle and regression tests for issues #49 through #56.

## 2.3.0 - 2026-08-02

- Add `enable`, `disable`, and `status` as the preferred user-facing lifecycle commands.
- Keep `install`, `uninstall`, and `doctor` as backward-compatible aliases.
- Support all install options, including reasoning overrides and `--set-default`, through `enable`.
- Make `disable` remove only unchanged package-managed routing and unchanged package-managed V2 configuration.
- Rewrite README installation, global scope, status, V2, and removal instructions around `npx codex-model-router`.
- Add lifecycle, help-output, and packed-package coverage for the npx-first commands.
- Split release preparation from npm publication so the validated remote tag exists before Trusted Publishing begins.
- Check out and verify the exact immutable release tag before npm inspection, public E2E verification, and GitHub Release creation.

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
- Improve npm publication metadata and concise publishing instructions.

## 1.0.0 - 2026-07-31

- Safely patch real-world Codex TOML while preserving comments, BOM, and line endings.
- Add reversible `--set-default` support for Terra/high.
- Add idempotent install and uninstall state cleanup.
