import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  AGENT_NAMES,
  configureAgentReasoning,
  DEFAULT_AGENT_REASONING,
  REASONING_EFFORTS,
  VERSION
} from "./manifest.js";
import { run as runCore } from "./router.js";

const OPTION_TO_AGENT = Object.freeze({
  "--terra-reasoning": "terra",
  "--luna-reasoning": "luna",
  "--sol-reasoning": "sol"
});

function usage() {
  return `codex-model-router ${VERSION}

Usage:
  npx codex-model-router install [--global] [--set-default]
    [--agent-reasoning <effort>]
    [--terra-reasoning <effort>]
    [--luna-reasoning <effort>]
    [--sol-reasoning <effort>]
  npx codex-model-router uninstall [--global]
  npx codex-model-router --version

Reasoning efforts: ${REASONING_EFFORTS.join(", ")}
Defaults: Terra=${DEFAULT_AGENT_REASONING.terra}, Luna=${DEFAULT_AGENT_REASONING.luna}, Sol=${DEFAULT_AGENT_REASONING.sol}`;
}

function optionValue(argv, index, option) {
  const token = argv[index];
  if (token.startsWith(`${option}=`)) {
    const value = token.slice(option.length + 1);
    return value ? { value, consumed: 1 } : { error: `missing value for ${option}` };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return { error: `missing value for ${option}` };
  return { value, consumed: 2 };
}

function parseArgs(argv) {
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) return { version: true };
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return { help: true };

  const command = argv[0];
  if (!["install", "uninstall"].includes(command)) {
    return { error: `unsupported command: ${command}` };
  }

  const flags = { global: false, setDefault: false };
  const overrides = {};
  let allReasoning;

  for (let index = 1; index < argv.length;) {
    const token = argv[index];
    const option = token.split("=", 1)[0];
    const agent = OPTION_TO_AGENT[option];

    if (option === "--global" && token === "--global") {
      flags.global = true;
      index += 1;
      continue;
    }
    if (option === "--set-default" && token === "--set-default" && command === "install") {
      flags.setDefault = true;
      index += 1;
      continue;
    }
    if (option === "--agent-reasoning" || agent) {
      if (command !== "install") return { error: `${option} is supported only for install` };
      const parsed = optionValue(argv, index, option);
      if (parsed.error) return parsed;
      const reasoning = parsed.value.toLowerCase();
      if (!REASONING_EFFORTS.includes(reasoning)) {
        return { error: `unsupported reasoning effort: ${parsed.value}` };
      }
      if (agent) overrides[agent] = reasoning;
      else allReasoning = reasoning;
      index += parsed.consumed;
      continue;
    }
    return { error: `unsupported option for ${command}: ${token}` };
  }

  return { command, flags, overrides, allReasoning };
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function readRegularText(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function activeReasoning(content) {
  const match = content.match(/^\s*model_reasoning_effort\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$/m);
  return match && REASONING_EFFORTS.includes(match[1]) ? match[1] : null;
}

function versionAtLeast(version, minimum) {
  const parse = (value) => String(value || "0")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(version);
  const right = parse(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

async function installedReasoning(scope) {
  const codexHome = scope.global
    ? resolve(scope.env.CODEX_HOME || join(scope.home, ".codex"))
    : join(scope.cwd, ".codex");
  const stateText = await readRegularText(join(codexHome, "model-router-state.json"));
  if (!stateText) return { reasoning: {}, content: {}, packageVersion: null };

  let state;
  try {
    state = JSON.parse(stateText);
  } catch {
    return { reasoning: {}, content: {}, packageVersion: null };
  }

  let physicalCodexHome;
  try {
    physicalCodexHome = await realpath(codexHome);
  } catch {
    return { reasoning: {}, content: {}, packageVersion: state.packageVersion ?? null };
  }

  const reasoning = {};
  const content = {};
  for (const name of AGENT_NAMES) {
    const path = join(physicalCodexHome, "agents", `${name}.toml`);
    const tracked = state.files?.[name];
    const current = await readRegularText(path);
    if (!tracked || !current || resolve(tracked.path) !== resolve(path) || digest(current) !== tracked.hash) continue;
    const effort = activeReasoning(current);
    if (!effort) continue;
    reasoning[name] = effort;
    content[name] = current;
  }
  return { reasoning, content, packageVersion: state.packageVersion ?? null };
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

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(resolve(left)) === normalize(resolve(right));
}

async function normalizeScope(parsed, options) {
  const home = await canonicalPath(options.home ?? homedir());
  const originalCwd = await canonicalPath(options.cwd ?? process.cwd());
  const cwd = parsed.flags.global && samePath(originalCwd, home)
    ? join(home, ".codex-model-router-global-command")
    : originalCwd;
  const env = options.env ?? process.env;

  if (!parsed.flags.global && samePath(cwd, home)) {
    throw new Error("project install cannot use the user home; use --global or change to a project directory");
  }

  const projectCodex = await canonicalPath(join(cwd, ".codex"));
  const globalCodex = await canonicalPath(resolve(env.CODEX_HOME || join(home, ".codex")));
  if (samePath(projectCodex, globalCodex)) {
    throw new Error(`project and global installs resolve to the same Codex root (${projectCodex})`);
  }

  return { cwd, home, env, global: parsed.flags.global };
}

function reasoningWarnings(profile) {
  const rank = Object.freeze({ none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 });
  const warnings = [];
  if ((rank[profile.terra] ?? -1) <= rank.low) {
    warnings.push("Terra is none/low although it owns planning and verification.");
  }
  if (profile.sol === "none") {
    warnings.push("Sol is disabled although it owns failed-verification replanning.");
  }
  if ((rank[profile.luna] ?? -1) - (rank[profile.terra] ?? -1) >= 2) {
    warnings.push("Luna is materially stronger than Terra, reversing the intended plan/execute hierarchy.");
  }
  return warnings;
}

export async function runCli(argv, options = {}) {
  const output = options.output ?? console.log;
  const parsed = parseArgs(argv);

  if (parsed.version) {
    output(VERSION);
    return 0;
  }
  if (parsed.help) {
    output(usage());
    return 0;
  }
  if (parsed.error) {
    output(`${parsed.error}\n\n${usage()}`);
    return 1;
  }

  try {
    const scope = await normalizeScope(parsed, options);
    const installed = await installedReasoning(scope);
    const selected = { ...DEFAULT_AGENT_REASONING };
    if (versionAtLeast(installed.packageVersion, "2.1.0")) Object.assign(selected, installed.reasoning);
    if (parsed.allReasoning) {
      for (const name of AGENT_NAMES) selected[name] = parsed.allReasoning;
    }
    Object.assign(selected, parsed.overrides);
    configureAgentReasoning(selected, installed.content);

    const coreArgv = [parsed.command];
    if (parsed.flags.global) coreArgv.push("--global");
    if (parsed.flags.setDefault) coreArgv.push("--set-default");

    const result = await runCore(coreArgv, {
      ...options,
      cwd: scope.cwd,
      home: scope.home,
      env: scope.env,
      output
    });

    if (result === 0 && parsed.command === "install") {
      for (const warning of reasoningWarnings(selected)) output(`warning: ${warning}`);
    }
    return result;
  } catch (error) {
    output(`fail: ${error.message}`);
    return 1;
  }
}
