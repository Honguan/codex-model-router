import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { TEMPLATES, VERSION } from "../lib/manifest.js";
import { run } from "../lib/router.js";

const exec = promisify(execFile);
const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const binary = join(root, "bin", "codex-model-router.js");
const quiet = () => {};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-model-router-"));
  const project = join(directory, "project folder");
  const home = join(directory, "home folder");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return {
    root: directory,
    project,
    home,
    cleanup: () => rm(directory, { recursive: true, force: true })
  };
}

function managed(dir) {
  return {
    config: join(dir.project, ".codex", "config.toml"),
    state: join(dir.project, ".codex", "model-router-state.json"),
    terra: join(dir.project, ".codex", "agents", "terra.toml"),
    luna: join(dir.project, ".codex", "agents", "luna.toml"),
    sol: join(dir.project, ".codex", "agents", "sol.toml"),
    skill: join(dir.project, ".agents", "skills", "model-router", "SKILL.md"),
    planning: join(dir.project, ".agents", "skills", "implementation-planning", "SKILL.md"),
    lock: join(dir.project, ".codex", "model-router.lock"),
    journal: join(dir.project, ".codex", "model-router-transaction.json"),
    transactionData: join(dir.project, ".codex", "model-router-transaction-data")
  };
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function text(path) {
  return readFile(path, "utf8");
}

function collect() {
  const lines = [];
  return { lines, output: (line) => lines.push(String(line)) };
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function snapshot(rootPath) {
  if (!(await exists(rootPath))) return [];
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(rootPath, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        output.push([`${name}/`, null]);
        await walk(path);
      } else {
        output.push([name, (await readFile(path)).toString("base64")]);
      }
    }
  }
  await walk(rootPath);
  return output.sort((left, right) => left[0].localeCompare(right[0]));
}

async function waitFor(path, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await exists(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function executeCli(args, dir, extraEnv = {}) {
  return exec(process.execPath, [binary, ...args], {
    cwd: dir.project,
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
}

test("package version and current templates have one source of truth", async () => {
  const packageJson = JSON.parse(await text(join(root, "package.json")));
  const core = await text(join(root, "lib", "router-core.js"));
  const wrapper = await text(join(root, "lib", "router.js"));
  assert.equal(VERSION, packageJson.version);
  assert.doesNotMatch(core, /export const VERSION\s*=/);
  assert.doesNotMatch(core, /sandbox_mode = \\"read-only\\"/);
  assert.equal(wrapper.trim(), 'export { run, VERSION } from "./router-core.js";');
});

test("fresh install preserves the primary model and writes adaptive templates", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await exists(paths.config), false);
    assert.equal(await text(paths.terra), TEMPLATES.terra.content);
    assert.equal(await text(paths.luna), TEMPLATES.luna.content);
    assert.equal(await text(paths.sol), TEMPLATES.sol.content);
    assert.equal(await text(paths.skill), TEMPLATES.skill.content);
    assert.equal(await text(paths.planning), TEMPLATES.planning.content);
    assert.match(await text(paths.terra), /sandbox_mode = "read-only"/);
    assert.match(await text(paths.luna), /model_reasoning_effort = "max"/);
    assert.match(await text(paths.luna), /sandbox_mode = "workspace-write"/);
    assert.match(await text(paths.sol), /sandbox_mode = "read-only"/);
    const state = JSON.parse(await text(paths.state));
    assert.equal(state.version, 4);
    assert.equal(state.packageVersion, VERSION);
    assert.deepEqual(state.config.values, {});
    assert.equal(await exists(paths.journal), false);
    assert.equal(await exists(paths.transactionData), false);
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("legacy managed Sol and skill templates migrate without replacing user changes", async () => {
  const dir = await fixture();
  const oldSol = `name = "sol"\ndescription = "Read-only reviewer for security-sensitive or high-regression-risk logic."\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nReview only. Focus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.\nReport concrete findings to Terra; do not apply fixes.\n"""\n`;
  const oldSkill = `---\nname: model-router\ndescription: Route Codex work between Terra, Luna, and Sol with the fewest required agents.\n---\n\nTerra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.\nUse Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.\nUse Sol only as a read-only reviewer for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Terra applies fixes.\nDo not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.\n`;
  try {
    const paths = managed(dir);
    await run(["install"], { cwd: dir.project, home: dir.home, output: quiet });
    await writeFile(paths.sol, oldSol);
    await writeFile(paths.skill, oldSkill);
    const state = JSON.parse(await text(paths.state));
    state.version = 2;
    state.packageVersion = "1.0.0";
    state.files.sol.hash = hash(oldSol);
    state.files.skill.hash = hash(oldSkill);
    await writeFile(paths.state, `${JSON.stringify(state, null, 2)}\n`);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await text(paths.sol), TEMPLATES.sol.content);
    assert.equal(await text(paths.skill), TEMPLATES.skill.content);

    await writeFile(paths.sol, `${oldSol}# user edit\n`);
    const updated = JSON.parse(await text(paths.state));
    updated.files.sol.hash = hash(oldSol);
    await writeFile(paths.state, `${JSON.stringify(updated, null, 2)}\n`);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.match(await text(paths.sol), /# user edit/);
  } finally { await dir.cleanup(); }
});

test("BOM, CRLF, comments, arrays, and multiline TOML are restored byte-for-byte", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    await mkdir(dirname(paths.config), { recursive: true });
    const original = "\uFEFF# existing\r\narray = [\r\n  \"a\",\r\n]\r\nmulti = \"\"\"\r\nhello\r\n\"\"\"\r\n[tool]\r\nenabled = true\r\n";
    await writeFile(paths.config, original);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.ok((await text(paths.config)).startsWith("\uFEFF"));
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await text(paths.config), original);
  } finally { await dir.cleanup(); }
});

test("plain install preserves existing defaults and set-default restores exact prior values", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    await mkdir(dirname(paths.config), { recursive: true });
    const original = "theme = \"dark\"\nmodel = 'custom' # style\nmodel_reasoning_effort = \"low\"\n";
    await writeFile(paths.config, original);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await text(paths.config), original);
    assert.equal(await run(["install", "--set-default"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.match(await text(paths.config), /gpt-5\.6-terra/);
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await text(paths.config), original);
  } finally { await dir.cleanup(); }
});

test("uninstall preserves user-modified managed values and files", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    await run(["install", "--set-default"], { cwd: dir.project, home: dir.home, output: quiet });
    await writeFile(paths.config, (await text(paths.config)).replace("gpt-5.6-terra", "user-model"));
    await writeFile(paths.luna, "custom luna\n");
    const report = collect();
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home, output: report.output }), 0);
    assert.match(await text(paths.config), /user-model/);
    assert.equal(await text(paths.luna), "custom luna\n");
    assert.ok(report.lines.some((line) => line.startsWith("preserve: model")));
    assert.ok(report.lines.some((line) => line.startsWith("preserve: luna")));
    assert.equal(await exists(paths.state), false);
  } finally { await dir.cleanup(); }
});

test("dry-run is zero-write and reports the planned operation", async () => {
  const dir = await fixture();
  try {
    const before = await snapshot(dir.root);
    const report = collect();
    assert.equal(await run(["install", "--set-default", "--dry-run"], {
      cwd: dir.project,
      home: dir.home,
      output: report.output
    }), 0);
    assert.deepEqual(await snapshot(dir.root), before);
    assert.ok(report.lines.some((line) => line.startsWith("would-create: config.toml")));
  } finally { await dir.cleanup(); }
});

test("malformed TOML and untracked backup conflicts are refused before writes", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    await mkdir(dirname(paths.config), { recursive: true });
    await writeFile(paths.config, 'model = "broken\n');
    const before = await snapshot(dir.root);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 1);
    assert.deepEqual(await snapshot(dir.root), before);

    await writeFile(paths.config, "theme = \"dark\"\n");
    await writeFile(join(dirname(paths.config), "config.toml.codex-model-router.bak"), "user backup\n");
    const backupBefore = await snapshot(dir.root);
    assert.equal(await run(["install", "--set-default"], { cwd: dir.project, home: dir.home, output: quiet }), 1);
    assert.deepEqual(await snapshot(dir.root), backupBefore);
  } finally { await dir.cleanup(); }
});

test("project symlinks and junctions that redirect managed roots are rejected", async (context) => {
  const dir = await fixture();
  try {
    const outside = join(dir.root, "outside");
    await mkdir(outside, { recursive: true });
    const codex = join(dir.project, ".codex");
    try {
      await symlink(outside, codex, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const report = collect();
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: report.output }), 1);
    assert.ok(report.lines.some((line) => /unsafe path component|symbolic link|junction/.test(line)));
    assert.deepEqual(await readdir(outside), []);
  } finally { await dir.cleanup(); }
});

test("skill-root redirection is rejected without touching the external target", async (context) => {
  const dir = await fixture();
  try {
    const outside = join(dir.root, "outside skills");
    await mkdir(outside, { recursive: true });
    const agents = join(dir.project, ".agents");
    try {
      await symlink(outside, agents, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal(await run(["install", "--dry-run"], { cwd: dir.project, home: dir.home, output: quiet }), 1);
    assert.deepEqual(await readdir(outside), []);
  } finally { await dir.cleanup(); }
});

test("an active scope lock blocks a concurrent uninstall", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    const first = executeCli(["install"], dir, {
      CODEX_MODEL_ROUTER_TESTING: "1",
      CODEX_MODEL_ROUTER_TEST_HOLD_LOCK_MS: "1200"
    });
    await waitFor(paths.lock);
    await assert.rejects(executeCli(["uninstall"], dir), (error) => {
      assert.match(`${error.stdout || ""}${error.stderr || ""}`, /scope is locked/);
      return true;
    });
    await first;
    assert.equal(await exists(paths.lock), false);
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("a stale lock is recovered conservatively", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    await mkdir(dirname(paths.lock), { recursive: true });
    await writeFile(paths.lock, `${JSON.stringify({
      version: 1,
      token: "stale",
      pid: 2147483000,
      hostname: (await import("node:os")).hostname(),
      command: "install",
      scope: "project",
      startedAt: new Date(0).toISOString()
    })}\n`);
    const report = collect();
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: report.output }), 0);
    assert.ok(report.lines.some((line) => line.startsWith("recover: stale lock")));
    assert.equal(await exists(paths.lock), false);
  } finally { await dir.cleanup(); }
});

test("every interrupted fresh-install write can be rolled back on the next command", async () => {
  for (let crashAfter = 1; crashAfter <= 5; crashAfter += 1) {
    const dir = await fixture();
    try {
      const paths = managed(dir);
      await assert.rejects(executeCli(["install"], dir, {
        CODEX_MODEL_ROUTER_TESTING: "1",
        CODEX_MODEL_ROUTER_TEST_CRASH_AFTER: String(crashAfter)
      }), (error) => error.code === 91);
      assert.equal(await exists(paths.journal), true);
      const report = collect();
      assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: report.output }), 0);
      assert.ok(report.lines.some((line) => line.startsWith("recover:")));
      assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
      assert.equal(await exists(paths.journal), false);
      assert.equal(await exists(paths.transactionData), false);
    } finally { await dir.cleanup(); }
  }
});

test("transaction recovery never overwrites a post-interruption user edit", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    await assert.rejects(executeCli(["install"], dir, {
      CODEX_MODEL_ROUTER_TESTING: "1",
      CODEX_MODEL_ROUTER_TEST_CRASH_AFTER: "1"
    }));
    await writeFile(paths.terra, "user changed after interruption\n");
    const report = collect();
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: report.output }), 1);
    assert.ok(report.lines.some((line) => line.includes("conflicting transaction")));
    assert.equal(await text(paths.terra), "user changed after interruption\n");
  } finally { await dir.cleanup(); }
});

test("doctor distinguishes unfinished and corrupt transaction journals", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    await mkdir(dirname(paths.journal), { recursive: true });
    await writeFile(paths.journal, `${JSON.stringify({
      version: 1,
      id: "test",
      scope: "project",
      command: "install",
      createdAt: new Date().toISOString(),
      status: "preparing",
      recovery: "rollback",
      operations: []
    })}\n`);
    const unfinished = collect();
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: unfinished.output }), 1);
    assert.ok(unfinished.lines.some((line) => line.startsWith("unfinished: transaction")));
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);

    await writeFile(paths.journal, "not json\n");
    const corrupt = collect();
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: corrupt.output }), 1);
    assert.ok(corrupt.lines.some((line) => line.startsWith("corrupt: transaction")));
  } finally { await dir.cleanup(); }
});

test("global scope honors CODEX_HOME and remains independent from project scope", async () => {
  const dir = await fixture();
  try {
    const codexHome = join(dir.root, "custom CODEX_HOME");
    const env = { ...process.env, CODEX_HOME: codexHome };
    assert.equal(await run(["install", "--global"], {
      cwd: dir.project,
      home: dir.home,
      env,
      output: quiet
    }), 0);
    assert.match(await text(join(codexHome, "agents", "sol.toml")), /read-only/);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await run(["doctor", "--global"], { cwd: dir.project, home: dir.home, env, output: quiet }), 0);
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await run(["uninstall", "--global"], { cwd: dir.project, home: dir.home, env, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("uninstall removes package-created empty directories including .codex", async () => {
  const dir = await fixture();
  try {
    await run(["install"], { cwd: dir.project, home: dir.home, output: quiet });
    await run(["uninstall"], { cwd: dir.project, home: dir.home, output: quiet });
    assert.equal(await exists(join(dir.project, ".codex")), false);
    assert.equal(await exists(join(dir.project, ".agents")), false);
  } finally { await dir.cleanup(); }
});


test("managed v1.2 routing templates migrate to adaptive roles", async () => {
  const dir = await fixture();
  const oldLuna = `name = "luna"
description = "Low-risk helper for repeated edits, searches, formatting, extraction, counting, and summaries."
model = "gpt-5.6-luna"
model_reasoning_effort = "high"
developer_instructions = """
Handle only deterministic, low-risk work delegated by Terra.
Follow the assigned pattern exactly and return a concise result.
Escalate ambiguous, security-sensitive, or logic-heavy decisions to Terra.
"""
`;
  const oldSol = `name = "sol"
description = "High-capability specialist for security-sensitive or high-regression-risk work."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "workspace-write"
developer_instructions = """
Review or implement only when explicitly delegated by Terra.
For review-only tasks, report concrete findings without changing files.
For implementation tasks, make focused changes, run relevant checks, and report the result to Terra.
Focus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.
Do not expand the scope beyond the delegated task.
"""
`;
  const oldSkill = `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol with the fewest required agents.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.
Use Sol for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Prefer review-only delegation first; when implementation or a confirmed fix is explicitly required, Sol may edit files in workspace-write mode and run relevant checks.
Do not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.
`;
  try {
    const paths = managed(dir);
    await run(["install"], { cwd: dir.project, home: dir.home, output: quiet });
    await writeFile(paths.luna, oldLuna);
    await writeFile(paths.sol, oldSol);
    await writeFile(paths.skill, oldSkill);
    const state = JSON.parse(await text(paths.state));
    state.version = 3;
    state.packageVersion = "1.2.0";
    state.files.luna.hash = hash(oldLuna);
    state.files.sol.hash = hash(oldSol);
    state.files.skill.hash = hash(oldSkill);
    delete state.files.terra;
    delete state.files.planning;
    await writeFile(paths.state, `${JSON.stringify(state, null, 2)}\n`);
    await unlink(paths.terra);
    await unlink(paths.planning);

    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await text(paths.terra), TEMPLATES.terra.content);
    assert.equal(await text(paths.luna), TEMPLATES.luna.content);
    assert.equal(await text(paths.sol), TEMPLATES.sol.content);
    assert.equal(await text(paths.skill), TEMPLATES.skill.content);
    assert.equal(await text(paths.planning), TEMPLATES.planning.content);
  } finally { await dir.cleanup(); }
});

test("plain install releases package-managed defaults back to free mode", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    assert.equal(await run(["install", "--set-default"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.match(await text(paths.config), /gpt-5\.6-terra/);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await exists(paths.config), false);
    const state = JSON.parse(await text(paths.state));
    assert.deepEqual(state.config.values, {});
    assert.equal(state.backup, null);
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});
