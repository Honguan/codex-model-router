import { readFile, rm, writeFile } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}

async function write(path, content) {
  await writeFile(path, content, "utf8");
}

function replaceExact(content, search, replacement, label) {
  const count = content.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return content.replace(search, replacement);
}

const manifestPath = "lib/manifest.js";
let manifest = await read(manifestPath);
manifest = replaceExact(
  manifest,
  'const luna = `name = "luna"\ndescription = "Implements clear, bounded work from an approved plan."\nmodel = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"',
  'const luna = `name = "luna"\ndescription = "Implements clear, bounded work from an approved plan."\nmodel = "gpt-5.6-luna"\nmodel_reasoning_effort = "xhigh"',
  "Luna default reasoning"
);

const exportBlockPattern = /export const TEMPLATES = Object\.freeze\(\{[\s\S]*?\nexport const SKILL_EXPECTATIONS = Object\.freeze\(\{/;
const exportBlock = `export const REASONING_EFFORTS = Object.freeze([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);

export const DEFAULT_AGENT_REASONING = Object.freeze({
  terra: "high",
  luna: "xhigh",
  sol: "medium"
});

export const AGENT_NAMES = Object.freeze(["terra", "luna", "sol"]);

const AGENT_BASE_TEMPLATES = Object.freeze({ terra, luna, sol });

function withReasoning(content, reasoning) {
  const pattern = /^model_reasoning_effort = "[^"]+"$/m;
  if (!pattern.test(content)) throw new Error("agent template is missing model_reasoning_effort");
  return content.replace(pattern, \`model_reasoning_effort = "\${reasoning}"\`);
}

export const TEMPLATES = {
  terra: { relative: Object.freeze(["agents", "terra.toml"]), content: terra },
  luna: { relative: Object.freeze(["agents", "luna.toml"]), content: luna },
  sol: { relative: Object.freeze(["agents", "sol.toml"]), content: sol },
  skill: { relative: Object.freeze(["model-router", "SKILL.md"]), content: skill },
  planning: { relative: Object.freeze(["implementation-planning", "SKILL.md"]), content: planning }
};

export const MANAGED_FILE_NAMES = Object.freeze(["terra", "luna", "sol", "skill", "planning"]);

export const LEGACY_TEMPLATES = {
  terra: [],
  luna: [legacyLunaV12, withReasoning(luna, "max")],
  sol: [legacySolWorkspaceWrite, legacySolReadOnly],
  skill: [legacySkillWorkspaceWrite, legacySkillReadOnly],
  planning: []
};

export const AGENT_EXPECTATIONS = {
  terra: {
    name: "terra",
    model: "gpt-5.6-terra",
    model_reasoning_effort: "high",
    sandbox_mode: "read-only"
  },
  luna: {
    name: "luna",
    model: "gpt-5.6-luna",
    model_reasoning_effort: "xhigh",
    sandbox_mode: "workspace-write"
  },
  sol: {
    name: "sol",
    model: "gpt-5.6-sol",
    model_reasoning_effort: "medium",
    sandbox_mode: "read-only"
  }
};

export function configureAgentReasoning(overrides = {}, migrateFrom = {}) {
  const selected = { ...DEFAULT_AGENT_REASONING, ...overrides };
  for (const [name, reasoning] of Object.entries(selected)) {
    if (!AGENT_NAMES.includes(name)) throw new Error(\`unknown agent: \${name}\`);
    if (!REASONING_EFFORTS.includes(reasoning)) {
      throw new Error(\`unsupported reasoning effort for \${name}: \${reasoning}\`);
    }
  }

  for (const name of AGENT_NAMES) {
    const previous = migrateFrom[name];
    if (typeof previous === "string" && !LEGACY_TEMPLATES[name].includes(previous)) {
      LEGACY_TEMPLATES[name].push(previous);
    }
    TEMPLATES[name].content = withReasoning(AGENT_BASE_TEMPLATES[name], selected[name]);
    AGENT_EXPECTATIONS[name].model_reasoning_effort = selected[name];
  }
  return Object.freeze({ ...selected });
}

configureAgentReasoning();

export const SKILL_EXPECTATIONS = Object.freeze({`;
if (!exportBlockPattern.test(manifest)) throw new Error("manifest export block not found");
manifest = manifest.replace(exportBlockPattern, exportBlock);
await write(manifestPath, manifest);

await write("lib/agent-reasoning-cli.js", String.raw`import { createHash } from "node:crypto";
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
`);

await write("bin/codex-model-router.js", String.raw`#!/usr/bin/env node
import { runCli } from "../lib/agent-reasoning-cli.js";

process.exitCode = await runCli(process.argv.slice(2), { output: console.log });
`);

await write("test/agent-reasoning.test.js", String.raw`import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/agent-reasoning-cli.js";

const quiet = () => {};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-reasoning-"));
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

async function agentReasoning(project, name) {
  const content = await readFile(join(project, ".codex", "agents", `${name}.toml`), "utf8");
  const match = content.match(/^model_reasoning_effort = "([^"]+)"$/m);
  assert.ok(match, `${name} reasoning assignment is missing`);
  return match[1];
}

test("Luna defaults to xhigh reasoning", async () => {
  const dir = await fixture();
  try {
    assert.equal(await runCli(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "high");
    assert.equal(await agentReasoning(dir.project, "luna"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "sol"), "medium");
    assert.equal(await runCli(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("install accepts all-agent and per-agent reasoning overrides", async () => {
  const dir = await fixture();
  try {
    assert.equal(await runCli([
      "install",
      "--agent-reasoning", "low",
      "--luna-reasoning=xhigh",
      "--sol-reasoning", "max"
    ], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "low");
    assert.equal(await agentReasoning(dir.project, "luna"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "sol"), "max");
    assert.equal(await runCli(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("targeted reinstall preserves unspecified managed reasoning", async () => {
  const dir = await fixture();
  try {
    assert.equal(await runCli([
      "install",
      "--terra-reasoning", "xhigh",
      "--luna-reasoning", "low",
      "--sol-reasoning", "max"
    ], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await runCli([
      "install",
      "--luna-reasoning", "high"
    ], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await agentReasoning(dir.project, "terra"), "xhigh");
    assert.equal(await agentReasoning(dir.project, "luna"), "high");
    assert.equal(await agentReasoning(dir.project, "sol"), "max");
    assert.equal(await runCli(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

test("invalid reasoning is rejected before writes", async () => {
  const dir = await fixture();
  try {
    const lines = [];
    assert.equal(await runCli([
      "install",
      "--luna-reasoning", "ultra"
    ], { cwd: dir.project, home: dir.home, output: (line) => lines.push(String(line)) }), 1);
    assert.equal(await exists(join(dir.project, ".codex")), false);
    assert.ok(lines.some((line) => line.includes("unsupported reasoning effort")));
  } finally { await dir.cleanup(); }
});
`);

let packageJson = await read("package.json");
packageJson = replaceExact(packageJson, '"version": "2.0.0"', '"version": "2.1.0"', "package version");
packageJson = replaceExact(
  packageJson,
  'node --check bin/codex-model-router.js && node --check lib/manifest.js',
  'node --check bin/codex-model-router.js && node --check lib/agent-reasoning-cli.js && node --check lib/manifest.js',
  "syntax check list"
);
await write("package.json", packageJson);

let changelog = await read("CHANGELOG.md");
changelog = replaceExact(
  changelog,
  "# Changelog\n\n",
  "# Changelog\n\n## 2.1.0 - 2026-08-01\n\n- Change Luna's default reasoning effort from max to xhigh.\n- Add install-time reasoning controls for all managed agents or individual Terra, Luna, and Sol agents.\n- Preserve package-managed custom reasoning values across later installs while retaining user-modified file protection.\n- Validate supported GPT-5.6 reasoning efforts before any filesystem writes.\n\n",
  "changelog heading"
);
await write("CHANGELOG.md", changelog);

let readme = await read("README.md");
readme = readme.replaceAll("Luna/max", "Luna/xhigh");
readme = replaceExact(
  readme,
  "Running a later plain `install` returns package-managed default settings to free mode. User-modified model settings are preserved.\n\n## Install",
  `Running a later plain \`install\` returns package-managed default settings to free mode. User-modified model settings are preserved.\n\n## Agent reasoning\n\nThe managed agent defaults are Terra/high, Luna/xhigh, and Sol/medium. Override all agents or individual agents during installation:\n\n\`\`\`sh\ncodex-model-router install --agent-reasoning high\ncodex-model-router install --terra-reasoning xhigh --luna-reasoning low --sol-reasoning max\n\`\`\`\n\nSupported values are \`none\`, \`low\`, \`medium\`, \`high\`, \`xhigh\`, and \`max\`. Per-agent options override \`--agent-reasoning\`. Later installs preserve unchanged package-managed reasoning choices; manually edited agent files remain protected.\n\n## Install`,
  "README reasoning section"
);
readme = replaceExact(
  readme,
  "codex-model-router install [--global] [--set-default] [--dry-run]",
  "codex-model-router install [--global] [--set-default] [--dry-run]\n  [--agent-reasoning <effort>]\n  [--terra-reasoning <effort>] [--luna-reasoning <effort>] [--sol-reasoning <effort>]",
  "README command usage"
);
readme = readme.replaceAll("v2.0.0.tar.gz", "v2.1.0.tar.gz");
await write("README.md", readme);

let smoke = await read("scripts/package-smoke.js");
smoke = replaceExact(smoke, '/model_reasoning_effort = "max"/', '/model_reasoning_effort = "xhigh"/', "package smoke Luna reasoning");
await write("scripts/package-smoke.js", smoke);

let routerTest = await read("test/router.test.js");
routerTest = replaceExact(routerTest, '/model_reasoning_effort = "max"/', '/model_reasoning_effort = "xhigh"/', "router test Luna reasoning");
await write("test/router.test.js", routerTest);

await rm("scripts/apply-agent-reasoning-change.mjs", { force: true });
await rm(".github/workflows/apply-agent-reasoning-change.yml", { force: true });
