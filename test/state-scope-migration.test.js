import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/cli.js";

const quiet = () => {};
const codexAvailable = () => ({ status: 0, stdout: "codex-cli 9.9.9\n", stderr: "" });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-scope-migration-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
  return { root, home, project, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function readState(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("exact legacy home-project state migrates to global scope without overwriting user changes", async () => {
  const dir = await fixture();
  try {
    const base = { home: dir.home, spawnSync: codexAvailable };
    assert.equal(await runCli(["enable", "--global"], { ...base, cwd: dir.project, output: quiet }), 0);

    const statePath = join(dir.home, ".codex", "model-router-state.json");
    const lunaPath = join(dir.home, ".codex", "agents", "luna.toml");
    const legacy = await readState(statePath);
    legacy.scope = "project";
    await writeFile(statePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    await writeFile(lunaPath, `${await readFile(lunaPath, "utf8")}# user change\n`, "utf8");

    const statusLines = [];
    assert.equal(await runCli(["status", "--global"], {
      ...base,
      cwd: dir.home,
      output: (line) => statusLines.push(String(line))
    }), 1);
    assert.ok(statusLines.some((line) => line.includes("migration-required")));
    assert.equal((await readState(statePath)).scope, "project");

    const dryRunLines = [];
    assert.equal(await runCli(["enable", "--global", "--dry-run"], {
      ...base,
      cwd: dir.home,
      output: (line) => dryRunLines.push(String(line))
    }), 0);
    assert.ok(dryRunLines.some((line) => line === "would-migrate: state scope (project -> global)"));
    assert.equal((await readState(statePath)).scope, "project");

    const enableLines = [];
    assert.equal(await runCli(["enable", "--global"], {
      ...base,
      cwd: dir.home,
      output: (line) => enableLines.push(String(line))
    }), 0);
    assert.ok(enableLines.some((line) => line === "migrate: state scope (project -> global)"));
    assert.ok(enableLines.some((line) => line.includes("preserve: luna (user-modified)")));
    assert.equal((await readState(statePath)).scope, "global");
    assert.match(await readFile(lunaPath, "utf8"), /# user change/);
  } finally { await dir.cleanup(); }
});

test("custom CODEX_HOME scope mismatches remain blocked", async () => {
  const dir = await fixture();
  try {
    const customCodex = join(dir.root, "custom-codex");
    const env = { CODEX_HOME: customCodex };
    const base = { home: dir.home, cwd: dir.project, env, output: quiet, spawnSync: codexAvailable };
    assert.equal(await runCli(["enable", "--global"], base), 0);

    const statePath = join(customCodex, "model-router-state.json");
    const legacy = await readState(statePath);
    legacy.scope = "project";
    await writeFile(statePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const lines = [];
    assert.equal(await runCli(["enable", "--global"], {
      ...base,
      output: (line) => lines.push(String(line))
    }), 1);
    assert.ok(lines.some((line) => line.includes("state scope does not match this command")));
    assert.equal((await readState(statePath)).scope, "project");
  } finally { await dir.cleanup(); }
});
