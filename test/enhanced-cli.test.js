import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectInstallation, reasoningWarnings, resolveLocations, runCli } from "../lib/cli.js";
import { TEMPLATES } from "../lib/manifest.js";

const quiet = () => {};
const codexAvailable = () => ({ status: 0, stdout: "codex-cli 9.9.9\n", stderr: "" });
const codexMissing = () => ({ status: 1, stdout: "", stderr: "", error: Object.assign(new Error("not found"), { code: "ENOENT" }) });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-enhanced-"));
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

test("default reasoning is warning-free and weak profiles use stable warning codes", () => {
  assert.deepEqual(reasoningWarnings({ terra: "high", luna: "xhigh", sol: "medium" }), []);
  assert.deepEqual(
    reasoningWarnings({ terra: "low", luna: "max", sol: "none" }).map((warning) => warning.code),
    ["CMR001", "CMR002", "CMR004"]
  );
});

test("overlapping project and global Codex roots are rejected before project writes", async () => {
  const dir = await fixture();
  try {
    const lines = [];
    const result = await runCli(["enable", "--dry-run"], {
      cwd: dir.project,
      home: dir.home,
      env: { CODEX_HOME: join(dir.project, ".codex") },
      output: (line) => lines.push(String(line))
    });
    assert.equal(result, 1);
    assert.equal(await exists(join(dir.project, ".codex")), false);
    assert.ok(lines.some((line) => line.includes("same Codex root")));
  } finally { await dir.cleanup(); }
});

test("installed skill inlines matching primary roles and status reports resolved details", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet, spawnSync: codexAvailable };
    assert.equal(await runCli(["enable"], options), 0);
    const skill = await readFile(join(dir.project, ".agents", "skills", "model-router", "SKILL.md"), "utf8");
    assert.match(skill, /Inline a matching primary role/);
    assert.match(skill, /Terra primary/);
    assert.match(skill, /Luna primary/);
    assert.match(skill, /Sol primary/);

    const lines = [];
    assert.equal(await runCli(["status"], { ...options, output: (line) => lines.push(String(line)) }), 0);
    assert.ok(lines.some((line) => line === "routing: auto-primary-aware"));
    assert.ok(lines.some((line) => line.startsWith("path: codex=")));
    assert.ok(lines.some((line) => line === "preflight: codex=available (codex-cli 9.9.9)"));
  } finally { await dir.cleanup(); }
});

test("status JSON distinguishes configured primary values from unknown runtime identity", async () => {
  const dir = await fixture();
  try {
    const base = { cwd: dir.project, home: dir.home, spawnSync: codexAvailable };
    assert.equal(await runCli(["enable", "--set-default"], { ...base, output: quiet }), 0);
    const lines = [];
    assert.equal(await runCli(["status", "--json"], { ...base, output: (line) => lines.push(String(line)) }), 0);
    const report = JSON.parse(lines.join("\n"));
    assert.equal(report.primary.model, "gpt-5.6-terra");
    assert.equal(report.primary.ownership, "package-managed");
    assert.equal(report.primary.runtime, "unknown-not-exposed-by-codex");
    assert.equal(report.preflight.model_access.status, "unknown");
    assert.equal(report.routing_mode, "auto-primary-aware");
  } finally { await dir.cleanup(); }
});

test("reasoning combinations remain allowed but emit semantic warnings", async () => {
  const dir = await fixture();
  try {
    const lines = [];
    assert.equal(await runCli([
      "enable",
      "--terra-reasoning", "low",
      "--luna-reasoning", "max",
      "--sol-reasoning", "none"
    ], {
      cwd: dir.project,
      home: dir.home,
      spawnSync: codexAvailable,
      output: (line) => lines.push(String(line))
    }), 0);
    assert.ok(lines.some((line) => line.startsWith("warning[CMR001]")));
    assert.ok(lines.some((line) => line.startsWith("warning[CMR002]")));
    assert.ok(lines.some((line) => line.startsWith("warning[CMR004]")));
  } finally { await dir.cleanup(); }
});

test("adopt safely takes ownership only of recognized orphaned templates", async () => {
  const dir = await fixture();
  try {
    const skill = join(dir.project, ".agents", "skills", "model-router", "SKILL.md");
    await mkdir(join(dir.project, ".agents", "skills", "model-router"), { recursive: true });
    await writeFile(skill, TEMPLATES.skill.content, "utf8");

    const options = { cwd: dir.project, home: dir.home, output: quiet, spawnSync: codexAvailable };
    assert.equal(await runCli(["adopt", "--dry-run"], options), 0);
    assert.equal(await exists(join(dir.project, ".codex", "model-router-state.json")), false);
    assert.equal(await runCli(["adopt"], options), 0);
    assert.equal(await exists(join(dir.project, ".codex", "agents", "terra.toml")), true);
    assert.equal(await runCli(["status"], options), 0);
  } finally { await dir.cleanup(); }
});

test("adopt refuses unrecognized files and repair recreates missing managed files", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet, spawnSync: codexAvailable };
    const luna = join(dir.project, ".codex", "agents", "luna.toml");
    await mkdir(join(dir.project, ".codex", "agents"), { recursive: true });
    await writeFile(luna, "user owned\n", "utf8");
    assert.equal(await runCli(["adopt"], options), 1);
    assert.equal(await exists(join(dir.project, ".codex", "model-router-state.json")), false);

    await rm(join(dir.project, ".codex"), { recursive: true, force: true });
    assert.equal(await runCli(["enable"], options), 0);
    await unlink(luna);
    assert.equal(await runCli(["repair"], options), 0);
    assert.match(await readFile(luna, "utf8"), /gpt-5\.6-luna/);
  } finally { await dir.cleanup(); }
});

test("status detects conflicting same-named agents across scopes", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet, spawnSync: codexAvailable };
    assert.equal(await runCli(["enable"], options), 0);
    assert.equal(await runCli(["enable", "--global"], options), 0);
    const locations = await resolveLocations(options, false);
    const globalTerra = await readFile(locations.global.terra, "utf8");
    await writeFile(locations.global.terra, globalTerra.replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "low"'), "utf8");

    const report = await inspectInstallation(options, false);
    const terra = report.cross_scope.find((entry) => entry.name === "terra");
    assert.deepEqual(terra, {
      name: "terra",
      status: "conflict",
      fields: ["model_reasoning_effort"],
      project_ownership: "package-managed",
      global_ownership: "user-modified"
    });
    assert.equal(await runCli(["status"], options), 1);
  } finally { await dir.cleanup(); }
});

test("status detects sandbox and instruction conflicts across scopes", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet, spawnSync: codexAvailable };
    assert.equal(await runCli(["enable"], options), 0);
    assert.equal(await runCli(["enable", "--global"], options), 0);
    const locations = await resolveLocations(options, false);
    const globalSol = await readFile(locations.global.sol, "utf8");
    await writeFile(
      locations.global.sol,
      globalSol
        .replace('sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"')
        .replace("Analyze only the unresolved logical conflict.", "Analyze a changed logical conflict."),
      "utf8"
    );
    const report = await inspectInstallation(options, false);
    const sol = report.cross_scope.find((entry) => entry.name === "sol");
    assert.equal(sol.status, "conflict");
    assert.deepEqual(sol.fields, ["sandbox_mode", "instructions_hash"]);
  } finally { await dir.cleanup(); }
});

test("preflight is non-billable and strict failure is opt-in", async () => {
  const dir = await fixture();
  try {
    const options = { cwd: dir.project, home: dir.home, output: quiet, spawnSync: codexMissing };
    assert.equal(await runCli(["enable"], options), 0);
    assert.equal(await runCli(["status"], options), 0);
    assert.equal(await runCli(["status", "--strict-preflight"], options), 1);
  } finally { await dir.cleanup(); }
});
