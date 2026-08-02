# codex-model-router

[繁體中文](README.md)｜[English](README.en.md)

Installs an evidence-first Codex workflow for Terra, Luna, and Sol while preserving the user's primary model and unrelated Codex configuration.

> Routing is advisory. Codex reads the installed agents and skills and decides when to delegate. This package does not intercept prompts or guarantee a hard model switch.

## Install

Project:

```sh
npx codex-model-router@latest install
```

Current user:

```sh
npx codex-model-router@latest install --global
```

Enable package-managed multi-agent V2:

```sh
npx codex-model-router@latest install --v2
```

Use `--global --v2` for the current user. Restart Codex after installation.

### Codex installation locations

| Scope | Agent definitions | User skills |
| --- | --- | --- |
| Project | `<project>/.codex/agents` | `<project>/.agents/skills` |
| Current user | `~/.codex/agents` | `~/.agents/skills` |

`~/.agents/skills` is the Codex user-skill location. `~/.codex/skills/.system` is reserved for bundled Codex skills; seeing only `.system` there is normal, and custom package skills should not be copied into it. The CLI prints the resolved agent and skill locations after installation.

## Configuration

```sh
npx codex-model-router@latest install \
  --terra-reasoning high \
  --luna-reasoning xhigh \
  --sol-reasoning medium
```

| Option | Purpose |
| --- | --- |
| `--set-default` | Set Terra/high as the primary default |
| `--agent-reasoning <level>` | Set reasoning for all managed agents |
| `--terra-reasoning <level>` | Set Terra reasoning |
| `--luna-reasoning <level>` | Set Luna reasoning |
| `--sol-reasoning <level>` | Set Sol reasoning |
| `--v2` | Enable or repair package-managed V2 |
| `--global` | Apply the installation to the current user |

Reasoning values: `none`, `low`, `medium`, `high`, `xhigh`, `max`.

## Visual guides

All diagrams are collapsed by default. Select a heading to expand it.

<details>
<summary><strong>Roles, models, access, and responsibilities</strong></summary>

![Codex Model Router role diagram](docs/images/en/roles.png)

</details>

<details>
<summary><strong>Standard main workflow overview</strong></summary>

![Codex Model Router main workflow overview](docs/images/en/workflow-overview.png)

</details>

<details>
<summary><strong>Estimated model usage share</strong></summary>

![Estimated model usage share](docs/images/en/model-usage-share.png)

</details>

<details>
<summary><strong>Primary-model Q&A outside the workflow</strong></summary>

![Primary-model Q&A scenarios](docs/images/en/primary-qa-scenarios.png)

</details>

<details>
<summary><strong>Scenario A: Primary is Sol</strong></summary>

![Sol primary workflow](docs/images/en/primary-sol.png)

</details>

<details>
<summary><strong>Scenario B: Primary is Terra</strong></summary>

![Terra primary workflow](docs/images/en/primary-terra.png)

</details>

<details>
<summary><strong>Scenario C: Primary is Luna</strong></summary>

![Luna primary workflow](docs/images/en/primary-luna.png)

</details>

## Core rules

- The same model is not spawned twice in one workflow.
- A matching primary model performs that role in the primary thread.
- Luna is the only writable role.
- Terra plans and independently verifies.
- Sol joins only after a non-PASS verification result.
- The final response always returns through the primary model.

## V2

```text
install --v2  → enable V2; repair a modified tracked marker block
install       → disable unchanged package-managed V2
uninstall     → remove the router and unchanged managed V2
```

When `install --v2` is explicitly run again and package state still exists, a changed package-marked V2 block is rebuilt in place, its hash is updated, and unrelated TOML is preserved. Pre-existing unmanaged V2, missing state, incomplete markers, or duplicate markers remain preserved and stop the operation to prevent accidental overwrites.

## Remove

Project:

```sh
npx codex-model-router@latest uninstall
```

Current user:

```sh
npx codex-model-router@latest uninstall --global
```

## Safety

- Preserves unrelated TOML, comments, BOM, ordering, and LF/CRLF.
- Uses path validation, scope locking, atomic transactions, and rollback.
- Except for rebuilding the package-marked V2 block after an explicit `install --v2`, it never overwrites other user-modified managed files.
- Never changes `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, accounts, telemetry, or environment variables.

## Requirements

- Node.js 18 or newer.
- Codex with custom-agent and local-skill support.
- Access to `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.6-sol`.
- Windows, Linux, or macOS.

Security issues: see [SECURITY.md](SECURITY.md). Maintainer release steps: see [MAINTAINERS.md](MAINTAINERS.md).
