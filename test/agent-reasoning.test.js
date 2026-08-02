import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/cli.js";

const quiet = () => {};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-v3-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return { root, project, home, cleanup: () => rm(root, { recursive: true, force: true }) };
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

async function agentReasoning(root, name) {
  const content = await readFile(join(root, ".codex", "agents", `${name}.toml`), "utf8");
  const match = content.match(/^model_reasoning_effort = "([^"]+)"$/m);
  assert.ok(match, `${name} reasoning assignment is missing`);
  return match[1];
}

test("install uses the default role profile and uninstall removes unchanged managed files", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install"], options), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "high");
    assert.equal(await agentReasoning(dir.project, "luna"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "sol"), "medium");
    assert.equal(await runCli(["uninstall"], options), 0);
    assert.equal(await exists(join(dir.project, ".codex")), false);
    assert.equal(await exists(join(dir.project, ".agents")), false);
  } finally {
    await dir.cleanup();
  }
});

test("install accepts common and per-agent reasoning options", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli([
      "install",
      "--agent-reasoning", "low",
      "--luna-reasoning=xhigh",
      "--sol-reasoning", "max"
    ], options), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "low");
    assert.equal(await agentReasoning(dir.project, "luna"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "sol"), "max");
  } finally {
    await dir.cleanup();
  }
});

test("targeted reinstall preserves unspecified managed reasoning", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli([
      "install",
      "--terra-reasoning", "xhigh",
      "--luna-reasoning", "low",
      "--sol-reasoning", "max"
    ], options), 0);
    assert.equal(await runCli(["install", "--luna-reasoning", "high"], options), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "luna"), "high");
    assert.equal(await agentReasoning(dir.project, "sol"), "max");
  } finally {
    await dir.cleanup();
  }
});

test("invalid reasoning and removed public controls are rejected before writes", async () => {
  const dir = await fixture();
  try {
    const calls = [
      ["install", "--luna-reasoning", "ultra"],
      ["install", "--dry-run"],
      ["enable"],
      ["disable"],
      ["status"],
      ["doctor"],
      ["adopt"],
      ["repair"],
      ["v2", "enable"]
    ];
    for (const argv of calls) {
      const lines = [];
      assert.equal(await runCli(argv, {
        cwd: dir.project,
        home: dir.home,
        output: (line) => lines.push(String(line))
      }), 1, argv.join(" "));
      assert.ok(lines.some((line) => /unsupported/.test(line)), argv.join(" "));
      assert.equal(await exists(join(dir.project, ".codex")), false);
    }
  } finally {
    await dir.cleanup();
  }
});

test("global install and uninstall work from the user home", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.home, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--global"], options), 0);
    assert.equal(await exists(join(dir.home, ".codex", "agents", "terra.toml")), true);
    assert.equal(await runCli(["uninstall", "--global"], options), 0);
    assert.equal(await exists(join(dir.home, ".codex")), false);
    assert.equal(await exists(join(dir.home, ".agents")), false);
  } finally {
    await dir.cleanup();
  }
});

test("help exposes only install, uninstall, and configuration options", async () => {
  const lines = [];
  assert.equal(await runCli(["--help"], { output: (line) => lines.push(String(line)) }), 0);
  const help = lines.join("\n");
  assert.match(help, /npx codex-model-router install/);
  assert.match(help, /npx codex-model-router uninstall/);
  assert.match(help, /--set-default/);
  assert.match(help, /--terra-reasoning/);
  assert.doesNotMatch(help, /\benable\b/);
  assert.doesNotMatch(help, /\bdisable\b/);
  assert.doesNotMatch(help, /\bdoctor\b/);
  assert.doesNotMatch(help, /--dry-run/);
});
