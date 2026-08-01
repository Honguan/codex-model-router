import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
  codex-model-router install [--global] [--set-default] [--dry-run]
    [--agent-reasoning <effort>]
    [--terra-reasoning <effort>]
    [--luna-reasoning <effort>]
    [--sol-reasoning <effort>]
  codex-model-router uninstall [--global] [--dry-run]
  codex-model-router doctor [--global]
  codex-model-router --version

Reasoning efforts: ${REASONING_EFFORTS.join(", ")}
Defaults: Terra=${DEFAULT_AGENT_REASONING.terra}, Luna=${DEFAULT_AGENT_REASONING.luna}, Sol=${DEFAULT_AGENT_REASONING.sol}`;
}

function optionValue(argv, index, option) {
  const token = argv[index];
  if (token.startsWith(`${option}=`)) return { value: token.slice(option.length + 1), consumed: 1 };
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return { error: `missing value for ${option}` };
  return { value, consumed: 2 };
}

function parseReasoningOptions(argv) {
  const command = argv[0];
  const cleaned = command ? [command] : [];
  const overrides = {};
  let all;

  for (let index = 1; index < argv.length;) {
    const token = argv[index];
    const option = token.split("=", 1)[0];
    const agent = OPTION_TO_AGENT[option];
    if (option !== "--agent-reasoning" && !agent) {
      cleaned.push(token);
      index += 1;
      continue;
    }
    if (command !== "install") return { error: `${option} is supported only for install` };
    const parsed = optionValue(argv, index, option);
    if (parsed.error) return parsed;
    const reasoning = parsed.value.toLowerCase();
    if (!REASONING_EFFORTS.includes(reasoning)) {
      return { error: `unsupported reasoning effort: ${parsed.value}` };
    }
    if (agent) overrides[agent] = reasoning;
    else all = reasoning;
    index += parsed.consumed;
  }
  return { cleaned, overrides, all };
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
  const parse = (value) => String(value || "0").split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(version);
  const right = parse(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

async function installedReasoning(argv, options) {
  const global = argv.includes("--global");
  const home = resolve(options.home ?? homedir());
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const codexHome = global
    ? resolve(env.CODEX_HOME || join(home, ".codex"))
    : join(cwd, ".codex");
  const stateText = await readRegularText(join(codexHome, "model-router-state.json"));
  if (!stateText) return { reasoning: {}, content: {}, packageVersion: null };

  let state;
  try {
    state = JSON.parse(stateText);
  } catch {
    return { reasoning: {}, content: {}, packageVersion: null };
  }

  const reasoning = {};
  const content = {};
  for (const name of AGENT_NAMES) {
    const path = join(codexHome, "agents", `${name}.toml`);
    const tracked = state.files?.[name];
    const current = await readRegularText(path);
    if (!tracked || !current || resolve(tracked.path) !== resolve(path) || digest(current) !== tracked.hash) continue;
    const effort = activeReasoning(current);
    if (!effort) continue;
    reasoning[name] = effort;
    content[name] = current;
  }
  return { reasoning, content, packageVersion: state.packageVersion };
}

export async function runCli(argv, options = {}) {
  const output = options.output ?? console.log;
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    output(usage());
    return 0;
  }

  const parsed = parseReasoningOptions(argv);
  if (parsed.error) {
    output(`${parsed.error}\n\n${usage()}`);
    return 1;
  }

  const installed = await installedReasoning(parsed.cleaned, options);
  const selected = { ...DEFAULT_AGENT_REASONING };
  if (versionAtLeast(installed.packageVersion, "2.1.0")) Object.assign(selected, installed.reasoning);
  if (parsed.all) {
    for (const name of AGENT_NAMES) selected[name] = parsed.all;
  }
  Object.assign(selected, parsed.overrides);
  configureAgentReasoning(selected, installed.content);
  return runCore(parsed.cleaned, options);
}