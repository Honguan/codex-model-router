# codex-model-router

A small Node.js CLI that safely installs adaptive Codex subagent routing for Terra, Luna, and Sol without replacing unrelated user configuration or the user's selected primary model.

> Routing is advisory. Codex reads the installed skills and decides when to delegate. This package does not intercept prompts, guarantee a hard model switch, or modify AGENTS.md.

## Routing model

The normal installation uses free mode:

- The user-selected primary model handles conversation, clarification, follow-ups, final replies, and trivial work.
- Terra/high investigates, produces implementation-ready plans, verifies results, debugs, and replans.
- Luna/xhigh performs most clear, bounded, repetitive, or independently verifiable implementation work.
- Sol/medium is read-only and used only when Terra still cannot resolve core logic after focused investigation and one materially revised plan, or when the user explicitly requests Sol.
- Existing built-in and custom agents remain available and take precedence when they are a better match.

A normal workflow is Terra -> Luna -> Terra. Implementation errors return to Luna as focused corrections. Plan or logic errors return to Terra for a revised plan before Luna continues. Sol is not a routine reviewer.

## Quick start

Preview without changing files:

```sh
npx codex-model-router install --dry-run
```

Install free-mode routing and verify it:

```sh
npx codex-model-router install
npx codex-model-router doctor
```

Remove only unchanged package-managed files and settings:

```sh
npx codex-model-router uninstall
```

## Optional Terra default

A normal install does not add or change top-level model settings. Users remain free to select any primary model through Codex.

To explicitly set and track Terra/high as the selected scope's default:

```sh
codex-model-router install --set-default
```

Running a later plain `install` returns package-managed default settings to free mode. User-modified model settings are preserved.

## Agent reasoning

The managed agent defaults are Terra/high, Luna/xhigh, and Sol/medium. Override all agents or individual agents during installation:

```sh
codex-model-router install --agent-reasoning high
codex-model-router install --terra-reasoning xhigh --luna-reasoning low --sol-reasoning max
```

Supported values are `none`, `low`, `medium`, `high`, `xhigh`, and `max`. Per-agent options override `--agent-reasoning`. Later installs preserve unchanged package-managed reasoning choices; manually edited agent files remain protected.

## Optional experimental multi-agent V2

Codex currently has an experimental `multi_agent_v2` configuration that is not part of the public configuration reference. It may be unavailable for some accounts or Codex builds, and its keys or behavior may change without notice.

A normal install never enables it. Enable it explicitly for the current project only after accepting that compatibility risk:

```sh
codex-model-router v2 enable --dry-run
codex-model-router v2 enable
codex-model-router v2 status
```

The managed block is:

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
tool_namespace = "agents"
```

Disable only the unchanged block created by this package:

```sh
codex-model-router v2 disable
```

Use `--global` with `enable`, `disable`, or `status` to target the user-level Codex configuration. Pre-existing V2 settings are treated as user-managed and are never overwritten. A normal package uninstall also removes an unchanged package-managed V2 block; modified V2 content is preserved and reported.

Enabling this setting does not guarantee that every child agent resolves to the requested model. Verify actual subagent model usage from Codex session metadata when cost control depends on Luna being selected.

## Install

Run from npm:

```sh
npx codex-model-router install
```

Install the command globally:

```sh
npm install -g codex-model-router
codex-model-router install
```

Installing the CLI globally only makes the command available system-wide. Use `install --global` to install routing for the current user's Codex configuration.

Install a specific GitHub release:

```sh
npm install -g https://github.com/Honguan/codex-model-router/archive/refs/tags/v2.2.0.tar.gz
codex-model-router install
```

## Managed files

Project scope is the default and manages only:

```text
.codex/config.toml                              # only with --set-default, V2 opt-in, or a managed migration
.codex/agents/terra.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.codex/model-router-state.json
.codex/model-router-v2-state.json               # only after explicit `v2 enable`
.codex/config.toml.codex-model-router.bak       # only when needed
.agents/skills/model-router/SKILL.md
.agents/skills/implementation-planning/SKILL.md
```

Use global scope with:

```sh
codex-model-router install --global
codex-model-router doctor --global
codex-model-router v2 enable --global
```

Global scope stores agents under `$CODEX_HOME/agents` and skills under `~/.agents/skills`. When `CODEX_HOME` is unset, it defaults to `~/.codex`.

Existing files at managed paths are never overwritten. Later manual edits are preserved and reported by `doctor`.

## Prompt and cache efficiency

The installed model-router skill is intentionally short. Detailed planning rules live in the separate implementation-planning skill and are loaded only for nontrivial or uncertain changes.

Within the same agent thread, accepted state is kept and concise deltas are appended. A new agent thread receives the latest self-contained snapshot. After three deltas or a material contract or logic change, Terra produces a new snapshot.

Prompt-cache reuse is best effort: genuinely new information cannot be a cache hit on first use. Stable wording and ordering improve repeated-prefix reuse, but correctness takes priority over cache behavior.

## Planning rules

For nontrivial changes, Terra identifies only applicable correctness-critical details, including exact files and symbols, names, contracts, parameter flow, callers, ordered logic, invariants, fixed decisions, safe local choices, return conditions, and acceptance criteria.

Information is marked as CONFIRMED, PROPOSED, or UNKNOWN. Luna does not begin implementation while an UNKNOWN can materially change behavior, targets, contracts, parameter flow, control flow, or compatibility.

Terra verifies separately whether implementation matches the plan and whether the plan plus implementation satisfy the original requirement. After three cycles without new evidence or a changed decision, the workflow stops instead of repeating the same approach.

## Commands

```text
codex-model-router install [--global] [--set-default] [--dry-run]
  [--agent-reasoning <effort>]
  [--terra-reasoning <effort>] [--luna-reasoning <effort>] [--sol-reasoning <effort>]
codex-model-router uninstall [--global] [--dry-run]
codex-model-router doctor [--global]
codex-model-router v2 enable [--global] [--dry-run]
codex-model-router v2 disable [--global] [--dry-run]
codex-model-router v2 status [--global]
codex-model-router --version
```

`doctor` is read-only. Exit code 0 means healthy; exit code 1 means action is required.

## Safety behavior

- Preserves unrelated TOML settings, comments, BOM, ordering, and LF/CRLF line endings.
- Rejects malformed, non-UTF-8, duplicate, or unsafe configuration before writing.
- Rejects symlinks and Windows junctions in managed paths.
- Uses scope-level locking, atomic transactions, rollback, and conflict-safe recovery for normal routing installation.
- The optional V2 manager uses the same scope lock, atomic file replacement, an exact marked block, and a separate state file.
- Never overwrites post-interruption user changes.
- Dry-run creates no files, directories, backups, locks, journals, or state.
- Never modifies AGENTS.md, shell profiles, editor settings, hooks, MCP servers, telemetry, accounts, or environment variables.

## Compatibility

Compatibility is tested on Node.js 18, 20, 22, and 24 across Windows, Linux, and macOS runners. The selected Codex account must have access to gpt-5.6-terra, gpt-5.6-luna, and gpt-5.6-sol.

The optional V2 setting is intentionally excluded from compatibility guarantees because it is not publicly documented by OpenAI. Failure or removal of that experimental setting does not affect the normal V1/custom-agent installation.

Restart Codex after installation or V2 changes so new agents, skills, and configuration are discovered. Use `doctor` for missing, user-modified, unsafe-state, lock, interrupted-transaction, or managed V2 reports.

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md). Maintainer setup and release steps are documented in [MAINTAINERS.md](MAINTAINERS.md).
