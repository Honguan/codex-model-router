import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/cli.js";

const quiet = () => {};

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "codex-model-router-global-home-"));
  return {
    home,
    cleanup: () => rm(home, { recursive: true, force: true })
  };
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

test("global install and uninstall work when cwd equals home", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.home, home: dir.home, output: quiet };
    assert.equal(await runCli(["install", "--global"], options), 0);
    assert.equal(await exists(join(dir.home, ".codex", "agents", "luna.toml")), true);
    assert.equal(await runCli(["uninstall", "--global"], options), 0);
    assert.equal(await exists(join(dir.home, ".codex")), false);
  } finally {
    await dir.cleanup();
  }
});

test("project install rejects the user home with an actionable message", async () => {
  const dir = await fixture();
  try {
    const lines = [];
    const result = await runCli(["install"], {
      cwd: dir.home,
      home: dir.home,
      output: (line) => lines.push(String(line))
    });

    assert.equal(result, 1);
    assert.ok(lines.some((line) => line.includes("use --global or change to a project directory")));
  } finally {
    await dir.cleanup();
  }
});
