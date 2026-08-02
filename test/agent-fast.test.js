import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/cli-v2.js";

const quiet = () => {};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-fast-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return { project, home, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function agentContent(project, name) {
  return readFile(join(project, ".codex", "agents", `${name}.toml`), "utf8");
}

async function agentFast(project, name) {
  const content = await agentContent(project, name);
  const matches = [...content.matchAll(/^# codex-model-router-fast = (true|false)$/gm)];
  assert.equal(matches.length, 1, `${name} has one managed Fast comment`);
  return matches[0][1] === "true";
}

test("Fast is false by default and applies independently by role", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--terra-fast"], options), 0);
    assert.equal(await agentFast(dir.project, "terra"), true);
    assert.equal(await agentFast(dir.project, "luna"), false);
    assert.equal(await agentFast(dir.project, "sol"), false);
    assert.match(await agentContent(dir.project, "terra"), /model_reasoning_effort = "high"/);
  } finally {
    await dir.cleanup();
  }
});

test("common Fast setting allows an explicit role override regardless of argument order", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--no-luna-fast", "--agent-fast"], options), 0);
    assert.equal(await agentFast(dir.project, "terra"), true);
    assert.equal(await agentFast(dir.project, "luna"), false);
    assert.equal(await agentFast(dir.project, "sol"), true);
  } finally {
    await dir.cleanup();
  }
});

test("targeted reinstall preserves each unspecified role Fast setting", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--terra-fast", "--sol-fast"], options), 0);
    assert.equal(await runCli(["install", "--no-terra-fast"], options), 0);
    assert.equal(await agentFast(dir.project, "terra"), false);
    assert.equal(await agentFast(dir.project, "luna"), false);
    assert.equal(await agentFast(dir.project, "sol"), true);
  } finally {
    await dir.cleanup();
  }
});

test("status distinguishes configured Fast from the unsupported runtime effect", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--terra-fast"], options), 0);
    const lines = [];
    assert.equal(await runCli(["status"], { ...options, output: (line) => lines.push(String(line)) }), 0);
    assert.deepEqual(lines, [
      "Terra fast: configured=true, effective=not-supported, state=managed",
      "Luna fast: configured=false, effective=false, state=managed",
      "Sol fast: configured=false, effective=false, state=managed"
    ]);
  } finally {
    await dir.cleanup();
  }
});

test("status detects a user-modified role without silently applying Fast", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--terra-fast"], options), 0);
    const path = join(dir.project, ".codex", "agents", "terra.toml");
    await writeFile(path, `${await readFile(path, "utf8")}# user edit\n`, "utf8");
    const lines = [];
    assert.equal(await runCli(["status"], { ...options, output: (line) => lines.push(String(line)) }), 0);
    assert.equal(lines[0], "Terra fast: configured=false, effective=false, state=user-modified");
  } finally {
    await dir.cleanup();
  }
});

test("invalid or contradictory Fast flags fail before writing", async () => {
  const dir = await fixture();
  try {
    for (const argv of [
      ["install", "--terra-fast=enabled"],
      ["install", "--terra-fast", "--no-terra-fast"],
      ["install", "--agent-fast", "--no-agent-fast"],
      ["status", "--terra-fast"],
      ["uninstall", "--agent-fast"]
    ]) {
      const lines = [];
      assert.equal(await runCli(argv, {
        cwd: dir.project,
        home: dir.home,
        output: (line) => lines.push(String(line))
      }), 1, argv.join(" "));
      assert.ok(lines.some((line) => /does not accept|conflicting|only for install/.test(line)), argv.join(" "));
    }
  } finally {
    await dir.cleanup();
  }
});

test("project and global Fast preferences remain independent", async () => {
  const dir = await fixture();
  try {
    const project = { cwd: dir.project, home: dir.home, output: quiet };
    const global = { cwd: dir.home, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--terra-fast"], project), 0);
    assert.equal(await runCli(["install", "--global", "--sol-fast"], global), 0);
    assert.equal(await agentFast(dir.project, "terra"), true);
    assert.equal(await agentFast(dir.project, "sol"), false);
    const globalSol = await readFile(join(dir.home, ".codex", "agents", "sol.toml"), "utf8");
    assert.match(globalSol, /^# codex-model-router-fast = true$/m);
    const globalTerra = await readFile(join(dir.home, ".codex", "agents", "terra.toml"), "utf8");
    assert.match(globalTerra, /^# codex-model-router-fast = false$/m);
  } finally {
    await dir.cleanup();
  }
});
