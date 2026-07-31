#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function snapshot(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        output.push([`${name}/`, null]);
        await walk(path);
      } else {
        output.push([name, (await readFile(path)).toString("base64")]);
      }
    }
  }
  await walk(root);
  return output.sort((a, b) => a[0].localeCompare(b[0]));
}

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
    const before = await snapshot(project);
    await invoke("install", "--set-default", "--dry-run");
    assert.deepEqual(await snapshot(project), before);
    await invoke("install", "--set-default");
    await invoke("doctor");
    await invoke("uninstall");
    assert.equal(await readFile(join(project, ".codex", "config.toml"), "utf8"), original);
    console.log(`Verified ${name}@${version} from the public npm registry`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`public package verification failed: ${error.message}`);
  process.exitCode = 1;
});
