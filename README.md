# codex-model-router

A small Node.js CLI that safely enables adaptive Codex routing for Terra, Luna, and Sol without replacing unrelated configuration, `AGENTS.md`, or the user's selected primary model.

> Routing is advisory. Codex reads the installed skills and decides when to delegate. The package does not intercept prompts or guarantee a hard model switch.

## Requirements

- Node.js 18 or newer.
- A Codex build that supports custom agents and local skills.
- Access to `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.6-sol`.
- Run project commands from the intended project root.

No global npm installation is required.

## Quick start

```sh
npx codex-model-router enable --dry-run
npx codex-model-router enable
npx codex-model-router status
```

Restart Codex after enabling, disabling, repairing, adopting, or changing V2 so the current process reloads configuration.

Disable safely:

```sh
npx codex-model-router disable --dry-run
npx codex-model-router disable
```

Use `--global` to target the current user's Codex configuration:

```sh
npx codex-model-router enable --global
npx codex-model-router status --global
npx codex-model-router disable --global
```

Project and global installations remain independent, but they may not resolve to the same physical Codex root. A custom `CODEX_HOME` that points to the current project's `.codex` directory is rejected before any lock, directory, backup, journal, state, or managed file is created.

## Primary-aware routing

Normal installation preserves the selected primary model and installs the `auto-primary-aware` routing mode.

- A Terra primary performs Terra planning, debugging, replanning, and verification in the primary thread instead of spawning a Terra subagent.
- A Luna primary implements directly unless a clean isolated context or independent parallel work is materially useful.
- A Sol primary performs the last-resort Sol advisory step in the primary thread instead of spawning another Sol instance.
- When Codex does not expose the primary model identity, the skill does not guess and uses the standard `Terra -> Luna -> Terra` flow.
- Sol remains a last-resort advisor, not a routine reviewer.

The user-selected primary model still handles conversation, clarification, follow-ups, final replies, and trivial work.

## Optional Terra default

Normal `enable` leaves the primary model unchanged. To explicitly set and track Terra/high for the selected scope:

```sh
npx codex-model-router enable --set-default
```

A later plain `enable` returns package-managed defaults to free mode. User changes are preserved.

## Agent reasoning

Defaults:

| Agent | Role | Reasoning |
| --- | --- | --- |
| Terra | Investigation, planning, debugging, verification | `high` |
| Luna | Clear bounded implementation | `xhigh` |
| Sol | Last-resort unresolved logic advice | `medium` |

Set all agents:

```sh
npx codex-model-router enable --agent-reasoning high
```

Set agents individually:

```sh
npx codex-model-router enable \
  --terra-reasoning xhigh \
  --luna-reasoning low \
  --sol-reasoning max
```

Supported values are `none`, `low`, `medium`, `high`, `xhigh`, and `max`. Explicit unusual combinations remain allowed, but `enable` and `status` report stable advisory warning codes when a profile weakens planning, verification, or last-resort advice.

## Status and diagnostics

```sh
npx codex-model-router status
npx codex-model-router status --global
npx codex-model-router status --json
```

Status remains read-only and reports:

- project/global scope;
- routing mode;
- configured primary model and ownership;
- runtime primary identity as `unknown` when Codex does not expose it;
- logical and physical Codex/skills roots;
- every managed path;
- package-managed, user-modified, recognizable-orphan, pre-existing, and missing ownership states;
- duplicate or conflicting Terra, Luna, Sol, and skills across project/global scopes;
- V2 state for both scopes;
- effective reasoning profile and warning codes;
- non-billable Codex capability preflight.

Model availability is never tested by performing paid inference. When no reliable non-billable probe exists, status reports `unknown` rather than success.

Missing Codex is diagnostic by default so package management can still run in isolated environments. Require it explicitly when needed:

```sh
npx codex-model-router status --strict-preflight
```

Exit code `1` is returned for normal installation failures, cross-scope definition conflicts, or a failed explicit strict preflight.

## Adopt and repair

If `model-router-state.json` was deleted while exact current or recognized legacy package files remain:

```sh
npx codex-model-router adopt --dry-run
npx codex-model-router adopt
```

`adopt` takes ownership only when every existing managed-path candidate exactly matches a recognized package template. It never adopts arbitrary or user-modified files, never guesses prior primary-model values, and preserves unrelated configuration.

Repair a tracked installation with missing files or known template migrations:

```sh
npx codex-model-router repair --dry-run
npx codex-model-router repair
```

When state is absent, `repair` uses the same strict adoption rules. A repair that still contains user-modified or invalid managed files returns a nonzero result and prints the remaining status findings.

## Experimental multi-agent V2

V2 is undocumented and explicit opt-in only. Normal `enable` never turns it on.

```sh
npx codex-model-router v2 enable --dry-run
npx codex-model-router v2 enable
npx codex-model-router v2 status
npx codex-model-router v2 disable
```

Use `--global` for user-level V2. Pre-existing or modified V2 content is preserved. V2 availability is reported as unknown unless Codex exposes a reliable non-destructive capability probe.

Managed block:

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
tool_namespace = "agents"
```

## Managed files

Project scope manages only:

```text
.codex/config.toml                              # only for --set-default, V2, or migration
.codex/agents/terra.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.codex/model-router-state.json
.codex/model-router-v2-state.json               # only after V2 enablement
.codex/config.toml.codex-model-router.bak       # only when needed
.codex/model-router.lock                        # transient
.codex/model-router-transaction.json            # transient
.codex/model-router-transaction-data/            # transient
.agents/skills/model-router/SKILL.md
.agents/skills/implementation-planning/SKILL.md
```

Global agents use `$CODEX_HOME/agents`; when unset, `$CODEX_HOME` defaults to `~/.codex`. Global skills use `~/.agents/skills`.

Existing files at managed paths are never overwritten. Later manual edits are preserved and reported.

## Planning and iteration rules

For nontrivial work, Terra produces a compact implementation-ready snapshot with applicable targets, symbols, contracts, parameter flow, callers, logic, invariants, fixed decisions, safe local choices, return conditions, and completion criteria.

Information is marked `CONFIRMED`, `PROPOSED`, or `UNKNOWN`. Luna does not implement while an unknown can materially change behavior, targets, contracts, flow, or compatibility.

Terra separately verifies plan conformance and requirement correctness. Implementation defects return to Luna; plan defects return to Terra. The workflow stops after three cycles without new evidence or a changed decision.

## Complete command reference

```text
npx codex-model-router enable [--global] [--set-default] [--dry-run]
  [--agent-reasoning <effort>]
  [--terra-reasoning <effort>]
  [--luna-reasoning <effort>]
  [--sol-reasoning <effort>]
npx codex-model-router disable [--global] [--dry-run]
npx codex-model-router status [--global] [--json] [--strict-preflight]
npx codex-model-router adopt [--global] [--dry-run] [reasoning options]
npx codex-model-router repair [--global] [--dry-run] [reasoning options]
npx codex-model-router v2 enable [--global] [--dry-run]
npx codex-model-router v2 disable [--global] [--dry-run]
npx codex-model-router v2 status [--global]
npx codex-model-router --version
```

Compatibility aliases remain available:

- `install = enable`
- `uninstall = disable`
- `doctor = status`

## Safety behavior

- Preserves unrelated TOML settings, comments, BOM, ordering, and LF/CRLF.
- Rejects malformed, non-UTF-8, duplicate, unsafe, symlinked, or junction-redirected managed paths.
- Uses scope locking, atomic transactions, rollback, and conflict-safe recovery for normal routing changes.
- Uses exact-template ownership for adoption and conservative repair.
- Never overwrites post-interruption user changes.
- Dry-run creates no files, directories, locks, backups, journals, or state.
- Never changes `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, telemetry, accounts, or environment variables.

## Compatibility

The package is tested on Node.js 18, 20, 22, and 24 across Windows, Linux, and macOS. Codex runtime capabilities and account model access can change independently; status distinguishes `available`, `unavailable`, and `unknown` without billable probing.

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md). Maintainer release steps are in [MAINTAINERS.md](MAINTAINERS.md).
