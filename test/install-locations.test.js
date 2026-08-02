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

    const project = await realpath(dir.project);
    const message = output.join("\n");
    assert.match(message, new RegExp(`location: Codex agents \\(${escapeRegExp(join(project, ".codex", "agents"))}\\)`));
    assert.match(message, new RegExp(`location: Codex user skills \\(${escapeRegExp(join(project, ".agents", "skills"))}\\)`));
    assert.match(message, new RegExp(`${escapeRegExp(join(project, ".codex", "skills", ".system"))} is reserved for bundled Codex skills`));
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
