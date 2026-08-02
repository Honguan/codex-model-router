import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/cli-v2.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-install-locations-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return { project, home, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("project install reports Codex agents and Agent Skills standard locations", async () => {
  const dir = await fixture();
  try {
    const output = [];
    assert.equal(await runCli(["install"], {
      cwd: dir.project,
      home: dir.home,
      output: (line) => output.push(String(line))
    }), 0);

    const message = output.join("\n");
    assert.match(message, new RegExp(`location: Codex agents \\(${escapeRegExp(join(dir.project, ".codex", "agents"))}\\)`));
    assert.match(message, new RegExp(`location: Codex user skills \\(${escapeRegExp(join(dir.project, ".agents", "skills"))}\\)`));
    assert.match(message, new RegExp(`${escapeRegExp(join(dir.project, ".codex", "skills", ".system"))} is reserved for bundled Codex skills`));
  } finally {
    await dir.cleanup();
  }
});

test("global install reports the current user's Codex and skill locations", async () => {
  const dir = await fixture();
  try {
    const output = [];
    assert.equal(await runCli(["install", "--global", "--v2"], {
      cwd: dir.home,
      home: dir.home,
      output: (line) => output.push(String(line))
    }), 0);

    const home = await realpath(dir.home);
    const message = output.join("\n");
    assert.match(message, new RegExp(`location: Codex agents \\(${escapeRegExp(join(home, ".codex", "agents"))}\\)`));
    assert.match(message, new RegExp(`location: Codex user skills \\(${escapeRegExp(join(home, ".agents", "skills"))}\\)`));
  } finally {
    await dir.cleanup();
  }
});

test("install and uninstall report every managed file with its full path", async () => {
  const dir = await fixture();
  try {
    const installOutput = [];
    assert.equal(await runCli(["install", "--global", "--v2"], {
      cwd: dir.home,
      home: dir.home,
      output: (line) => installOutput.push(String(line))
    }), 0);

    const home = await realpath(dir.home);
    const codex = join(home, ".codex");
    const skills = join(home, ".agents", "skills");
    const files = {
      config: join(codex, "config.toml"),
      v2State: join(codex, "model-router-v2-state.json"),
      terra: join(codex, "agents", "terra.toml"),
      luna: join(codex, "agents", "luna.toml"),
      sol: join(codex, "agents", "sol.toml"),
      skill: join(skills, "model-router", "SKILL.md"),
      planning: join(skills, "implementation-planning", "SKILL.md"),
      state: join(codex, "model-router-state.json")
    };
    const installed = installOutput.join("\n");
    for (const path of Object.values(files)) {
      assert.match(installed, new RegExp(`(?:create|update|repair|skip|preserve): ${escapeRegExp(path)}(?: \\(|$)`, "m"));
    }
    assert.doesNotMatch(installed, /^(?:create|update|repair|skip|preserve): (?:terra|luna|sol|skill|planning|state)(?: \(|$)/m);

    const uninstallOutput = [];
    assert.equal(await runCli(["uninstall", "--global"], {
      cwd: dir.home,
      home: dir.home,
      output: (line) => uninstallOutput.push(String(line))
    }), 0);

    const removed = uninstallOutput.join("\n");
    for (const path of Object.values(files)) {
      assert.match(removed, new RegExp(`remove: ${escapeRegExp(path)}(?: \\(|$)`, "m"));
    }
    assert.match(removed, new RegExp(`remove-if-empty: ${escapeRegExp(join(skills, "implementation-planning"))}$`, "m"));
    assert.match(removed, new RegExp(`remove-if-empty: ${escapeRegExp(join(skills, "model-router"))}$`, "m"));
    assert.match(removed, new RegExp(`remove-if-empty: ${escapeRegExp(join(codex, "agents"))}$`, "m"));
    assert.doesNotMatch(removed, /^remove: (?:terra|luna|sol|skill|planning|state)$/m);
  } finally {
    await dir.cleanup();
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
