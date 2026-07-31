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

From GitHub:

```sh
npm install -g https://github.com/Honguan/codex-model-router/archive/refs/tags/v1.1.0.tar.gz
codex-model-router install
```

Project scope is the default. Use `--global` only when the setup should apply to every project:

```sh
codex-model-router install --global
```

A normal install preserves an existing main model. To explicitly set Terra/high and make the change reversible:

```sh
codex-model-router install --set-default
```

Preview without writing anything:

```sh
codex-model-router install --set-default --dry-run
codex-model-router uninstall --dry-run
```

## What is changed

Project scope manages only:

```text
.codex/config.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.agents/skills/model-router/SKILL.md
```

Global scope uses `$CODEX_HOME` or `~/.codex` for Codex files and `~/.agents/skills/model-router/` for the skill.

A plain install adds Terra/high only when the top-level values are absent. Existing values are preserved. `--set-default` replaces only `model` and `model_reasoning_effort`, records the exact prior values, and restores them during uninstall only when the user has not changed them afterward.

Existing Luna, Sol, or skill files are never overwritten. Uninstall removes only unchanged package-owned files. Unrelated TOML settings, comments, BOM, ordering, and LF/CRLF line endings are preserved.

## Installed routing

- Terra/high: normal questions, coding, debugging, fixes, tests, and implementation
- Luna/high: deterministic repeated edits, bulk patterns, searches, formatting, counting, extraction, and summaries
- Sol/medium/workspace-write: security-sensitive or high-regression-risk review and implementation
- Sol normally reviews first; it may edit files when Terra explicitly delegates implementation or a confirmed fix
- Simple questions do not spawn a subagent

Users may edit model names, reasoning levels, and `sandbox_mode` directly in the generated TOML files. Later installs preserve those manual edits and `doctor` reports them as user-modified.

## Commands

```text
codex-model-router install [--global] [--set-default] [--dry-run]
codex-model-router uninstall [--global] [--dry-run]
codex-model-router doctor [--global]
codex-model-router --version
```

`doctor` is read-only. Exit code `0` means healthy; exit code `1` reports missing, invalid, user-modified, overridden, or unsafe state.

## npm publication

The package name is unscoped and public. Before the first publish, confirm the name is available and sign in:

```sh
npm view codex-model-router
npm login
npm whoami
```

Review exactly what will be uploaded:

```sh
npm run check
npm test
npm run test:package
npm pack --dry-run
npm publish --dry-run
```

Publish from the package root:

```sh
npm publish
```

npm requires account 2FA or a granular access token allowed to bypass 2FA. After publication, verify:

```sh
npm view codex-model-router version
npx codex-model-router --version
```

For automated releases, configure npm Trusted Publishing for this GitHub repository instead of storing a long-lived npm token.

## Safety behavior

- Refuses malformed or unsafe configuration before writing
- Uses atomic file replacement and rolls back failed multi-file upgrades where possible
- Stores a small package-owned state file and one backup only when an existing config is changed
- Never modifies `AGENTS.md`, shell profiles, editor settings, hooks, MCP servers, telemetry, or environment variables
- Dry-run creates no files, directories, backups, or temporary state

Restart Codex if newly installed agents or skills are not immediately visible.

Codex references: [Subagents](https://developers.openai.com/codex/subagents), [Build skills](https://developers.openai.com/codex/build-skills), and [Configuration reference](https://developers.openai.com/codex/config-reference).
