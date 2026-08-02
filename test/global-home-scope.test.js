import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/cli.js";

const quiet = () => {};
const codexAvailable = () => ({ status: 0, stdout: "codex-cli 9.9.9\n", stderr: "" });

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "codex-model-router-global-home-"));
  return {
    home,
    cleanup: () => rm(home, { recursive: true, force: true })
  };
}

test("explicit global lifecycle commands work when cwd equals home", async () => {
  const dir = await fixture();
  try {
    const options = {
      cwd: dir.home,
      home: dir.home,
      output: quiet,
      spawnSync: codexAvailable
    };

    assert.equal(await runCli(["enable", "--global"], options), 0);
    assert.equal(await runCli(["status", "--global"], options), 0);
    assert.equal(await runCli(["repair", "--global"], options), 0);
    assert.equal(await runCli(["v2", "status", "--global"], options), 0);
    assert.equal(await runCli(["disable", "--global"], options), 0);
  } finally {
    await dir.cleanup();
  }
});

test("project lifecycle commands reject the user home with an actionable message", async () => {
  const dir = await fixture();
  try {
    const lines = [];
    const result = await runCli(["enable"], {
      cwd: dir.home,
      home: dir.home,
      output: (line) => lines.push(String(line)),
      spawnSync: codexAvailable
    });

    assert.equal(result, 1);
    assert.ok(lines.some((line) => line.includes("use --global or change to an actual project directory")));
  } finally {
    await dir.cleanup();
  }
});
