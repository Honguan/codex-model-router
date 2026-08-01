import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_NAMES,
  configureAgentReasoning,
  DEFAULT_AGENT_REASONING,
  REASONING_EFFORTS,
  VERSION
} from "./manifest.js";
import {
  cleanupV2AfterUninstall,
  reportV2Doctor,
  runV2Command
} from "./experimental-v2.js";
import { run as runCore } from "./router.js";

const OPTION_TO_AGENT = Object.freeze({
  "--terra-reasoning": "terra",
  "--luna-reasoning": "luna",
  "--sol-reasoning": "sol"
});

const COMMAND_ALIASES = Object.freeze({
  enable: "install",
  disable: "uninstall",
  status: "doctor"
});

function usage() {
  return `codex-model-router ${VERSION}

Preferred npx commands:
  npx codex-model-router enable [--global] [--set-default] [--dry-run]
    [--agent-reasoning <effort>]
    [--terra-reasoning <effort>]
    [--luna-reasoning <effort>]
    [--sol-reasoning <effort>]
  npx codex-model-router disable [--global] [--dry-run]
  npx codex-model-router status [--global]
  npx codex-model-router v2 enable [--global] [--dry-run]
  npx codex-model-router v2 disable [--global] [--dry-run]
  npx codex-model-router v2 status [--global]
  npx codex-model-router --version

Compatibility aliases:
  install = enable
  uninstall = disable
  doctor = status

Reasoning efforts: ${REASONING_EFFORTS.join(", ")}
Defaults: Terra=${DEFAULT_AGENT_REASONING.terra}, Luna=${DEFAULT_AGENT_REASONING.luna}, Sol=${DEFAULT_AGENT_REASONING.sol}

V2 commands manage an experimental, undocumented Codex setting and are never enabled by a normal enable command.`;
}

function normalizeCommand(argv) {
  if (!argv.length) return argv;
  const command = COMMAND_ALIASES[argv[0]];
  return command ? [command, ...argv.slice(1)] : argv;
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
    if (command !== "install") return { error: `${option} is supported only for enable` };
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

  const physicalCodexHome = await realpath(codexHome);
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
  return { reasoning, content, packageVersion: state.packageVersion };
}

export async function runCli(argv, options = {}) {
  const output = options.output ?? console.log;
  const normalizedArgv = normalizeCommand(argv);
  if (normalizedArgv[0] === "v2") return runV2Command(normalizedArgv.slice(1), options);
  if (!normalizedArgv.length || normalizedArgv.includes("--help") || normalizedArgv.includes("-h")) {
    output(usage());
    return 0;
  }

  const parsed = parseReasoningOptions(normalizedArgv);
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

  const result = await runCore(parsed.cleaned, options);
  const command = parsed.cleaned[0];
  if (command === "doctor") {
    const v2Result = await reportV2Doctor(parsed.cleaned.slice(1), options);
    return result || v2Result;
  }
  if (command === "uninstall" && result === 0) {
    return cleanupV2AfterUninstall(parsed.cleaned.slice(1), options);
  }
  return result;
}
