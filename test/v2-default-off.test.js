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

test("explicit V2 install repairs a modified managed block and preserves unrelated TOML", async () => {
  const dir = await fixture();
  try {
    const output = [];
    const options = {
      cwd: dir.project,
      home: dir.home,
      output: (line) => output.push(String(line))
    };
    assert.equal(await runCli(["install", "--v2"], options), 0);

    const configPath = join(dir.project, ".codex", "config.toml");
    const statePath = join(dir.project, ".codex", "model-router-v2-state.json");
    const original = await readFile(configPath, "utf8");
    const stateBefore = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(
      configPath,
      `# unrelated-setting\n${original.replace('tool_namespace = "agents"', 'tool_namespace = "custom"')}`,
      "utf8"
    );

    output.length = 0;
    assert.equal(await runCli(["install", "--v2"], options), 0);

    const repaired = await readFile(configPath, "utf8");
    const stateAfter = JSON.parse(await readFile(statePath, "utf8"));
    assert.match(repaired, /^# unrelated-setting/m);
    assert.match(repaired, /tool_namespace = "agents"/);
    assert.doesNotMatch(repaired, /tool_namespace = "custom"/);
    assert.equal(stateAfter.blockHash, stateBefore.blockHash);
    assert.equal(stateAfter.scope, stateBefore.scope);
    assert.equal(stateAfter.configPath, stateBefore.configPath);
    assert.equal(typeof stateAfter.repairedAt, "string");
    assert.ok(output.includes(`repair: ${configPath} (managed V2 block restored)`));
  } finally {
    await dir.cleanup();
  }
});

test("V2 install validates scope before reading existing global state", async () => {
  const dir = await fixture();
  try {
    const globalOptions = { cwd: dir.home, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--global", "--v2"], globalOptions), 0);

    const statePath = join(dir.home, ".codex", "model-router-v2-state.json");
    const configPath = join(dir.home, ".codex", "config.toml");
    const stateBefore = await readFile(statePath, "utf8");
    const configBefore = await readFile(configPath, "utf8");
    const output = [];

    assert.equal(await runCli(["install", "--v2"], {
      cwd: dir.home,
      home: dir.home,
      output: (line) => output.push(String(line))
    }), 1);

    const message = output.join("\n");
    assert.match(message, /project install cannot use the user home/);
    assert.doesNotMatch(message, /state scope mismatch/);
    assert.equal(await readFile(statePath, "utf8"), stateBefore);
    assert.equal(await readFile(configPath, "utf8"), configBefore);
  } finally {
    await dir.cleanup();
  }
});
