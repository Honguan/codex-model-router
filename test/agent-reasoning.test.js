import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/agent-reasoning-cli.js";

const quiet = () => {};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-reasoning-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return { root, project, home, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function agentReasoning(project, name) {
  const content = await readFile(join(project, ".codex", "agents", `${name}.toml`), "utf8");
  const match = content.match(/^model_reasoning_effort = "([^"]+)"$/m);
  assert.ok(match, `${name} reasoning assignment is missing`);
  return match[1];
}

test("Luna defaults to xhigh reasoning", async () => {
  const dir = await fixture();
  try {
    assert.equal(await runCli(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "high");
    assert.equal(await agentReasoning(dir.project, "luna"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "sol"), "medium");
    assert.equal(await runCli(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("install accepts all-agent and per-agent reasoning overrides", async () => {
  const dir = await fixture();
  try {
    assert.equal(await runCli([
      "install",
      "--agent-reasoning", "low",
      "--luna-reasoning=xhigh",
      "--sol-reasoning", "max"
    ], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "low");
    assert.equal(await agentReasoning(dir.project, "luna"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "sol"), "max");
    assert.equal(await runCli(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("targeted reinstall preserves unspecified managed reasoning", async () => {
  const dir = await fixture();
  try {
    assert.equal(await runCli([
      "install",
      "--terra-reasoning", "xhigh",
      "--luna-reasoning", "low",
      "--sol-reasoning", "max"
    ], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await runCli([
      "install",
      "--luna-reasoning", "high"
    ], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "luna"), "high");
    assert.equal(await agentReasoning(dir.project, "sol"), "max");
    assert.equal(await runCli(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("invalid reasoning is rejected before writes", async () => {
  const dir = await fixture();
  try {
    const lines = [];
    assert.equal(await runCli([
      "install",
      "--luna-reasoning", "ultra"
    ], { cwd: dir.project, home: dir.home, output: (line) => lines.push(String(line)) }), 1);
    assert.equal(await exists(join(dir.project, ".codex")), false);
    assert.ok(lines.some((line) => line.includes("unsupported reasoning effort")));
  } finally { await dir.cleanup(); }
});