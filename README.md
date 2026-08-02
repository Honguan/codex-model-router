# codex-model-router

A small Node.js CLI that safely installs an evidence-first Codex workflow for Terra, Luna, and Sol without replacing unrelated configuration, `AGENTS.md`, or the user's selected primary model.

> Routing is advisory. Codex reads the installed skills and decides when to delegate. The package does not intercept prompts or guarantee a hard model switch.

## Workflow

![Codex Model Router workflow](docs/model-router-workflow.svg)

For nontrivial code changes, the canonical flow is:

```text
Primary model
→ Luna reads all task-relevant requirements and produces REQUIREMENT_EVIDENCE
→ Terra writes or updates PLAN.md
→ the same Luna role rereads the complete plan and implements it
→ Terra independently verifies requirement satisfaction and plan conformance
→ PASS returns the final verification result to the primary model
→ non-PASS escalates to Sol
→ Sol diagnoses the failure and revises only affected PLAN.md sections
→ the same Luna role reimplements the affected scope
→ Terra performs final verification
→ the primary model replies to the user
```

### No duplicate same-model agents

One model uses one stable role identity for the complete workflow:

- A Luna primary performs Luna requirement reading and implementation in the primary thread.
- A Terra primary performs Terra planning and verification in the primary thread.
- A Sol primary performs Sol escalation and replanning in the primary thread.
- A matching-model subagent is never spawned again for a later stage.
- When Codex does not expose the primary identity, the router does not guess: it uses one Luna agent, one Terra agent, and only after non-PASS one Sol agent.

This reduces repeated context transfer and avoidable input-token usage.

## Role boundaries

| Role | Model | Default reasoning | Sandbox | Responsibility |
| --- | --- | --- | --- | --- |
| Primary | User selected | User selected | Existing setting | Conversation, clarification, coordination, final reply |
| Luna | `gpt-5.6-luna` | `xhigh` | `workspace-write` | Requirement evidence and plan implementation |
| Terra | `gpt-5.6-terra` | `high` | `read-only` | Evidence-grounded planning and independent verification |
| Sol | `gpt-5.6-sol` | `medium` | `read-only` | Non-PASS root-cause analysis and affected-plan revision |

Luna is the only writable role. Luna does not make architecture or correctness decisions and cannot self-approve. Terra does not implement. Sol does not implement or replace final Terra verification.

## Question and task routing

The full workflow is not used for:

- ordinary questions or explanations;
- read-only analysis that does not require modification;
- a requirement that remains unclear;
- a trivial response that does not modify project files.

The primary model handles those cases directly. When a code-changing requirement is unclear, the primary model asks for clarification before starting the workflow.

## Planning and verification

Luna's `REQUIREMENT_EVIDENCE` package records the primary requirement, repository constraints, confirmed files and symbols, current and required behavior, direct caller and dependency flow, invariants, unknowns, and evidence locations.

Terra's plan uses applicable fields such as:

- `TASK`, `REQUIREMENT_VERSION`, `EVIDENCE_VERSION`, `PLAN_VERSION`;
- `OBJECTIVE`, `TARGETS`, `SYMBOLS`, `CONTRACTS`;
- `FLOW`, `LOGIC`, `CALLERS`, `INVARIANTS`;
- `FIXED`, `LOCAL_CHOICE`, `FORBIDDEN`;
- `RETURN_REQUIRED`, `VERIFICATION`, `DONE_WHEN`.

Information is marked `CONFIRMED`, `PROPOSED`, or `UNKNOWN`. Implementation cannot start while an unknown can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility.

Terra returns exactly one verification verdict:

- `PASS`
- `FAIL_IMPLEMENTATION`
- `FAIL_PLAN`
- `EVIDENCE_GAP`
- `REQUIREMENT_CLARIFICATION`

Any non-PASS verdict includes evidence for Sol escalation. One correction loop is preferred, and the workflow never exceeds three total implementation-verification cycles without new evidence or a changed user decision.

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

Use `--global` for the current user's Codex configuration:

```sh
npx codex-model-router enable --global
npx codex-model-router status --global
npx codex-model-router disable --global
```

Project and global installations remain independent. A custom `CODEX_HOME` that points to the current project's `.codex` directory is rejected before any lock, directory, backup, journal, state, or managed file is created.

## Optional Terra default

Normal `enable` preserves the selected primary model. To explicitly set and track Terra/high for the selected scope:

```sh
npx codex-model-router enable --set-default
```

A later plain `enable` returns package-managed defaults to free mode. User changes are preserved.

## Agent reasoning

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

Supported values are `none`, `low`, `medium`, `high`, `xhigh`, and `max`. Explicit unusual combinations remain allowed, but `enable` and `status` report advisory warning codes when a profile weakens evidence reading, planning, verification, or escalation review.

## Status and diagnostics

```sh
npx codex-model-router status
npx codex-model-router status --global
npx codex-model-router status --json
```

Status remains read-only and reports scope, routing mode, configured primary model and ownership, runtime primary identity, logical and physical roots, every managed path, ownership states, duplicate or conflicting agents and skills, V2 state, reasoning profiles, warning codes, and non-billable Codex capability preflight.

Model availability is never tested through paid inference. When no reliable non-billable probe exists, status reports `unknown` rather than success.

Require Codex explicitly when needed:

```sh
npx codex-model-router status --strict-preflight
```

## Adopt and repair

```sh
npx codex-model-router adopt --dry-run
npx codex-model-router adopt
npx codex-model-router repair --dry-run
npx codex-model-router repair
```

`adopt` takes ownership only when every managed-path candidate exactly matches a recognized package template. `repair` restores tracked missing files and known template migrations while preserving user-modified content.

## Experimental multi-agent V2

V2 is explicit opt-in only:

```sh
npx codex-model-router v2 enable --dry-run
npx codex-model-router v2 enable
npx codex-model-router v2 status
npx codex-model-router v2 disable
```

Managed block:

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
tool_namespace = "agents"
```

## Managed files

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
.codex/model-router-transaction-data/           # transient
.agents/skills/model-router/SKILL.md
.agents/skills/implementation-planning/SKILL.md
```

Existing files at managed paths are never overwritten. Later manual edits are preserved and reported.

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

Compatibility aliases:

- `install = enable`
- `uninstall = disable`
- `doctor = status`

## Safety behavior

- Preserves unrelated TOML settings, comments, BOM, ordering, and LF/CRLF.
- Rejects malformed, non-UTF-8, duplicate, unsafe, symlinked, or junction-redirected managed paths.
- Uses scope locking, atomic transactions, rollback, and conflict-safe recovery.
- Uses exact-template ownership for adoption and conservative repair.
- Never overwrites post-interruption user changes.
- Dry-run creates no files, directories, locks, backups, journals, or state.
- Never changes `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, telemetry, accounts, or environment variables.

## Compatibility

The package is tested on Node.js 18, 20, 22, and 24 across Windows, Linux, and macOS. Codex runtime capabilities and account model access can change independently; status distinguishes `available`, `unavailable`, and `unknown` without billable probing.

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md). Maintainer release steps are in [MAINTAINERS.md](MAINTAINERS.md).
