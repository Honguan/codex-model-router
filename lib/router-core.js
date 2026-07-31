import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  stat
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { applyEdits, insertionEdit, parseStringValue, removalEdit, scanToml } from "./toml.js";

export const VERSION = "1.0.0";

const DEFAULTS = {
  model: "gpt-5.6-terra",
  model_reasoning_effort: "high"
};

const TEMPLATES = {
  luna: {
    relative: ["agents", "luna.toml"],
    content: `name = "luna"
description = "Low-risk helper for repeated edits, searches, formatting, extraction, counting, and summaries."
model = "gpt-5.6-luna"
model_reasoning_effort = "high"
developer_instructions = """
Handle only deterministic, low-risk work delegated by Terra.
Follow the assigned pattern exactly and return a concise result.
Escalate ambiguous, security-sensitive, or logic-heavy decisions to Terra.
"""
`
  },
  sol: {
    relative: ["agents", "sol.toml"],
    content: `name = "sol"
description = "Read-only reviewer for security-sensitive or high-regression-risk logic."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"
developer_instructions = """
Review only. Focus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.
Report concrete findings to Terra; do not apply fixes.
"""
`
  },
  skill: {
    content: `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol with the fewest required agents.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.
Use Sol only as a read-only reviewer for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Terra applies fixes.
Do not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.
`
  }
};

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function quoteToml(value) {
  return JSON.stringify(value);
}

function expectedPaths({ cwd, home, global, env }) {
  const userHome = resolve(home ?? homedir());
  const projectRoot = resolve(cwd);
  const codexHome = global
    ? resolve(env?.CODEX_HOME || join(userHome, ".codex"))
    : join(projectRoot, ".codex");
  const skillsHome = global
    ? join(userHome, ".agents", "skills")
    : join(projectRoot, ".agents", "skills");
  return {
    scope: global ? "global" : "project",
    projectRoot,
    userHome,
    codexHome,
    skillsHome,
    skillsRoot: dirname(skillsHome),
    config: join(codexHome, "config.toml"),
    state: join(codexHome, "model-router-state.json"),
    backup: join(codexHome, "config.toml.codex-model-router.bak"),
    luna: join(codexHome, ...TEMPLATES.luna.relative),
    sol: join(codexHome, ...TEMPLATES.sol.relative),
    skill: join(skillsHome, "model-router", "SKILL.md")
  };
}

async function pathExists(path) {
  try { await access(path); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readText(path) {
  try {
    const bytes = await readFile(path);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      const error = new Error(`${path} is not valid UTF-8`);
      error.code = "INVALID_UTF8";
      throw error;
    }
    return { exists: true, text };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: undefined };
    throw error;
  }
}

async function directoryExists(path) {
  try { return (await stat(path)).isDirectory(); } catch (error) {
    if (error?.code === "ENOENT") return false;
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

function isWithin(path, root) {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function assertExactPath(actual, expected, label) {
  if (resolve(actual) !== resolve(expected)) throw new Error(`unsafe state path for ${label}`);
}

function freshState(location) {
  return {
    version: 2,
    packageVersion: VERSION,
    scope: location.scope,
    roots: { codex: location.codexHome, skills: location.skillsHome, skillsRoot: location.skillsRoot },
    config: { path: location.config, createdFile: false, values: {} },
    files: {},
    backup: null,
    createdDirs: []
  };
}

function normalizeLegacyState(raw, location) {
  const state = freshState(location);
  if (!raw?.config || !raw?.files) throw new Error("invalid legacy state structure");
  assertExactPath(raw.config.path, location.config, "config");
  state.config.values = {};
  for (const [key, item] of Object.entries(raw.config.values || {})) {
    if (!Object.hasOwn(DEFAULTS, key) || item?.installed !== DEFAULTS[key]) throw new Error(`invalid legacy state value: ${key}`);
    state.config.values[key] = {
      installed: item.installed,
      previousRaw: item.previous == null ? null : quoteToml(String(item.previous)),
      source: item.previous == null ? "inserted" : "replaced"
    };
  }
  for (const name of ["luna", "sol", "skill"]) {
    const item = raw.files[name];
    if (!item) continue;
    assertExactPath(item.path, location[name], name);
    state.files[name] = { path: location[name], hash: item.hash };
  }
  if (raw.backup) {
    assertExactPath(raw.backup.path, location.backup, "backup");
    state.backup = { path: location.backup, hash: raw.backup.hash };
  }
  return state;
}

function validateState(raw, location) {
  if (!raw || typeof raw !== "object") throw new Error("state is not an object");
  const state = raw.version ? structuredClone(raw) : normalizeLegacyState(raw, location);
  if (state.version !== 2) throw new Error(`unsupported state version: ${state.version}`);
  if (state.scope !== location.scope) throw new Error("state scope does not match this command");
  assertExactPath(state.roots?.codex, location.codexHome, "Codex root");
  assertExactPath(state.roots?.skills, location.skillsHome, "skills root");
  assertExactPath(state.roots?.skillsRoot ?? dirname(state.roots?.skills || ""), location.skillsRoot, "skills parent root");
  assertExactPath(state.config?.path, location.config, "config");
  if (typeof state.config.createdFile !== "boolean" || typeof state.config.values !== "object") throw new Error("invalid config state");
  for (const [key, item] of Object.entries(state.config.values)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`unknown managed config key: ${key}`);
    if (item?.installed !== DEFAULTS[key]) throw new Error(`invalid installed value for ${key}`);
    if (!(item.previousRaw === null || typeof item.previousRaw === "string")) throw new Error(`invalid previous value for ${key}`);
  }
  state.files ||= {};
  for (const [name, item] of Object.entries(state.files)) {
    if (!Object.hasOwn(TEMPLATES, name)) throw new Error(`unknown managed file: ${name}`);
    assertExactPath(item.path, location[name], name);
    if (!/^[a-f0-9]{64}$/.test(item.hash || "")) throw new Error(`invalid hash for ${name}`);
  }
  if (state.backup) {
    assertExactPath(state.backup.path, location.backup, "backup");
    if (!/^[a-f0-9]{64}$/.test(state.backup.hash || "")) throw new Error("invalid backup hash");
  }
  if (!Array.isArray(state.createdDirs)) throw new Error("invalid createdDirs state");
  for (const directory of state.createdDirs) {
    if (!isWithin(directory, location.codexHome) && !isWithin(directory, location.skillsRoot)) {
      throw new Error(`unsafe managed directory: ${directory}`);
    }
  }
  state.packageVersion = VERSION;
  return state;
}

async function loadState(location) {
  const file = await readText(location.state);
  if (!file.exists) return { exists: false, state: freshState(location) };
  let raw;
  try { raw = JSON.parse(file.text); } catch { throw new Error("state file is not valid JSON"); }
  return { exists: true, state: validateState(raw, location) };
}

function rootAssignments(scan) {
  const values = new Map();
  for (const assignment of scan.assignments) {
    if (assignment.table.length === 0 && assignment.keySegments.length === 1) {
      const key = assignment.keySegments[0];
      if (values.has(key)) throw new Error(`duplicate top-level ${key}`);
      values.set(key, assignment);
    }
  }
  return values;
}

function semanticValue(assignment) {
  return assignment?.parsedValue?.kind === "string" ? assignment.parsedValue.value : null;
}

function addMessage(plan, status, label, detail) {
  plan.messages.push({ status, label, detail });
}

function addWrite(plan, path, content, status, label) {
  plan.operations.push({ kind: "write", path, content });
  addMessage(plan, status, label);
}

function addDelete(plan, path, label) {
  plan.operations.push({ kind: "delete", path });
  addMessage(plan, "remove", label);
}

function addRemoveDirectory(plan, path) {
  plan.operations.push({ kind: "rmdir", path });
  addMessage(plan, "remove-if-empty", path);
}

function failPlan(plan, message) {
  plan.failed = true;
  addMessage(plan, "fail", "operation", message);
}

function stateJson(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

async function missingDirectories(location) {
  const candidates = [
    location.codexHome,
    dirname(location.luna),
    location.skillsRoot,
    location.skillsHome,
    dirname(location.skill)
  ];
  const unique = [...new Set(candidates.map((value) => resolve(value)))].sort((a, b) => a.length - b.length);
  const missing = [];
  for (const directory of unique) if (!(await directoryExists(directory))) missing.push(directory);
  return missing;
}

function patchInstallConfig(original, state, setDefault) {
  const scan = scanToml(original);
  const edits = [];
  const additions = [];
  const nextValues = structuredClone(state.config.values || {});

  for (const [key, installed] of Object.entries(DEFAULTS)) {
    const assignment = scan.targets.get(key);
    const tracked = nextValues[key];
    if (assignment && assignment.parsedValue.kind !== "string") throw new Error(`${key} must be a TOML string`);
    const current = semanticValue(assignment);

    if (!assignment) {
      additions.push(`${key} = ${quoteToml(installed)}`);
      nextValues[key] = tracked || { installed, previousRaw: null, source: "inserted" };
      continue;
    }

    if (!setDefault) {
      if (tracked && current !== installed) {
        // Keep ownership metadata so doctor can identify the later user edit.
      }
      continue;
    }

    if (current === installed) continue;
    edits.push({ start: assignment.valueStart, end: assignment.valueEnd, text: quoteToml(installed) });
    nextValues[key] = tracked || { installed, previousRaw: assignment.rawValue, source: "replaced" };
  }

  const insert = insertionEdit(original, scan, additions);
  if (insert) edits.push(insert);
  return { content: edits.length ? applyEdits(original, edits) : original, values: nextValues, changed: edits.length > 0 };
}

function patchUninstallConfig(original, stateValues) {
  const scan = scanToml(original);
  const edits = [];
  const preserved = [];
  for (const [key, item] of Object.entries(stateValues || {})) {
    const assignment = scan.targets.get(key);
    if (!assignment) continue;
    if (semanticValue(assignment) !== item.installed) {
      preserved.push(key);
      continue;
    }
    if (item.previousRaw === null) edits.push(removalEdit(assignment));
    else edits.push({ start: assignment.valueStart, end: assignment.valueEnd, text: item.previousRaw });
  }
  return { content: edits.length ? applyEdits(original, edits) : original, changed: edits.length > 0, preserved };
}

async function planInstall(scope, flags) {
  const location = expectedPaths(scope);
  const plan = { command: "install", location, operations: [], messages: [], failed: false };
  let loaded;
  try { loaded = await loadState(location); } catch (error) { failPlan(plan, error.message); return plan; }
  const state = loaded.state;
  const config = await readText(location.config);
  const original = config.exists ? config.text : "";
  let patched;
  try { patched = patchInstallConfig(original, state, flags.setDefault); }
  catch (error) { failPlan(plan, error.message); return plan; }

  const createdDirs = await missingDirectories(location);
  plan.createdDirs = createdDirs;
  state.createdDirs = [...new Set([...(state.createdDirs || []), ...createdDirs])];
  state.config.createdFile = state.config.createdFile || (!config.exists && patched.changed);
  state.config.values = patched.values;

  if (patched.changed) {
    if (!state.backup && config.exists) {
      const backup = await readText(location.backup);
      if (backup.exists) {
        failPlan(plan, `untracked backup already exists: ${location.backup}`);
        return plan;
      }
      state.backup = { path: location.backup, hash: hash(original) };
      addWrite(plan, location.backup, original, "create", "config backup");
    }
    addWrite(plan, location.config, patched.content, config.exists ? "update" : "create", "config.toml");
  } else {
    addMessage(plan, "preserve", "config.toml", flags.setDefault ? "already matches or contains protected values" : "existing defaults preserved");
  }

  for (const name of ["luna", "sol", "skill"]) {
    const current = await readText(location[name]);
    const tracked = state.files[name];
    const template = TEMPLATES[name].content;
    if (!current.exists) {
      state.files[name] = { path: location[name], hash: hash(template) };
      addWrite(plan, location[name], template, "create", name);
    } else if (tracked && hash(current.text) === tracked.hash) {
      addMessage(plan, "skip", name, "already managed");
    } else {
      addMessage(plan, "preserve", name, tracked ? "user-modified" : "pre-existing");
    }
  }

  state.packageVersion = VERSION;
  const existingState = await readText(location.state);
  addWrite(plan, location.state, stateJson(state), existingState.exists ? "update" : "create", "state");
  return plan;
}

async function planUninstall(scope) {
  const location = expectedPaths(scope);
  const plan = { command: "uninstall", location, operations: [], messages: [], failed: false };
  let loaded;
  try { loaded = await loadState(location); } catch (error) { failPlan(plan, error.message); return plan; }
  if (!loaded.exists) {
    addMessage(plan, "skip", "state", "not installed");
    return plan;
  }
  const state = loaded.state;
  const config = await readText(location.config);
  if (Object.keys(state.config.values || {}).length && config.exists) {
    let patched;
    try { patched = patchUninstallConfig(config.text, state.config.values); }
    catch (error) { failPlan(plan, error.message); return plan; }
    for (const key of patched.preserved) addMessage(plan, "preserve", key, "user-modified");
    if (patched.changed) {
      const empty = patched.content.replace(/^\uFEFF/, "").trim() === "";
      if (state.config.createdFile && empty) addDelete(plan, location.config, "config.toml");
      else addWrite(plan, location.config, patched.content, "update", "config.toml");
    } else if (!patched.preserved.length) {
      addMessage(plan, "skip", "config.toml", "managed values already missing");
    }
  } else if (Object.keys(state.config.values || {}).length) {
    addMessage(plan, "skip", "config.toml", "already missing");
  }
  state.config.values = {};

  for (const name of ["luna", "sol", "skill"]) {
    const tracked = state.files[name];
    if (!tracked) continue;
    const current = await readText(location[name]);
    if (!current.exists) {
      addMessage(plan, "skip", name, "already missing");
    } else if (hash(current.text) === tracked.hash) {
      addDelete(plan, location[name], name);
    } else {
      addMessage(plan, "preserve", name, "user-modified");
    }
    delete state.files[name];
  }

  if (state.backup) {
    const backup = await readText(location.backup);
    if (!backup.exists) addMessage(plan, "skip", "config backup", "already missing");
    else if (hash(backup.text) === state.backup.hash) addDelete(plan, location.backup, "config backup");
    else addMessage(plan, "preserve", "config backup", "user-modified");
    state.backup = null;
  }

  addDelete(plan, location.state, "state");
  for (const directory of [...state.createdDirs].sort((a, b) => b.length - a.length)) addRemoveDirectory(plan, directory);
  state.createdDirs = [];
  return plan;
}

async function snapshotPath(path) {
  const current = await readText(path);
  return current.exists ? { exists: true, text: current.text } : { exists: false };
}

async function executePlan(plan) {
  if (plan.failed) return { ok: false };
  const mutable = plan.operations.filter((operation) => operation.kind !== "rmdir");
  const snapshots = new Map();
  const applied = [];
  try {
    for (const operation of mutable) {
      if (!snapshots.has(operation.path)) snapshots.set(operation.path, await snapshotPath(operation.path));
    }
    for (const operation of plan.operations) {
      if (operation.kind === "write") await atomicWrite(operation.path, operation.content);
      else if (operation.kind === "delete") await rm(operation.path, { force: true });
      else if (operation.kind === "rmdir") {
        try { await rmdir(operation.path); } catch (error) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
        }
      }
      applied.push(operation);
    }
    return { ok: true };
  } catch (error) {
    for (const operation of [...applied].reverse()) {
      if (operation.kind === "rmdir") {
        try { await mkdir(operation.path, { recursive: true }); } catch {}
        continue;
      }
      const snapshot = snapshots.get(operation.path);
      try {
        if (snapshot?.exists) await atomicWrite(operation.path, snapshot.text);
        else await rm(operation.path, { force: true });
      } catch {}
    }
    for (const directory of [...(plan.createdDirs || [])].sort((a, b) => b.length - a.length)) {
      try { await rmdir(directory); } catch {}
    }
    return { ok: false, error };
  }
}

function formatMessage(message, dryRun) {
  const preview = dryRun && ["create", "update", "remove", "remove-if-empty"].includes(message.status)
    ? `would-${message.status}`
    : message.status;
  return `${preview}: ${message.label}${message.detail ? ` (${message.detail})` : ""}`;
}

function printPlan(plan, output, dryRun) {
  for (const message of plan.messages) output?.(formatMessage(message, dryRun));
}

function getAgentValues(content) {
  const scan = scanToml(content);
  return rootAssignments(scan);
}

function getString(assignments, key) {
  const assignment = assignments.get(key);
  return assignment?.parsedValue?.kind === "string" ? assignment.parsedValue.value : null;
}

function validateSkill(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return "invalid front matter";
  const front = match[1];
  const body = match[2];
  if (!/^name:\s*model-router\s*$/m.test(front)) return "incorrect skill name";
  if (!/^description:\s*\S.+$/m.test(front)) return "missing skill description";
  const requirements = [/Terra/i, /Luna/i, /Sol/i, /read-only/i, /simple question/i, /minimum number|fewest/i];
  if (requirements.some((pattern) => !pattern.test(body))) return "missing required routing rule";
  return null;
}

function doctorStatus(messages, status, label, detail) {
  messages.push({ status, label, detail });
  return status === "healthy";
}

async function doctor(scope) {
  const location = expectedPaths(scope);
  const messages = [];
  let healthy = true;
  let loaded;
  try { loaded = await loadState(location); }
  catch (error) {
    doctorStatus(messages, "unsafe-state", "state", error.message);
    return { healthy: false, messages };
  }
  if (!loaded.exists) {
    doctorStatus(messages, "missing", "state", "run install");
    return { healthy: false, messages };
  }
  const state = loaded.state;
  doctorStatus(messages, "healthy", "state", `schema v${state.version}`);

  const config = await readText(location.config);
  if (!config.exists) {
    healthy = doctorStatus(messages, "missing", "config.toml");
  } else {
    try {
      const scan = scanToml(config.text);
      for (const [key, expected] of Object.entries(DEFAULTS)) {
        const assignment = scan.targets.get(key);
        if (!assignment) {
          healthy = doctorStatus(messages, "missing", key) && healthy;
        } else if (assignment.parsedValue.kind !== "string") {
          healthy = doctorStatus(messages, "invalid", key, "must be a TOML string") && healthy;
        } else if (assignment.parsedValue.value !== expected) {
          const status = state.config.values[key] ? "user-modified" : "user-override";
          healthy = doctorStatus(messages, status, key, assignment.parsedValue.value ?? assignment.rawValue) && healthy;
        } else {
          doctorStatus(messages, "healthy", key, expected);
        }
      }
    } catch (error) {
      healthy = doctorStatus(messages, "invalid", "config.toml", error.message) && healthy;
    }
  }

  for (const name of ["luna", "sol"]) {
    const current = await readText(location[name]);
    if (!current.exists) {
      healthy = doctorStatus(messages, "missing", name) && healthy;
      continue;
    }
    try {
      const values = getAgentValues(current.text);
      const expected = name === "luna"
        ? { name: "luna", model: "gpt-5.6-luna", model_reasoning_effort: "high" }
        : { name: "sol", model: "gpt-5.6-sol", model_reasoning_effort: "medium", sandbox_mode: "read-only" };
      const invalid = Object.entries(expected).find(([key, value]) => getString(values, key) !== value);
      if (state.files[name] && hash(current.text) !== state.files[name].hash) {
        const detail = invalid ? `${invalid[0]} is no longer ${invalid[1]}` : "managed file hash changed";
        healthy = doctorStatus(messages, "user-modified", name, detail) && healthy;
      } else if (invalid) {
        healthy = doctorStatus(messages, "invalid", name, `${invalid[0]} must be ${invalid[1]}`) && healthy;
      } else {
        doctorStatus(messages, "healthy", name);
      }
    } catch (error) {
      healthy = doctorStatus(messages, "invalid", name, error.message) && healthy;
    }
  }

  const skill = await readText(location.skill);
  if (!skill.exists) healthy = doctorStatus(messages, "missing", "skill") && healthy;
  else {
    const invalid = validateSkill(skill.text);
    if (state.files.skill && hash(skill.text) !== state.files.skill.hash) {
      healthy = doctorStatus(messages, "user-modified", "skill", invalid || "managed file hash changed") && healthy;
    } else if (invalid) healthy = doctorStatus(messages, "invalid", "skill", invalid) && healthy;
    else doctorStatus(messages, "healthy", "skill");
  }

  if (state.backup) {
    const backup = await readText(location.backup);
    if (!backup.exists) healthy = doctorStatus(messages, "missing", "config backup") && healthy;
    else if (hash(backup.text) !== state.backup.hash) healthy = doctorStatus(messages, "user-modified", "config backup") && healthy;
    else doctorStatus(messages, "healthy", "config backup");
  }

  return { healthy, messages };
}

function usage() {
  return `codex-model-router ${VERSION}\n\nUsage:\n  codex-model-router install [--global] [--set-default] [--dry-run]\n  codex-model-router uninstall [--global] [--dry-run]\n  codex-model-router doctor [--global]\n  codex-model-router --version`;
}

function parseArgs(argv) {
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) return { version: true };
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [command, ...rawFlags] = argv;
  if (!["install", "uninstall", "doctor"].includes(command)) return { error: "unknown command" };
  const flags = { global: false, dryRun: false, setDefault: false };
  for (const flag of rawFlags) {
    if (flag === "--global") flags.global = true;
    else if (flag === "--dry-run" && command !== "doctor") flags.dryRun = true;
    else if (flag === "--set-default" && command === "install") flags.setDefault = true;
    else return { error: `unsupported option for ${command}: ${flag}` };
  }
  return { command, flags };
}

export async function run(argv, options = {}) {
  const output = options.output ?? console.log;
  const parsed = parseArgs(argv);
  if (parsed.version) { output(VERSION); return 0; }
  if (parsed.help) { output(usage()); return 0; }
  if (parsed.error) { output(`${parsed.error}\n\n${usage()}`); return 1; }
  const scope = {
    cwd: options.cwd ?? process.cwd(),
    home: options.home,
    env: options.env ?? process.env,
    global: parsed.flags.global
  };

  try {
    if (parsed.command === "doctor") {
      const result = await doctor(scope);
      for (const message of result.messages) output(formatMessage(message, false));
      return result.healthy ? 0 : 1;
    }
    const plan = parsed.command === "install"
      ? await planInstall(scope, parsed.flags)
      : await planUninstall(scope);
    printPlan(plan, output, parsed.flags.dryRun);
    if (plan.failed) return 1;
    if (parsed.flags.dryRun) return 0;
    const result = await executePlan(plan);
    if (!result.ok) {
      output(`fail: execution (${result.error?.message || "unknown error"})`);
      return 1;
    }
    return 0;
  } catch (error) {
    output(`fail: ${error.message}`);
    return 1;
  }
}
