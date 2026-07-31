# codex-model-router

Safely configures a small Codex routing setup.

```sh
npx codex-model-router install
npx codex-model-router doctor
npx codex-model-router uninstall
```

Add `--global` to use the user scope. Project scope uses `.codex/config.toml`, `.codex/agents/`, and `.agents/skills/model-router/`. Global scope uses `$CODEX_HOME/config.toml` (or `~/.codex/config.toml`), `$CODEX_HOME/agents/`, and `~/.agents/skills/model-router/`.

The installer creates Terra/high only when those top-level values are absent. Luna and Sol templates keep `model` and `model_reasoning_effort` near the top for manual edits. Later install or uninstall runs preserve user-modified values and files.
