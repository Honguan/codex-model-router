# codex-model-router

A small Node.js CLI that safely installs advisory Codex subagent routing for Terra, Luna, and Sol without replacing unrelated user configuration.

> Routing is advisory. Terra reads the installed skill and decides when to delegate. This package does not intercept prompts or guarantee a hard model switch.

## Compatibility

Compatibility was verified on 2026-07-31 against:

- Codex CLI `0.145.0` or newer
- Node.js 18, 20, 22, and 24
- Windows, Linux, and macOS GitHub-hosted runners
- Codex project agents in `.codex/agents/`
- Codex user agents in `$CODEX_HOME/agents/` or `~/.codex/agents/`
- project skills in `.agents/skills/`
- user skills in `~/.agents/skills/`

The selected Codex account must have access to `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.6-sol`. Older Codex versions may not recognize the generated agent or skill files.

## Quick start

Preview a project installation without changing files:

```sh
npx codex-model-router install --set-default --dry-run
```

Install Terra/high as the project default, add Luna and Sol, then verify:

```sh
npx codex-model-router install --set-default
npx codex-model-router doctor
```

Remove only unchanged package-managed settings and files:

```sh
npx codex-model-router uninstall
```

## Install

Run directly from npm without installing the CLI globally:

```sh
npx codex-model-router install
```

Install the CLI command globally:

```sh
npm install -g codex-model-router
codex-model-router install
```

Installing the CLI globally only makes the command available system-wide. It does not modify user-level Codex configuration. The separate `install --global` option applies routing to the current user's Codex configuration.

Install a specific GitHub release:

```sh
npm install -g https://github.com/Honguan/codex-model-router/archive/refs/tags/v1.2.0.tar.gz
codex-model-router install
```

## Project and global scope

Project scope is the default:

```sh
codex-model-router install
```

It manages only:

```text
.codex/config.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.codex/model-router-state.json
.codex/config.toml.codex-model-router.bak        # only when needed
.agents/skills/model-router/SKILL.md
```

During a mutating operation it may temporarily create:

```text
.codex/model-router.lock
.codex/model-router-transaction.json
.codex/model-router-transaction-data/
```

These transient files are removed after a successful operation or safe recovery.

Use global scope only when the routing configuration should apply to every Codex project for the current user:

```sh
codex-model-router install --global
codex-model-router doctor --global
```

Global scope manages the equivalent paths under `$CODEX_HOME` and stores the skill under `~/.agents/skills/model-router/`. When `CODEX_HOME` is unset, it defaults to `~/.codex`.

## Existing settings

A normal install adds Terra/high only when the top-level values are absent. Existing model values are preserved:

```sh
codex-model-router install
```

To explicitly set and track Terra/high:

```sh
codex-model-router install --set-default
```

`--set-default` changes only:

```toml
model = "gpt-5.6-terra"
model_reasoning_effort = "high"
```

The exact prior values are recorded. Uninstall restores them only while the current values still match what the package installed. Later user edits are preserved and reported instead of overwritten.

Existing Luna, Sol, or skill files are never overwritten. Unrelated TOML settings, comments, BOM, ordering, and LF/CRLF line endings are preserved.

## Installed routing

- Terra/high handles normal questions, coding, debugging, fixes, tests, and implementation.
- Luna/high handles deterministic repeated edits, bulk patterns, searches, formatting, counting, extraction, and summaries.
- Sol/medium/workspace-write handles security-sensitive or high-regression-risk review and implementation.
- Sol normally reviews first and may edit files only when Terra explicitly delegates implementation or a confirmed fix.
- Simple questions do not spawn a subagent.

Users may edit model names, reasoning levels, and `sandbox_mode` directly in the generated TOML files. Later installs preserve manual edits, and `doctor` reports changed managed files.

## Commands

```text
codex-model-router install [--global] [--set-default] [--dry-run]
codex-model-router uninstall [--global] [--dry-run]
codex-model-router doctor [--global]
codex-model-router --version
```

`doctor` is read-only. Exit code `0` means healthy; exit code `1` means action is required.

Common statuses:

- `healthy`: the managed item matches its expected state.
- `preserve` or `user-modified`: user content was detected and left unchanged.
- `missing` or `invalid`: a required item is absent or malformed.
- `unsafe-state`: state paths or path components are unsafe.
- `locked` or `stale-lock`: another operation is active or a previous process ended unexpectedly.
- `unfinished`, `recoverable`, `conflicting`, or `corrupt`: an interrupted transaction needs attention.

## Safety behavior

- Rejects malformed, non-UTF-8, duplicate, or unsafe configuration before writing.
- Rejects symlinks and Windows junctions in managed paths so writes cannot escape the selected scope.
- Uses a scope-level process lock to prevent concurrent install/uninstall races.
- Uses an atomic transaction journal and private snapshots to recover interrupted multi-file operations.
- Never overwrites post-interruption user changes during recovery.
- Uses atomic file replacement and rollback for handled failures.
- Removes or restores only unchanged package-managed content.
- Never modifies `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, telemetry, accounts, or environment variables.
- Dry-run creates no files, directories, backups, locks, journals, or state.
- Tests use temporary directories and never touch real Codex configuration.

## Troubleshooting

### Agents or skills do not appear

Restart Codex after installation. Verify the selected scope with `doctor` or `doctor --global`, and confirm that your Codex version is at least the compatibility baseline above.

### `user-modified`

The file or setting was changed after installation. The CLI intentionally leaves it untouched. Review the reported path and decide manually whether to retain the custom value or reinstall the package template under a different name.

### `unsafe-state` or unsafe path component

Do not delete the reported file blindly. Check whether `.codex`, `.agents`, `CODEX_HOME`, or one of their parent directories is a symlink or Windows junction. Use a normal directory inside the intended project or user scope.

### Active or stale lock

An active lock includes the operation and process ID. Wait for that process to finish. A later mutating command automatically removes a stale lock only when the recorded local process is no longer alive. A corrupt or remote-host lock must be inspected manually before removal.

### Interrupted transaction

Run `doctor` first. A mutating command automatically rolls back `unfinished` or `recoverable` transactions when all hashes still match. `conflicting` means a managed file changed after interruption; preserve that file and resolve the journal manually rather than forcing an overwrite. `corrupt` means the journal or snapshot cannot be trusted.

### Untracked backup already exists

The CLI refuses to replace `config.toml.codex-model-router.bak`. Compare it with `config.toml`, move it to a clearly named safe location, and retry only after confirming its ownership.

### Permission or `CODEX_HOME` errors

For project scope, verify write access to the project. For global scope, print and verify `CODEX_HOME`; do not run with elevated privileges merely to bypass an unexplained path error.

### Manual backup recovery

The managed `.bak` is the exact pre-change configuration. Before restoring it, stop Codex, preserve the current `config.toml` under a new name, verify both files, and restore only within the same project/global scope.

### npx uses an old version

Request the exact version first:

```sh
npx --yes codex-model-router@1.2.0 --version
```

When necessary, inspect the npm cache with `npm cache verify`; avoid deleting unrelated cache directories blindly.

## Security and release integrity

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md).

Releases use npm Trusted Publishing through GitHub Actions, verified provenance, exact tag/version validation, current-version-only release notes, workflow linting, and a clean public-registry end-to-end install/doctor/uninstall check before the GitHub Release is created. Maintainer setup and release steps are documented in [MAINTAINERS.md](MAINTAINERS.md).

Codex references: [Subagents](https://developers.openai.com/codex/subagents), [Build skills](https://developers.openai.com/codex/build-skills), and [Configuration reference](https://developers.openai.com/codex/config-reference).
