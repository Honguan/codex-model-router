# codex-model-router

A small Node.js CLI that installs a Codex skill and two custom subagents without replacing unrelated user configuration.

Routing is advisory: Terra reads the skill and decides when to delegate. This package does not intercept prompts or guarantee a hard model switch.

## Requirements

- Node.js 18 or newer
- A current Codex release with custom agents and local skills

## Install

From npm after publication:

```sh
npx codex-model-router install
```

From this repository:

```sh
npm install
node bin/codex-model-router.js install
```

Project scope is the default. Use `--global` only when the setup should apply to every project:

```sh
npx codex-model-router install --global
```

A normal install preserves an existing main model. To explicitly set Terra/high and make the change reversible:

```sh
npx codex-model-router install --set-default
```

Preview without writing anything:

```sh
npx codex-model-router install --dry-run
npx codex-model-router uninstall --dry-run
```

## Installed routing

- Terra: normal questions, coding, debugging, fixes, tests, and implementation
- Luna/high: deterministic repeated edits, bulk patterns, searches, formatting, counting, extraction, and summaries
- Sol/medium/read-only: security, permissions, destructive actions, financial logic, SQL writes, concurrency, complex state, and explicit reviews
- Terra applies fixes reported by Sol
- Simple questions do not spawn a subagent

## Commands

```text
codex-model-router install [--global] [--set-default] [--dry-run]
codex-model-router uninstall [--global] [--dry-run]
codex-model-router doctor [--global]
codex-model-router --version
```

`doctor` is read-only. Exit code `0` means the managed installation is healthy; exit code `1` reports an item as missing, invalid, user-modified, overridden, or unsafe.

## File locations

Project scope:

```text
.codex/config.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.agents/skills/model-router/SKILL.md
```

Global scope:

```text
$CODEX_HOME/config.toml or ~/.codex/config.toml
$CODEX_HOME/agents/luna.toml
$CODEX_HOME/agents/sol.toml
~/.agents/skills/model-router/SKILL.md
```

The package also stores `model-router-state.json` and, when an existing config must change, one package-owned backup next to `config.toml`.

## Manual model changes

Edit these fields directly:

```toml
# Main config
model = "gpt-5.6-terra"
model_reasoning_effort = "high"

# luna.toml
model = "gpt-5.6-luna"
model_reasoning_effort = "high"

# sol.toml
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"
```

A later plain install preserves manual changes. Uninstall removes only unchanged package-owned files and values. User-modified content is left in place and reported.

## Safety behavior

- Preserves unrelated TOML content, comments, ordering, UTF-8 BOM, and LF/CRLF line endings
- Refuses malformed or unsafe configuration before writing
- Uses atomic file replacement and rolls back a failed multi-file operation where possible
- Never modifies `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, telemetry, or environment variables
- Dry-run creates no files, directories, backups, or temporary state

## Known limits

The installer only manages top-level `model` and `model_reasoning_effort`, the Luna and Sol agent files, and the router skill. Existing files at those paths are preserved rather than overwritten. Restart Codex if a newly installed skill or agent is not immediately visible.

## Release process

Update `package.json` and `CHANGELOG.md`, open a pull request, and merge only after the cross-platform CI matrix passes. A protected workflow verifies the package again and creates the matching GitHub release if its tag does not already exist.

Codex references: [Subagents](https://developers.openai.com/codex/subagents), [Build skills](https://developers.openai.com/codex/build-skills), and [Configuration reference](https://developers.openai.com/codex/config-reference).
