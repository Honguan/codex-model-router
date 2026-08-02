import { createHash } from "node:crypto";
import { spawnSync as systemSpawnSync } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runCli as runBaseCli } from "./agent-reasoning-cli.js";
import {
  AGENT_NAMES,
  DEFAULT_AGENT_REASONING,
  LEGACY_TEMPLATES,
  MANAGED_FILE_NAMES,
  TEMPLATES,
  VERSION
} from "./manifest.js";
import { scanToml } from "./toml.js";

const STATE_VERSION = 4;
const V2_STATE_FILE = "model-router-v2-state.json";
const V2_START_MARKER = "# >>> codex-model-router experimental multi-agent-v2 >>>";
const V2_END_MARKER = "# <<< codex-model-router experimental multi-agent-v2 <<<";
const REASONING_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 });
const COMMAND_ALIASES = Object.freeze({ enable: "install", disable: "uninstall", status: "doctor" });

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(path) {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
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
  let physical = ancestor;
  try { physical = await realpath(ancestor); } catch {}
  return resolve(physical, absolute.slice(ancestor.length).replace(/^[/\\]+/, ""));
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

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
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

function pathSet(codexHome, skillsHome) {
  return {
    codexHome,
    skillsHome,
    config: join(codexHome, "config.toml"),
    state: join(codexHome, "model-router-state.json"),
    backup: join(codexHome, "config.toml.codex-model-router.bak"),
    lock: join(codexHome, "model-router.lock"),
    journal: join(codexHome, "model-router-transaction.json"),
    transactionData: join(codexHome, "model-router-transaction-data"),
    v2State: join(codexHome, V2_STATE_FILE),
    terra: join(codexHome, ...TEMPLATES.terra.relative),
    luna: join(codexHome, ...TEMPLATES.luna.relative),
    sol: join(codexHome, ...TEMPLATES.sol.relative),
    skill: join(skillsHome, ...TEMPLATES.skill.relative),
    planning: join(skillsHome, ...TEMPLATES.planning.relative)
  };
}

export async function resolveLocations(options = {}, global = false) {
  const projectRoot = resolve(options.cwd ?? process.cwd());
  const userHome = resolve(options.home ?? homedir());
  const env = options.env ?? process.env;
  const project = pathSet(join(projectRoot, ".codex"), join(projectRoot, ".agents", "skills"));
  const globalScope = pathSet(
    resolve(env.CODEX_HOME || join(userHome, ".codex")),
    join(userHome, ".agents", "skills")
  );
  return {
    scope: global ? "global" : "project",
    projectRoot,
    userHome,
    selected: global ? globalScope : project,
    other: global ? project : globalScope,
    project,
    global: globalScope
  };
}

export async function detectScopeOverlap(options = {}) {
  const locations = await resolveLocations(options, false);
  const projectPhysical = await canonicalPath(locations.project.codexHome);
  const globalPhysical = await canonicalPath(locations.global.codexHome);
  return {
    overlaps: normalizePath(projectPhysical) === normalizePath(globalPhysical),
    project: projectPhysical,
    global: globalPhysical
  };
}

function normalizedCommand(argv) {
  if (argv[0] === "v2") {
    const command = COMMAND_ALIASES[argv[1]] || argv[1];
    return { family: "v2", command };
  }
  return { family: "routing", command: COMMAND_ALIASES[argv[0]] || argv[0] };
}

function isOperationalCommand(argv) {
  const { family, command } = normalizedCommand(argv);
  if (family === "v2") return ["enable", "disable", "status", "install", "uninstall", "doctor"].includes(command);
  return ["install", "uninstall", "doctor", "adopt", "repair"].includes(command);
}

function flagPresent(argv, name) {
  return argv.some((token) => token === name || token.startsWith(`${name}=`));
}

function stripFlags(argv, names) {
  return argv.filter((token) => !names.some((name) => token === name || token.startsWith(`${name}=`)));
}

function rootString(content, key) {
  const scan = scanToml(content);
  const assignment = scan.targets.get(key);
  return assignment?.parsedValue?.kind === "string" ? assignment.parsedValue.value : null;
}

function agentSnapshot(content) {
  const values = {};
  for (const key of ["name", "model", "model_reasoning_effort", "sandbox_mode", "developer_instructions"]) {
    values[key] = rootString(content, key);
  }
  values.instructions_hash = values.developer_instructions == null ? null : digest(values.developer_instructions);
  delete values.developer_instructions;
  return values;
}

function recognizedTemplate(name, content) {
  return content === TEMPLATES[name].content || (LEGACY_TEMPLATES[name] || []).includes(content);
}

async function readState(path) {
  const file = await readText(path);
  if (!file.exists) return { status: "missing", state: null };
  try {
    const state = JSON.parse(file.text);
    return { status: "present", state };
  } catch {
    return { status: "invalid", state: null };
  }
}

async function fileOwnership(path, name, state) {
  const file = await readText(path);
  if (!file.exists) return { status: "missing", hash: null };
  const hash = digest(file.bytes);
  const tracked = state?.files?.[name];
  if (tracked && tracked.hash === hash) return { status: "package-managed", hash };
  if (tracked) return { status: "user-modified", hash };
  if (recognizedTemplate(name, file.text)) return { status: "recognizable-orphan", hash };
  return { status: "pre-existing", hash };
}

async function v2Status(paths) {
  const state = await readText(paths.v2State);
  const config = await readText(paths.config);
  const marked = config.text.includes(V2_START_MARKER) && config.text.includes(V2_END_MARKER);
  const mentioned = /\bmulti_agent_v2\b/.test(config.text);
  if (state.exists && marked) return "managed";
  if (state.exists && !marked) return "missing-block";
  if (!state.exists && marked) return "untracked-block";
  if (mentioned) return "unmanaged";
  return "disabled";
}

function compareSnapshots(left, right) {
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  return fields.filter((field) => left[field] !== right[field]);
}

async function crossScopeEntries(locations) {
  const entries = [];
  const projectState = (await readState(locations.project.state)).state;
  const globalState = (await readState(locations.global.state)).state;
  for (const name of MANAGED_FILE_NAMES) {
    const left = await readText(locations.project[name]);
    const right = await readText(locations.global[name]);
    if (!left.exists || !right.exists) continue;
    const leftSnapshot = AGENT_NAMES.includes(name) ? agentSnapshot(left.text) : { hash: digest(left.bytes) };
    const rightSnapshot = AGENT_NAMES.includes(name) ? agentSnapshot(right.text) : { hash: digest(right.bytes) };
    const fields = compareSnapshots(leftSnapshot, rightSnapshot);
    const projectOwnership = await fileOwnership(locations.project[name], name, projectState);
    const globalOwnership = await fileOwnership(locations.global[name], name, globalState);
    entries.push({
      name,
      status: fields.length ? "conflict" : "duplicate",
      fields,
      project_ownership: projectOwnership.status,
      global_ownership: globalOwnership.status
    });
  }
  return entries;
}

function configuredPrimary(configText, state) {
  if (!configText) {
    return {
      model: null,
      reasoning: null,
      ownership: "absent",
      runtime: "unknown-not-exposed-by-codex"
    };
  }
  try {
    const model = rootString(configText, "model");
    const reasoning = rootString(configText, "model_reasoning_effort");
    const managed = state?.config?.values || {};
    const ownedModel = managed.model?.installed === model;
    const ownedReasoning = managed.model_reasoning_effort?.installed === reasoning;
    return {
      model,
      reasoning,
      ownership: ownedModel || ownedReasoning ? "package-managed" : (model || reasoning ? "user-selected" : "absent"),
      runtime: "unknown-not-exposed-by-codex"
    };
  } catch (error) {
    return { model: null, reasoning: null, ownership: "invalid", runtime: "unknown", error: error.message };
  }
}

async function effectiveReasoning(paths) {
  const result = { ...DEFAULT_AGENT_REASONING };
  for (const name of AGENT_NAMES) {
    const file = await readText(paths[name]);
    if (!file.exists) continue;
    try {
      const value = rootString(file.text, "model_reasoning_effort");
      if (Object.hasOwn(REASONING_RANK, value)) result[name] = value;
    } catch {}
  }
  return result;
}

export function reasoningWarnings(profile, options = {}) {
  const warnings = [];
  const terra = REASONING_RANK[profile.terra] ?? -1;
  const luna = REASONING_RANK[profile.luna] ?? -1;
  const sol = REASONING_RANK[profile.sol] ?? -1;
  if (terra <= REASONING_RANK.low) {
    warnings.push({ code: "CMR001", message: "Terra is none/low although it owns planning, debugging, and verification." });
  }
  if (profile.sol === "none") {
    warnings.push({ code: "CMR002", message: "Sol is disabled although it is the unresolved-core-logic advisor." });
  }
  if ([terra, luna, sol].every((rank) => rank <= REASONING_RANK.low)) {
    warnings.push({ code: "CMR003", message: "All managed agents use a weak reasoning profile." });
  }
  if (luna - terra >= 2) {
    warnings.push({ code: "CMR004", message: "Luna is materially stronger than Terra, reversing the intended plan/execute hierarchy." });
  }
  if (options.commonOverrideReplacedCustom) {
    warnings.push({ code: "CMR005", message: "The all-agent override replaced a previously customized per-agent profile." });
  }
  return warnings;
}

function codexPreflight(options = {}) {
  const spawnSync = options.spawnSync ?? systemSpawnSync;
  let result;
  try {
    result = spawnSync(options.codexCommand ?? "codex", ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      env: options.env ?? process.env
    });
  } catch (error) {
    result = { error };
  }
  const output = `${result?.stdout || ""}${result?.stderr || ""}`.trim();
  const available = !result?.error && result?.status === 0;
  return {
    node: { status: "available", version: process.versions.node },
    codex: available
      ? { status: "available", version: output || "unknown" }
      : { status: "unavailable", detail: result?.error?.message || output || "codex --version failed" },
    custom_agents: { status: "unknown", detail: "no non-destructive runtime capability probe is exposed" },
    local_skills: { status: "unknown", detail: "no non-destructive runtime capability probe is exposed" },
    model_access: { status: "unknown", detail: "not tested to avoid paid inference" },
    sandbox_modes: { status: "unknown", detail: "configured values are validated; runtime support is not probed" },
    multi_agent_v2: { status: "unknown", detail: "experimental and undocumented" }
  };
}

export async function inspectInstallation(options = {}, global = false) {
  const locations = await resolveLocations(options, global);
  const selectedState = await readState(locations.selected.state);
  const config = await readText(locations.selected.config);
  const ownership = {};
  for (const name of MANAGED_FILE_NAMES) {
    ownership[name] = await fileOwnership(locations.selected[name], name, selectedState.state);
  }
  const reasoning = await effectiveReasoning(locations.selected);
  const crossScope = await crossScopeEntries(locations);
  return {
    package_version: VERSION,
    scope: locations.scope,
    routing_mode: "auto-primary-aware",
    roots: {
      project: locations.projectRoot,
      user_home: locations.userHome,
      selected_codex: locations.selected.codexHome,
      selected_codex_physical: await canonicalPath(locations.selected.codexHome),
      selected_skills: locations.selected.skillsHome,
      selected_skills_physical: await canonicalPath(locations.selected.skillsHome),
      other_codex: locations.other.codexHome,
      other_codex_physical: await canonicalPath(locations.other.codexHome),
      other_skills: locations.other.skillsHome,
      other_skills_physical: await canonicalPath(locations.other.skillsHome)
    },
    paths: {
      config: locations.selected.config,
      state: locations.selected.state,
      backup: locations.selected.backup,
      lock: locations.selected.lock,
      journal: locations.selected.journal,
      transaction_data: locations.selected.transactionData,
      v2_state: locations.selected.v2State,
      terra: locations.selected.terra,
      luna: locations.selected.luna,
      sol: locations.selected.sol,
      model_router_skill: locations.selected.skill,
      implementation_planning_skill: locations.selected.planning
    },
    state: selectedState.status,
    ownership,
    primary: configuredPrimary(config.text, selectedState.state),
    reasoning,
    reasoning_warnings: reasoningWarnings(reasoning),
    cross_scope: crossScope,
    v2: {
      selected: await v2Status(locations.selected),
      other: await v2Status(locations.other)
    },
    preflight: codexPreflight(options)
  };
}

function reportLines(report) {
  const lines = [
    `scope: ${report.scope}`,
    `routing: ${report.routing_mode}`,
    `primary: ${report.primary.model || "unset"}/${report.primary.reasoning || "unset"} (${report.primary.ownership}; runtime ${report.primary.runtime})`,
    `v2: selected=${report.v2.selected}, other=${report.v2.other}`,
    `path: project=${report.roots.project}`,
    `path: user-home=${report.roots.user_home}`,
    `path: codex=${report.roots.selected_codex}`,
    `path: codex-physical=${report.roots.selected_codex_physical}`,
    `path: skills=${report.roots.selected_skills}`,
    `path: skills-physical=${report.roots.selected_skills_physical}`,
    `path: config=${report.paths.config}`,
    `path: state=${report.paths.state}`,
    `path: backup=${report.paths.backup}`,
    `path: lock=${report.paths.lock}`,
    `path: journal=${report.paths.journal}`,
    `path: transaction-data=${report.paths.transaction_data}`,
    `path: v2-state=${report.paths.v2_state}`,
    `path: terra=${report.paths.terra}`,
    `path: luna=${report.paths.luna}`,
    `path: sol=${report.paths.sol}`,
    `path: model-router-skill=${report.paths.model_router_skill}`,
    `path: implementation-planning-skill=${report.paths.implementation_planning_skill}`
  ];
  for (const name of MANAGED_FILE_NAMES) lines.push(`ownership: ${name}=${report.ownership[name].status}`);
  for (const entry of report.cross_scope) {
    lines.push(
      `cross-scope: ${entry.name}=${entry.status}` +
      `${entry.fields.length ? ` (${entry.fields.join(", ")})` : ""}` +
      ` [project=${entry.project_ownership}, global=${entry.global_ownership}]`
    );
  }
  lines.push(
    `preflight: codex=${report.preflight.codex.status}` +
    `${report.preflight.codex.version ? ` (${report.preflight.codex.version})` : ""}` +
    `${report.preflight.codex.detail ? ` (${report.preflight.codex.detail})` : ""}`
  );
  lines.push("preflight: model-access=unknown (no paid inference performed)");
  for (const warning of report.reasoning_warnings) lines.push(`warning[${warning.code}]: ${warning.message}`);
  return lines;
}

function freshAdoptState(locations, files) {
  return {
    version: STATE_VERSION,
    packageVersion: VERSION,
    scope: locations.scope,
    roots: {
      codex: locations.selected.codexHome,
      skills: locations.selected.skillsHome,
      skillsRoot: dirname(locations.selected.skillsHome)
    },
    config: {
      path: locations.selected.config,
      createdFile: false,
      values: {}
    },
    files,
    backup: null,
    createdDirs: []
  };
}

async function adopt(argv, options) {
  const output = options.output ?? console.log;
  const global = flagPresent(argv, "--global");
  const dryRun = flagPresent(argv, "--dry-run");
  const locations = await resolveLocations(options, global);
  const existingState = await readText(locations.selected.state);
  if (existingState.exists) {
    output("fail: adopt (state already exists; use repair)");
    return 1;
  }

  const files = {};
  const missing = [];
  const unrecognized = [];
  for (const name of MANAGED_FILE_NAMES) {
    const current = await readText(locations.selected[name]);
    if (!current.exists) {
      missing.push(name);
      continue;
    }
    if (!recognizedTemplate(name, current.text)) {
      unrecognized.push(name);
      continue;
    }
    files[name] = { path: locations.selected[name], hash: digest(current.bytes) };
  }
  if (unrecognized.length) {
    output(`fail: adopt (unrecognized or user-modified files: ${unrecognized.join(", ")})`);
    return 1;
  }
  if (!Object.keys(files).length) {
    output("fail: adopt (no recognizable package files were found)");
    return 1;
  }

  const safetyLines = [];
  const safetyArgs = [
    "install",
    "--dry-run",
    ...argv.slice(1).filter((token) => token !== "--dry-run")
  ];
  const safety = await runBaseCli(safetyArgs, {
    ...options,
    output: (line) => safetyLines.push(String(line))
  });
  if (safety !== 0) {
    output("fail: adopt safety preflight");
    for (const line of safetyLines) output(line);
    return 1;
  }

  for (const name of Object.keys(files)) output(`${dryRun ? "would-adopt" : "adopt"}: ${name}`);
  for (const name of missing) output(`${dryRun ? "would-create" : "create-after-adopt"}: ${name}`);
  output(`${dryRun ? "would-create" : "create"}: state`);
  if (dryRun) return 0;

  const state = freshAdoptState(locations, files);
  await atomicWrite(locations.selected.state, `${JSON.stringify(state, null, 2)}\n`);
  const forward = ["install", ...argv.slice(1).filter((token) => token !== "--dry-run")];
  const result = await runBaseCli(forward, options);
  if (result !== 0) await rm(locations.selected.state, { force: true });
  return result;
}

async function repair(argv, options) {
  const output = options.output ?? console.log;
  const global = flagPresent(argv, "--global");
  const locations = await resolveLocations(options, global);
  const state = await readState(locations.selected.state);
  if (state.status === "missing") return adopt(["adopt", ...argv.slice(1)], options);
  if (state.status === "invalid") {
    output("fail: repair (state file is not valid JSON)");
    return 1;
  }
  const forward = ["install", ...argv.slice(1)];
  const result = await runBaseCli(forward, options);
  if (result !== 0 || flagPresent(argv, "--dry-run")) return result;
  const lines = [];
  const health = await runBaseCli(["doctor", ...(global ? ["--global"] : [])], {
    ...options,
    output: (line) => lines.push(String(line))
  });
  if (health !== 0) {
    output("repair-incomplete: status still requires attention");
    for (const line of lines) output(line);
  }
  return health;
}

function enhancedUsage() {
  return `codex-model-router ${VERSION}\n\nPreferred npx commands:\n  npx codex-model-router enable [--global] [--set-default] [--dry-run] [reasoning options]\n  npx codex-model-router disable [--global] [--dry-run]\n  npx codex-model-router status [--global] [--json] [--strict-preflight]\n  npx codex-model-router adopt [--global] [--dry-run] [reasoning options]\n  npx codex-model-router repair [--global] [--dry-run] [reasoning options]\n  npx codex-model-router v2 enable|disable|status [--global] [--dry-run]\n\nCompatibility aliases: install=enable, uninstall=disable, doctor=status`;
}

export async function runCli(argv, options = {}) {
  const output = options.output ?? console.log;
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    output(enhancedUsage());
    return 0;
  }

  if (isOperationalCommand(argv)) {
    try {
      const overlap = await detectScopeOverlap(options);
      if (overlap.overlaps) {
        output(`fail: project and global scopes resolve to the same Codex root (${overlap.project})`);
        return 1;
      }
    } catch (error) {
      output(`fail: scope preflight (${error.message})`);
      return 1;
    }
  }

  const { family, command } = normalizedCommand(argv);
  if (family === "routing" && command === "adopt") return adopt(argv, options);
  if (family === "routing" && command === "repair") return repair(argv, options);

  const statusCommand = (family === "routing" && command === "doctor") || (family === "v2" && ["status", "doctor"].includes(command));
  if (statusCommand) {
    const global = flagPresent(argv, "--global");
    const json = flagPresent(argv, "--json");
    const strictPreflight = flagPresent(argv, "--strict-preflight");
    const baseArgv = stripFlags(argv, ["--json", "--strict-preflight"]);
    const baseLines = [];
    const baseExit = await runBaseCli(baseArgv, {
      ...options,
      output: json ? (line) => baseLines.push(String(line)) : output
    });
    const report = await inspectInstallation(options, global);
    const conflict = report.cross_scope.some((entry) => entry.status === "conflict");
    const strictFailure = strictPreflight && report.preflight.codex.status !== "available";
    if (json) {
      output(JSON.stringify({ base_exit: baseExit, base_messages: baseLines, ...report }, null, 2));
    } else {
      for (const line of reportLines(report)) output(line);
    }
    return baseExit || conflict || strictFailure ? 1 : 0;
  }

  const commonOverride = flagPresent(argv, "--agent-reasoning");
  let priorCustomized = false;
  if (commonOverride) {
    try {
      const locations = await resolveLocations(options, flagPresent(argv, "--global"));
      const before = await effectiveReasoning(locations.selected);
      priorCustomized = new Set(Object.values(before)).size > 1;
    } catch {}
  }

  const result = await runBaseCli(argv, options);
  if (result === 0 && family === "routing" && command === "install") {
    try {
      const locations = await resolveLocations(options, flagPresent(argv, "--global"));
      const profile = await effectiveReasoning(locations.selected);
      for (const warning of reasoningWarnings(profile, { commonOverrideReplacedCustom: commonOverride && priorCustomized })) {
        output(`warning[${warning.code}]: ${warning.message}`);
      }
    } catch (error) {
      output(`warning: reasoning diagnostics unavailable (${error.message})`);
    }
  }
  return result;
}
