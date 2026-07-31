import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { run as runCore } from "./router-core.js";

export const VERSION = "1.1.0";

const SOL_TEMPLATE = `name = "sol"
description = "High-capability specialist for security-sensitive or high-regression-risk work."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
# v1.0.0 used sandbox_mode = "read-only"
sandbox_mode = "workspace-write"
developer_instructions = """
Review or implement only when explicitly delegated by Terra.
For review-only tasks, report concrete findings without changing files.
For implementation tasks, make focused changes, run relevant checks, and report the result to Terra.
Focus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.
Do not expand the scope beyond the delegated task.
"""
`;

const SKILL_TEMPLATE = `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol with the fewest required agents.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.
Use Sol for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Prefer review-only delegation first; when implementation or a confirmed fix is explicitly required, Sol may edit files in workspace-write mode and run relevant checks.
Do not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.
`;

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function paths(options, global) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const home = resolve(options.home ?? homedir());
  const env = options.env ?? process.env;
  const codexHome = global ? resolve(env.CODEX_HOME || join(home, ".codex")) : join(cwd, ".codex");
  const skillsHome = global ? join(home, ".agents", "skills") : join(cwd, ".agents", "skills");
  return {
    state: join(codexHome, "model-router-state.json"),
    sol: join(codexHome, "agents", "sol.toml"),
    skill: join(skillsHome, "model-router", "SKILL.md")
  };
}

async function readText(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  let mode = 0o600;
  try { mode = (await stat(path)).mode; } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await rm(temporary, { force: true }); } catch {}
    throw error;
  }
}

async function upgradeManagedTemplates(options, global) {
  const location = paths(options, global);
  const stateText = await readText(location.state);
  if (!stateText) return;

  const state = JSON.parse(stateText);
  const updates = [];
  for (const [name, path, template] of [
    ["sol", location.sol, SOL_TEMPLATE],
    ["skill", location.skill, SKILL_TEMPLATE]
  ]) {
    const current = await readText(path);
    const tracked = state.files?.[name];
    if (!current || !tracked || hash(current) !== tracked.hash || current === template) continue;
    updates.push({ name, path, before: current, after: template });
  }

  const nextState = structuredClone(state);
  nextState.packageVersion = VERSION;
  for (const update of updates) nextState.files[update.name].hash = hash(update.after);
  const nextStateText = `${JSON.stringify(nextState, null, 2)}\n`;
  if (!updates.length && state.packageVersion === VERSION) return;

  const snapshots = new Map([[location.state, stateText]]);
  for (const update of updates) snapshots.set(update.path, update.before);
  const applied = [];
  try {
    for (const update of updates) {
      await atomicWrite(update.path, update.after);
      applied.push(update.path);
    }
    await atomicWrite(location.state, nextStateText);
    applied.push(location.state);
  } catch (error) {
    for (const path of applied.reverse()) {
      try { await atomicWrite(path, snapshots.get(path)); } catch {}
    }
    throw error;
  }
}

function parseGlobal(argv) {
  return argv.includes("--global");
}

function activeValue(content, key) {
  const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*$`, "m"));
  return match?.[1];
}

async function validateV11(options, global) {
  const location = paths(options, global);
  const stateText = await readText(location.state);
  if (!stateText) return null;

  let state;
  try { state = JSON.parse(stateText); }
  catch { return { sol: { status: "unsafe-state", detail: "state file is not valid JSON" }, skill: null }; }

  const result = {};
  const sol = await readText(location.sol);
  if (!sol) result.sol = { status: "missing" };
  else if (state.files?.sol?.hash !== hash(sol)) result.sol = { status: "user-modified", detail: "managed file hash changed" };
  else if (
    activeValue(sol, "name") !== "sol" ||
    activeValue(sol, "model") !== "gpt-5.6-sol" ||
    activeValue(sol, "model_reasoning_effort") !== "medium" ||
    activeValue(sol, "sandbox_mode") !== "workspace-write"
  ) result.sol = { status: "invalid", detail: "expected Sol/medium/workspace-write" };
  else result.sol = { status: "healthy" };

  const skill = await readText(location.skill);
  if (!skill) result.skill = { status: "missing" };
  else if (state.files?.skill?.hash !== hash(skill)) result.skill = { status: "user-modified", detail: "managed file hash changed" };
  else {
    const required = [/^name:\s*model-router\s*$/m, /Terra/i, /Luna/i, /Sol/i, /workspace-write/i, /simple question/i, /minimum number|fewest/i];
    result.skill = required.every((pattern) => pattern.test(skill))
      ? { status: "healthy" }
      : { status: "invalid", detail: "missing required routing rule" };
  }
  return result;
}

function format(status, label, detail) {
  return `${status}: ${label}${detail ? ` (${detail})` : ""}`;
}

async function runDoctor(argv, options, output) {
  const lines = [];
  await runCore(argv, { ...options, output: (line) => lines.push(String(line)) });
  if (lines.some((line) => line.startsWith("unsafe-state: state") || line.startsWith("missing: state"))) {
    for (const line of lines) output(line);
    return 1;
  }

  const v11 = await validateV11(options, parseGlobal(argv));
  const filtered = lines.filter((line) => !/^(?:healthy|invalid|user-modified|missing): (?:sol|skill)\b/.test(line));
  for (const line of filtered) output(line);
  if (v11?.sol) output(format(v11.sol.status, "sol", v11.sol.detail));
  if (v11?.skill) output(format(v11.skill.status, "skill", v11.skill.detail));

  const statuses = [
    ...filtered.map((line) => line.split(":", 1)[0]),
    v11?.sol?.status,
    v11?.skill?.status
  ].filter(Boolean);
  return statuses.every((status) => status === "healthy") ? 0 : 1;
}

export async function run(argv, options = {}) {
  const output = options.output ?? console.log;
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) {
    output(VERSION);
    return 0;
  }
  if (argv[0] === "doctor") return runDoctor(argv, options, output);

  const code = await runCore(argv, {
    ...options,
    output: (line) => output(String(line).replace("codex-model-router 1.0.0", `codex-model-router ${VERSION}`))
  });
  if (code !== 0 || argv[0] !== "install" || argv.includes("--dry-run")) return code;

  try {
    await upgradeManagedTemplates(options, parseGlobal(argv));
    return 0;
  } catch (error) {
    output(`fail: Sol upgrade (${error.message})`);
    return 1;
  }
}
