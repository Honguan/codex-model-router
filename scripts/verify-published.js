#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function main() {
  const [name, version] = process.argv.slice(2);
  if (!name || !version) throw new Error("usage: verify-published.js <package-name> <version>");

  const root = await mkdtemp(join(tmpdir(), "codex-model-router-public-"));
  const project = join(root, "project");
  const home = join(root, "home");
  const cache = join(root, "npm-cache");
  await mkdir(join(project, ".codex"), { recursive: true });
  await mkdir(home, { recursive: true });

  const original = "theme = \"unchanged\"\nmodel = \"previous-model\"\nmodel_reasoning_effort = \"low\"\n";
  await writeFile(join(project, ".codex", "config.toml"), original, "utf8");

  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: cache,
    npm_config_registry: "https://registry.npmjs.org",
    npm_config_yes: "true"
  };
  const invoke = (...args) => exec("npx", ["--yes", `${name}@${version}`, ...args], {
    cwd: project,
    env: environment,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  try {
    const reported = await invoke("--version");
    assert.equal(reported.stdout.trim(), version);

    const help = await invoke("--help");
    assert.match(help.stdout, /npx codex-model-router install/);
    assert.match(help.stdout, /npx codex-model-router uninstall/);
    assert.match(help.stdout, /--v2/);
    assert.match(help.stdout, /disabled by default/);
    assert.doesNotMatch(help.stdout, /--dry-run/);
    assert.doesNotMatch(help.stdout, /\bv2 enable\b/);

    await assert.rejects(invoke("enable"), /Command failed/);
    await invoke("install", "--set-default", "--v2");
    const enabled = await readFile(join(project, ".codex", "config.toml"), "utf8");
    assert.match(enabled, /\[features\.multi_agent_v2\]/);
    await access(join(project, ".codex", "model-router-v2-state.json"));

    await invoke("uninstall");
    assert.equal(await readFile(join(project, ".codex", "config.toml"), "utf8"), original);
    await assert.rejects(access(join(project, ".codex", "model-router-v2-state.json")));

    console.log(`Verified ${name}@${version} from the public npm registry`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`public package verification failed: ${error.message}`);
  process.exitCode = 1;
});
