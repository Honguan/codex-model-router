# codex-model-router

A small Node.js CLI that safely installs advisory Codex subagent routing for Terra, Luna, and Sol without replacing unrelated user configuration.

> Routing is advisory. Terra reads the installed skill and decides when to delegate. This package does not intercept prompts or guarantee a hard model switch.

## Requirements

- Node.js 18 or newer
- A current Codex release with custom agents and local skills

## Quick start

Preview a project installation without changing files:

```sh
npx codex-model-router install --set-default --dry-run
```

Install Terra/high as the project default, add Luna and Sol, then verify the result:

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

Install the CLI command globally from npm:

```sh
npm install -g codex-model-router
codex-model-router install
```

Installing the CLI globally only makes the command available system-wide. It does not modify the user-level Codex configuration. Use the command option `install --global` for that.

Install a specific GitHub release instead of npm:

```sh
npm install -g https://github.com/Honguan/codex-model-router/archive/refs/tags/v1.1.1.tar.gz
codex-model-router install
```

## Project and global scope

Project scope is the default:

```sh
codex-model-router install
```

It manages only these project paths:

```text
.codex/config.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.codex/model-router-state.json
.codex/config.toml.codex-model-router.bak        # only when needed
.agents/skills/model-router/SKILL.md
```

Use global scope only when the routing configuration should apply to every Codex project for the current user:

```sh
codex-model-router install --global
codex-model-router doctor --global
```

Global scope manages:

```text
$CODEX_HOME/config.toml
$CODEX_HOME/agents/luna.toml
$CODEX_HOME/agents/sol.toml
$CODEX_HOME/model-router-state.json
$CODEX_HOME/config.toml.codex-model-router.bak   # only when needed
~/.agents/skills/model-router/SKILL.md
```

When `CODEX_HOME` is not set, it defaults to `~/.codex`.

## Existing settings

A normal install adds Terra/high only when the top-level values are absent. Existing model values are preserved:

```sh
codex-model-router install
```

To explicitly set and track Terra/high as the selected scope's default:

```sh
codex-model-router install --set-default
```

`--set-default` changes only:

```toml
model = "gpt-5.6-terra"
model_reasoning_effort = "high"
```

The exact prior values are recorded. Uninstall restores them only when the current values still match the package-installed values. Later user edits are preserved and reported instead of overwritten.

Existing Luna, Sol, or skill files are never overwritten. Unrelated TOML settings, comments, BOM, ordering, and LF/CRLF line endings are preserved.

## Installed routing

- Terra/high handles normal questions, coding, debugging, fixes, tests, and implementation.
- Luna/high handles deterministic repeated edits, bulk patterns, searches, formatting, counting, extraction, and summaries.
- Sol/medium/workspace-write handles security-sensitive or high-regression-risk review and implementation.
- Sol normally reviews first and may edit files only when Terra explicitly delegates implementation or a confirmed fix.
- Simple questions do not spawn a subagent.

Users may edit model names, reasoning levels, and `sandbox_mode` directly in the generated TOML files. Later installs preserve manual edits, and `doctor` reports managed files that were changed by the user.

## Commands

```text
codex-model-router install [--global] [--set-default] [--dry-run]
codex-model-router uninstall [--global] [--dry-run]
codex-model-router doctor [--global]
codex-model-router --version
```

`doctor` is read-only. Exit code `0` means healthy; exit code `1` means action is required.

Example install output:

```text
create: config.toml
create: luna
create: sol
create: skill
create: state
```

Example doctor output:

```text
healthy: state (schema v2)
healthy: model (gpt-5.6-terra)
healthy: model_reasoning_effort (high)
healthy: luna
healthy: sol
healthy: skill
```

Statuses such as `preserve`, `user-modified`, `missing`, `invalid`, and `unsafe-state` explain why a managed item was not changed or needs attention.

## Safety behavior

- Refuses malformed, non-UTF-8, duplicate, or unsafe configuration before writing.
- Uses atomic file replacement and rolls back failed multi-file operations where possible.
- Creates a package-owned state file and one configuration backup only when needed.
- Removes or restores only unchanged package-managed content.
- Never modifies `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, telemetry, accounts, or environment variables.
- Dry-run creates no files, directories, backups, temporary files, or state.
- Tests use temporary directories and do not touch the real Codex configuration.

Restart Codex when newly installed agents or skills are not immediately visible.

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md).

Codex references: [Subagents](https://developers.openai.com/codex/subagents), [Build skills](https://developers.openai.com/codex/build-skills), and [Configuration reference](https://developers.openai.com/codex/config-reference).
