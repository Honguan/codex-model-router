import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/cli-v2.js";

const quiet = () => {};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-v2-default-off-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return { project, home, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("plain install disables an unchanged package-managed V2 configuration", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--v2"], options), 0);
    assert.equal(await exists(join(dir.project, ".codex", "model-router-v2-state.json")), true);

    assert.equal(await runCli(["install"], options), 0);
    assert.equal(await exists(join(dir.project, ".codex", "model-router-v2-state.json")), false);
    assert.equal(await exists(join(dir.project, ".codex", "config.toml")), false);
    assert.equal(await exists(join(dir.project, ".codex", "agents", "luna.toml")), true);
  } finally {
    await dir.cleanup();
  }
});

test("plain install preserves user-modified V2 and reports that it could not disable it", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--v2"], options), 0);
    const configPath = join(dir.project, ".codex", "config.toml");
    const content = await readFile(configPath, "utf8");
    await writeFile(configPath, content.replace('tool_namespace = "agents"', 'tool_namespace = "custom"'), "utf8");

    assert.equal(await runCli(["install"], options), 1);
    assert.match(await readFile(configPath, "utf8"), /tool_namespace = "custom"/);
    assert.equal(await exists(join(dir.project, ".codex", "model-router-v2-state.json")), true);
    assert.equal(await exists(join(dir.project, ".codex", "agents", "terra.toml")), true);
  } finally {
    await dir.cleanup();
  }
});
