import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { run, VERSION } from "../lib/router.js";

const exec = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-"));
  const project = join(root, "專案 folder");
  const home = join(root, "home folder");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return {
    root,
    project,
    home,
    async cleanup() { await rm(root, { recursive: true, force: true }); }
  };
}

function outputCollector() {
  const lines = [];
  return { lines, output: (line) => lines.push(String(line)) };
}

async function text(path) {
  return readFile(path, "utf8");
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function snapshotTree(root) {
  if (!(await exists(root))) return [];
  const result = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        result.push([`${name}/`, null]);
        await walk(path);
      } else {
        result.push([name, (await readFile(path)).toString("base64")]);
      }
    }
  }
  await walk(root);
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

function paths(dir) {
  return {
    config: join(dir.project, ".codex", "config.toml"),
    state: join(dir.project, ".codex", "model-router-state.json"),
    luna: join(dir.project, ".codex", "agents", "luna.toml"),
    sol: join(dir.project, ".codex", "agents", "sol.toml"),
    skill: join(dir.project, ".agents", "skills", "model-router", "SKILL.md")
  };
}

test("exposes help, version, and a working binary", async () => {
  const dir = await fixture();
  try {
    const binary = join(process.cwd(), "bin", "codex-model-router.js");
    const version = await exec(process.execPath, [binary, "--version"], { cwd: dir.project });
    assert.equal(version.stdout.trim(), VERSION);
    const install = await exec(process.execPath, [binary, "install"], { cwd: dir.project });
    assert.match(install.stdout, /create: luna/);
    const doctor = await exec(process.execPath, [binary, "doctor"], { cwd: dir.project });
    assert.match(doctor.stdout, /healthy: sol/);
  } finally { await dir.cleanup(); }
});

test("preserves a real-world BOM and CRLF TOML file byte-for-byte after uninstall", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    const original = "\uFEFF# existing config\r\n" +
      "\"quoted key\" = 'literal value'\r\n" +
      "array = [\r\n  \"a\", # inline\r\n  \"b\",\r\n]\r\n" +
      "multi = \"\"\"\r\nhello\r\nworld\r\n\"\"\"\r\n" +
      "literal_multi = '''\r\nliteral\r\ntext\r\n'''\r\n\r\n" +
      "[tool.example]\r\nenabled = true\r\n" +
      "[[tool.example.items]]\r\nname = \"one\"\r\n";
    await writeFile(p.config, original, "utf8");

    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 0);
    const installed = await text(p.config);
    assert.ok(installed.startsWith("\uFEFF"));
    assert.match(installed, /model = "gpt-5\.6-terra"\r\n/);
    assert.match(installed, /model_reasoning_effort = "high"\r\n/);
    assert.ok(!installed.replaceAll("\r\n", "").includes("\n"));

    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home }), 0);
    assert.equal(await text(p.config), original);
  } finally { await dir.cleanup(); }
});

test("plain install preserves existing model defaults and unrelated settings", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    const original = "theme = \"dark\"\nmodel = \"custom-model\"\nmodel_reasoning_effort = 'medium'\n";
    await writeFile(p.config, original);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 0);
    assert.equal(await text(p.config), original);
    const report = outputCollector();
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: report.output }), 1);
    assert.ok(report.lines.some((line) => line.startsWith("user-override: model")));
    assert.ok(report.lines.some((line) => line.startsWith("user-override: model_reasoning_effort")));
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home }), 0);
    assert.equal(await text(p.config), original);
  } finally { await dir.cleanup(); }
});

test("set-default restores exact prior values and repeated runs keep the original prior values", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    const original = "model = 'custom-model' # keep style\nmodel_reasoning_effort = \"medium\"\n[agents]\nenabled = true\n";
    await writeFile(p.config, original);

    assert.equal(await run(["install", "--set-default"], { cwd: dir.project, home: dir.home }), 0);
    assert.match(await text(p.config), /^model = "gpt-5\.6-terra" # keep style$/m);
    assert.equal(await run(["install", "--set-default"], { cwd: dir.project, home: dir.home }), 0);
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home }), 0);
    assert.equal(await text(p.config), original);
  } finally { await dir.cleanup(); }
});

test("uninstall preserves a user-edited default while restoring untouched values", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    await writeFile(p.config, "model = \"old\"\nmodel_reasoning_effort = \"low\"\n");
    await run(["install", "--set-default"], { cwd: dir.project, home: dir.home });
    await writeFile(p.config, (await text(p.config)).replace("gpt-5.6-terra", "user-model"));
    const report = outputCollector();
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home, output: report.output }), 0);
    const result = await text(p.config);
    assert.match(result, /model = "user-model"/);
    assert.match(result, /model_reasoning_effort = "low"/);
    assert.ok(report.lines.some((line) => line === "preserve: model (user-modified)"));
    assert.equal(await exists(p.state), false);
  } finally { await dir.cleanup(); }
});

test("removing inserted values preserves a later inline comment", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await run(["install"], { cwd: dir.project, home: dir.home });
    await writeFile(p.config, (await text(p.config)).replace('model = "gpt-5.6-terra"', 'model = "gpt-5.6-terra" # user note'));
    await run(["uninstall"], { cwd: dir.project, home: dir.home });
    assert.equal(await text(p.config), "# user note\n");
  } finally { await dir.cleanup(); }
});

test("uninstall cleans stale state for manually deleted managed files", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await run(["install"], { cwd: dir.project, home: dir.home });
    await unlink(p.luna);
    await unlink(p.sol);
    await unlink(p.skill);
    const report = outputCollector();
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home, output: report.output }), 0);
    assert.ok(report.lines.some((line) => line === "skip: luna (already missing)"));
    assert.equal(await exists(p.state), false);
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home }), 0);
  } finally { await dir.cleanup(); }
});

test("uninstall preserves modified managed files but removes package state", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await run(["install"], { cwd: dir.project, home: dir.home });
    await writeFile(p.luna, "user agent\n");
    await writeFile(p.skill, "user skill\n");
    const report = outputCollector();
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home, output: report.output }), 0);
    assert.equal(await text(p.luna), "user agent\n");
    assert.equal(await text(p.skill), "user skill\n");
    assert.equal(await exists(p.state), false);
    assert.ok(report.lines.some((line) => line === "preserve: luna (user-modified)"));
  } finally { await dir.cleanup(); }
});

test("dry-run install and uninstall make zero filesystem changes", async () => {
  const dir = await fixture();
  try {
    const beforeInstall = await snapshotTree(dir.root);
    const installReport = outputCollector();
    assert.equal(await run(["install", "--set-default", "--dry-run"], { cwd: dir.project, home: dir.home, output: installReport.output }), 0);
    assert.deepEqual(await snapshotTree(dir.root), beforeInstall);
    assert.ok(installReport.lines.some((line) => line.startsWith("would-create: config.toml")));

    await run(["install"], { cwd: dir.project, home: dir.home });
    const beforeUninstall = await snapshotTree(dir.root);
    const uninstallReport = outputCollector();
    assert.equal(await run(["uninstall", "--dry-run"], { cwd: dir.project, home: dir.home, output: uninstallReport.output }), 0);
    assert.deepEqual(await snapshotTree(dir.root), beforeUninstall);
    assert.ok(uninstallReport.lines.some((line) => line.startsWith("would-remove: luna")));
  } finally { await dir.cleanup(); }
});

test("malformed TOML is refused without creating or changing files", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    await writeFile(p.config, "model = \"broken\n");
    const before = await snapshotTree(dir.root);
    const report = outputCollector();
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: report.output }), 1);
    assert.deepEqual(await snapshotTree(dir.root), before);
    assert.ok(report.lines.some((line) => /unterminated string|newline in single-line string/.test(line)));
  } finally { await dir.cleanup(); }
});

test("doctor validates skill, agent settings, hashes, backup, and unsafe state paths", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    await writeFile(p.config, "theme = \"dark\"\n");
    await run(["install"], { cwd: dir.project, home: dir.home });
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home }), 0);

    await writeFile(p.skill, "---\nname: wrong\ndescription: bad\n---\nmissing rules\n");
    const invalidSkill = outputCollector();
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: invalidSkill.output }), 1);
    assert.ok(invalidSkill.lines.some((line) => line.startsWith("user-modified: skill")));

    const state = JSON.parse(await text(p.state));
    state.files.luna.path = join(dir.root, "outside.toml");
    await writeFile(p.state, `${JSON.stringify(state, null, 2)}\n`);
    const unsafe = outputCollector();
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: unsafe.output }), 1);
    assert.ok(unsafe.lines.some((line) => line.startsWith("unsafe-state: state")));
  } finally { await dir.cleanup(); }
});

test("global install honors CODEX_HOME and uses the user skill directory", async () => {
  const dir = await fixture();
  try {
    const codexHome = join(dir.root, "custom CODEX_HOME");
    const env = { CODEX_HOME: codexHome };
    assert.equal(await run(["install", "--global"], { cwd: dir.project, home: dir.home, env }), 0);
    assert.match(await text(join(codexHome, "config.toml")), /gpt-5\.6-terra/);
    assert.match(await text(join(codexHome, "agents", "sol.toml")), /sandbox_mode = "read-only"/);
    assert.match(await text(join(dir.home, ".agents", "skills", "model-router", "SKILL.md")), /minimum number/);
    assert.equal(await run(["doctor", "--global"], { cwd: dir.project, home: dir.home, env }), 0);
    assert.equal(await run(["uninstall", "--global"], { cwd: dir.project, home: dir.home, env }), 0);
  } finally { await dir.cleanup(); }
});

test("global set-default restores prior values", async () => {
  const dir = await fixture();
  try {
    const env = { CODEX_HOME: join(dir.root, "global codex") };
    const config = join(env.CODEX_HOME, "config.toml");
    await mkdir(env.CODEX_HOME, { recursive: true });
    const original = "model = \"global-custom\"\nmodel_reasoning_effort = \"low\"\n";
    await writeFile(config, original);
    assert.equal(await run(["install", "--global", "--set-default"], { cwd: dir.project, home: dir.home, env }), 0);
    assert.match(await text(config), /gpt-5\.6-terra/);
    assert.equal(await run(["uninstall", "--global"], { cwd: dir.project, home: dir.home, env }), 0);
    assert.equal(await text(config), original);
  } finally { await dir.cleanup(); }
});

test("an untracked backup conflict is rejected before any write", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    await writeFile(p.config, "theme = \"dark\"\n");
    await writeFile(join(dir.project, ".codex", "config.toml.codex-model-router.bak"), "user backup\n");
    const before = await snapshotTree(dir.root);
    const report = outputCollector();
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: report.output }), 1);
    assert.deepEqual(await snapshotTree(dir.root), before);
    assert.ok(report.lines.some((line) => line.includes("untracked backup")));
  } finally { await dir.cleanup(); }
});

test("invalid bare TOML and non-string managed values are refused", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    await writeFile(p.config, "value = ???\n");
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 1);
    await writeFile(p.config, "model = [\"not\", \"a\", \"string\"]\n");
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 1);
    assert.equal(await exists(p.state), false);
  } finally { await dir.cleanup(); }
});

test("doctor reports manual agent changes as user-modified", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await run(["install"], { cwd: dir.project, home: dir.home });
    await writeFile(p.sol, (await text(p.sol)).replace('model_reasoning_effort = "medium"', 'model_reasoning_effort = "high"'));
    const report = outputCollector();
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: report.output }), 1);
    assert.ok(report.lines.some((line) => line.startsWith("user-modified: sol")));
  } finally { await dir.cleanup(); }
});

test("pre-existing agent and skill files are preserved", async () => {
  const dir = await fixture();
  try {
    const p = paths(dir);
    await mkdir(join(dir.project, ".codex", "agents"), { recursive: true });
    await mkdir(join(dir.project, ".agents", "skills", "model-router"), { recursive: true });
    await writeFile(p.luna, "custom luna\n");
    await writeFile(p.sol, "custom sol\n");
    await writeFile(p.skill, "custom skill\n");
    await run(["install"], { cwd: dir.project, home: dir.home });
    assert.equal(await text(p.luna), "custom luna\n");
    assert.equal(await text(p.sol), "custom sol\n");
    assert.equal(await text(p.skill), "custom skill\n");
    await run(["uninstall"], { cwd: dir.project, home: dir.home });
    assert.equal(await text(p.luna), "custom luna\n");
  } finally { await dir.cleanup(); }
});
