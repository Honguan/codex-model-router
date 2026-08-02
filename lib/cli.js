import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  inspectInstallation as inspectBaseInstallation,
  reasoningWarnings,
  resolveLocations as resolveBaseLocations,
  runCli as runEnhancedCli
} from "./enhanced-cli.js";
import { AGENT_NAMES, MANAGED_FILE_NAMES } from "./manifest.js";
import { scanToml } from "./toml.js";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function nearestExistingAncestor(path) {
  let current = resolve(path);
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function canonicalPath(path) {
  const absolute = resolve(path);
  const ancestor = await nearestExistingAncestor(absolute);
  const physical = await realpath(ancestor);
  return resolve(physical, relative(ancestor, absolute));
}

async function canonicalOptions(options = {}) {
  return {
    ...options,
    cwd: await canonicalPath(options.cwd ?? process.cwd()),
    home: await canonicalPath(options.home ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd())
  };
}

async function readText(path) {
  try {
    const bytes = await readFile(path);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${path} is not valid UTF-8`);
    return { exists: true, text, bytes };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: "", bytes: null };
    throw error;
  }
}

function topLevelAssignments(content) {
  const values = new Map();
  for (const assignment of scanToml(content).assignments) {
    if (assignment.table.length !== 0 || assignment.keySegments.length !== 1) continue;
    const key = assignment.keySegments[0];
    if (values.has(key)) throw new Error(`duplicate top-level ${key}`);
    values.set(key, assignment);
  }
  return values;
}

function semanticAgent(content) {
  const assignments = topLevelAssignments(content);
  const string = (key) => {
    const assignment = assignments.get(key);
    return assignment?.parsedValue?.kind === "string" ? assignment.parsedValue.value : null;
  };
  const instructions = assignments.get("developer_instructions")?.rawValue ?? null;
  return {
    name: string("name"),
    model: string("model"),
    model_reasoning_effort: string("model_reasoning_effort"),
    sandbox_mode: string("sandbox_mode"),
    instructions_hash: instructions == null ? null : digest(instructions)
  };
}

function differingFields(left, right) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((field) => left[field] !== right[field]);
}

async function ownership(path, name, state) {
  const file = await readText(path);
  if (!file.exists) return "missing";
  const tracked = state?.files?.[name];
  const hash = digest(file.bytes);
  if (tracked?.hash === hash) return "package-managed";
  return tracked ? "user-modified" : "pre-existing";
}

async function stateAt(path) {
  const file = await readText(path);
  if (!file.exists) return null;
  try { return JSON.parse(file.text); } catch { return null; }
}

async function semanticCrossScope(options) {
  const locations = await resolveBaseLocations(options, false);
  const projectState = await stateAt(locations.project.state);
  const globalState = await stateAt(locations.global.state);
  const entries = [];

  for (const name of MANAGED_FILE_NAMES) {
    const project = await readText(locations.project[name]);
    const global = await readText(locations.global[name]);
    if (!project.exists || !global.exists) continue;
    const left = AGENT_NAMES.includes(name)
      ? semanticAgent(project.text)
      : { content_hash: digest(project.bytes) };
    const right = AGENT_NAMES.includes(name)
      ? semanticAgent(global.text)
      : { content_hash: digest(global.bytes) };
    const fields = differingFields(left, right);
    entries.push({
      name,
      status: fields.length ? "conflict" : "duplicate",
      fields,
      project_ownership: await ownership(locations.project[name], name, projectState),
      global_ownership: await ownership(locations.global[name], name, globalState)
    });
  }
  return entries;
}

function flagPresent(argv, name) {
  return argv.some((token) => token === name || token.startsWith(`${name}=`));
}

function isStatus(argv) {
  if (argv[0] === "v2") return ["status", "doctor"].includes(argv[1]);
  return ["status", "doctor"].includes(argv[0]);
}

function isOperational(argv) {
  if (argv[0] === "v2") {
    return ["enable", "disable", "status", "install", "uninstall", "doctor"].includes(argv[1]);
  }
  return ["enable", "disable", "status", "install", "uninstall", "doctor", "adopt", "repair"].includes(argv[0]);
}

function samePath(left, right) {
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function scopeAwareOptions(argv, normalized) {
  if (!flagPresent(argv, "--global")) return normalized;

  // Global commands select only the user-level installation. Give the enhanced
  // diagnostics a non-overlapping synthetic project view so a cwd that happens
  // to be the user home cannot block the explicitly selected global scope.
  return {
    ...normalized,
    cwd: join(normalized.home, ".codex-model-router-global-command")
  };
}

export { reasoningWarnings };

export async function resolveLocations(options = {}, global = false) {
  return resolveBaseLocations(await canonicalOptions(options), global);
}

export async function inspectInstallation(options = {}, global = false) {
  const normalized = await canonicalOptions(options);
  const scoped = global ? scopeAwareOptions(["status", "--global"], normalized) : normalized;
  const report = await inspectBaseInstallation(scoped, global);
  report.roots.project = normalized.cwd;
  report.cross_scope = await semanticCrossScope(scoped);
  return report;
}

export async function runCli(argv, options = {}) {
  const normalized = await canonicalOptions(options);
  const output = normalized.output ?? console.log;
  const global = flagPresent(argv, "--global");

  if (isOperational(argv) && !global && samePath(normalized.cwd, normalized.home)) {
    output("fail: project scope cannot use the user home as its project root; use --global or change to an actual project directory");
    return 1;
  }

  const scoped = scopeAwareOptions(argv, normalized);
  if (!isStatus(argv)) return runEnhancedCli(argv, scoped);

  const json = flagPresent(argv, "--json");
  const captured = [];
  const baseExit = await runEnhancedCli(argv, {
    ...scoped,
    output: json ? (line) => captured.push(String(line)) : output
  });
  const crossScope = await semanticCrossScope(scoped);
  const conflict = crossScope.some((entry) => entry.status === "conflict");

  if (json) {
    const report = JSON.parse(captured.join("\n"));
    report.roots.project = normalized.cwd;
    report.cross_scope = crossScope;
    output(JSON.stringify(report, null, 2));
  } else {
    for (const entry of crossScope) {
      output(
        `cross-scope-semantic: ${entry.name}=${entry.status}` +
        `${entry.fields.length ? ` (${entry.fields.join(", ")})` : ""}` +
        ` [project=${entry.project_ownership}, global=${entry.global_ownership}]`
      );
    }
  }
  return baseExit || conflict ? 1 : 0;
}
