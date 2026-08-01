# codex-model-router

A small Node.js CLI that safely enables adaptive Codex subagent routing for Terra, Luna, and Sol without replacing unrelated user configuration or the user's selected primary model.

> Routing is advisory. Codex reads the installed skills and decides when to delegate. This package does not intercept prompts, guarantee a hard model switch, or modify `AGENTS.md`.

## Requirements

- Node.js 18 or newer.
- A current Codex installation with custom-agent and local-skill support.
- Access to `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.6-sol`.
- Run project-scope commands from the project root that should receive the routing files.

No global npm installation is required. Every user operation can be run through `npx codex-model-router`.

## Project installation

### 1. Preview the files and settings that would be created

```sh
npx codex-model-router enable --dry-run
```

The preview is read-only and creates no directories, files, locks, backups, journals, or state.

### 2. Enable routing for the current project

```sh
npx codex-model-router enable
```

This installs project-local agents and skills. It does not change the selected primary model unless `--set-default` is supplied.

### 3. Check the installation

```sh
npx codex-model-router status
```

Exit code `0` means the managed installation is healthy. Exit code `1` means the output contains an item that requires attention.

### 4. Restart Codex

Restart Codex after enabling, disabling, or changing V2 so the current process reloads agents, skills, and configuration.

## Disable routing

Preview the removal first:

```sh
npx codex-model-router disable --dry-run
```

Disable routing for the current project:

```sh
npx codex-model-router disable
```

`disable` safely removes only unchanged files and settings managed by this package. User-modified files or values are preserved and reported instead of being overwritten or deleted.

Disabling routing also removes an unchanged package-managed experimental V2 block. It does not remove pre-existing V2 settings or V2 content changed by the user.

## Global installation

Use `--global` to manage the current user's Codex configuration instead of the current project:

```sh
npx codex-model-router enable --global --dry-run
npx codex-model-router enable --global
npx codex-model-router status --global
npx codex-model-router disable --global --dry-run
npx codex-model-router disable --global
```

Global agents are stored under `$CODEX_HOME/agents`. When `CODEX_HOME` is unset, Codex configuration defaults to `~/.codex`. Global skills are stored under `~/.agents/skills`.

Project and global installations are independent. Use the same scope flag when checking or disabling an installation.

## Primary controls

| Purpose | Preferred command |
| --- | --- |
| Preview or enable routing | `npx codex-model-router enable [options]` |
| Check routing health | `npx codex-model-router status [--global]` |
| Preview or disable routing | `npx codex-model-router disable [options]` |
| Enable experimental V2 | `npx codex-model-router v2 enable [options]` |
| Check experimental V2 | `npx codex-model-router v2 status [--global]` |
| Disable only experimental V2 | `npx codex-model-router v2 disable [options]` |
| Show the package version | `npx codex-model-router --version` |

The older names remain supported for backward compatibility:

- `install` is equivalent to `enable`.
- `uninstall` is equivalent to `disable`.
- `doctor` is equivalent to `status`.

## Optional Terra default

Normal `enable` leaves the user's selected primary model unchanged. To explicitly set and track Terra/high as the selected scope's default:

```sh
npx codex-model-router enable --set-default
```

Running a later plain `enable` returns package-managed top-level defaults to free mode. User-modified model settings are preserved.

## Agent reasoning

Managed defaults are Terra/high, Luna/xhigh, and Sol/medium.

Set one reasoning effort for every managed agent:

```sh
npx codex-model-router enable --agent-reasoning high
```

Set agents individually:

```sh
npx codex-model-router enable --terra-reasoning xhigh --luna-reasoning low --sol-reasoning max
```

Supported values are `none`, `low`, `medium`, `high`, `xhigh`, and `max`. Per-agent options override `--agent-reasoning`. Later enables preserve unchanged package-managed reasoning choices; manually edited agent files remain protected.

## Optional experimental multi-agent V2

Codex currently has an experimental `multi_agent_v2` configuration that is not part of the public configuration reference. It may be unavailable for some accounts or Codex builds, and its keys or behavior may change without notice.

Normal routing enablement never enables V2. Preview and enable V2 explicitly for the current project:

```sh
npx codex-model-router v2 enable --dry-run
npx codex-model-router v2 enable
npx codex-model-router v2 status
```

The managed block is:

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
tool_namespace = "agents"
```

Disable only the package-managed V2 block while keeping normal Terra, Luna, and Sol routing enabled:

```sh
npx codex-model-router v2 disable --dry-run
npx codex-model-router v2 disable
```

Use `--global` with the V2 commands to target user-level Codex configuration:

```sh
npx codex-model-router v2 enable --global
npx codex-model-router v2 status --global
npx codex-model-router v2 disable --global
```

Pre-existing V2 settings are treated as user-managed and are never overwritten. Modified package-managed V2 content is preserved and reported.

Enabling V2 does not guarantee that every child agent resolves to the requested model. Check Codex session metadata when actual subagent model selection affects cost or policy.

## Routing model

The normal installation uses free mode:

- The user-selected primary model handles conversation, clarification, follow-ups, final replies, and trivial work.
- Terra/high investigates, produces implementation-ready plans, verifies results, debugs, and replans.
- Luna/xhigh performs most clear, bounded, repetitive, or independently verifiable implementation work.
- Sol/medium is read-only and used only when Terra still cannot resolve core logic after focused investigation and one materially revised plan, or when the user explicitly requests Sol.
- Existing built-in and custom agents remain available and take precedence when they are a better match.

A normal workflow is Terra -> Luna -> Terra. Implementation errors return to Luna as focused corrections. Plan or logic errors return to Terra for a revised plan before Luna continues. Sol is not a routine reviewer.

## Managed files

Project scope manages only these paths:

```text
.codex/config.toml                              # only with --set-default, V2 opt-in, or a managed migration
.codex/agents/terra.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.codex/model-router-state.json
.codex/model-router-v2-state.json               # only after explicit V2 enablement
.codex/config.toml.codex-model-router.bak       # only when needed
.agents/skills/model-router/SKILL.md
.agents/skills/implementation-planning/SKILL.md
```

Existing files at managed paths are never overwritten. Later manual edits are preserved and reported by `status`.

## Prompt and cache efficiency

The installed model-router skill is intentionally short. Detailed planning rules live in the separate implementation-planning skill and are loaded only for nontrivial or uncertain changes.

Within the same agent thread, accepted state is kept and concise deltas are appended. A new agent thread receives the latest self-contained snapshot. After three deltas or a material contract or logic change, Terra produces a new snapshot.

Prompt-cache reuse is best effort. Genuinely new information cannot be a cache hit on first use. Stable wording and ordering improve repeated-prefix reuse, but correctness takes priority over cache behavior.

## Planning rules

For nontrivial changes, Terra identifies only applicable correctness-critical details, including exact files and symbols, names, contracts, parameter flow, callers, ordered logic, invariants, fixed decisions, safe local choices, return conditions, and acceptance criteria.

Information is marked as CONFIRMED, PROPOSED, or UNKNOWN. Luna does not begin implementation while an UNKNOWN can materially change behavior, targets, contracts, parameter flow, control flow, or compatibility.

Terra verifies separately whether implementation matches the plan and whether the plan plus implementation satisfy the original requirement. After three cycles without new evidence or a changed decision, the workflow stops instead of repeating the same approach.

## Complete command reference

```text
npx codex-model-router enable [--global] [--set-default] [--dry-run]
  [--agent-reasoning <effort>]
  [--terra-reasoning <effort>]
  [--luna-reasoning <effort>]
  [--sol-reasoning <effort>]
npx codex-model-router disable [--global] [--dry-run]
npx codex-model-router status [--global]
npx codex-model-router v2 enable [--global] [--dry-run]
npx codex-model-router v2 disable [--global] [--dry-run]
npx codex-model-router v2 status [--global]
npx codex-model-router --version
```

## Safety behavior

- Preserves unrelated TOML settings, comments, BOM, ordering, and LF/CRLF line endings.
- Rejects malformed, non-UTF-8, duplicate, or unsafe configuration before writing.
- Rejects symbolic links and Windows junctions in managed paths.
- Uses scope-level locking, atomic transactions, rollback, and conflict-safe recovery for normal routing changes.
- The optional V2 manager uses the same scope lock, atomic replacement, an exact marked block, and a separate state file.
- Never overwrites post-interruption user changes.
- Dry-run creates no files, directories, backups, locks, journals, or state.
- Never modifies `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, telemetry, accounts, or environment variables.

## Compatibility and troubleshooting

Compatibility is tested on Node.js 18, 20, 22, and 24 across Windows, Linux, and macOS runners.

The optional V2 setting is excluded from compatibility guarantees because it is not publicly documented by OpenAI. Failure or removal of V2 does not affect normal custom-agent routing.

Run this first when routing does not appear active:

```sh
npx codex-model-router status
```

For a global installation, use:

```sh
npx codex-model-router status --global
```

Common causes are running the project command from the wrong directory, checking a different scope than the one enabled, a user-modified managed file, an interrupted transaction, an active lock, or not restarting Codex after a change.

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md). Maintainer setup and release steps are documented in [MAINTAINERS.md](MAINTAINERS.md).
