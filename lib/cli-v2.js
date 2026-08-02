import { access, lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { runCli as runBaseCli } from "./cli.js";
import { cleanupV2AfterUninstall, runV2Command } from "./experimental-v2.js";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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
  return resolve(await realpath(ancestor), relative(ancestor, absolute));
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(resolve(left)) === normalize(resolve(right));
}

async function validateScope(argv, options) {
  const global = argv.includes("--global");
  const home = await canonicalPath(options.home ?? homedir());
  const originalCwd = await canonicalPath(options.cwd ?? process.cwd());
  const cwd = global && samePath(originalCwd, home)
    ? join(home, ".codex-model-router-global-command")
    : originalCwd;
  const env = options.env ?? process.env;

  if (!global && samePath(cwd, home)) {
    throw new Error("project install cannot use the user home; use --global or change to a project directory");
  }

  const projectCodex = await canonicalPath(join(cwd, ".codex"));
  const globalCodex = await canonicalPath(resolve(env.CODEX_HOME || join(home, ".codex")));
  if (samePath(projectCodex, globalCodex)) {
    throw new Error(`project and global installs resolve to the same Codex root (${projectCodex})`);
  }

  return { ...options, cwd, home, env };
}

function scopeArgs(argv) {
  return argv.includes("--global") ? ["--global"] : [];
}

function v2StatePath(argv, options) {
  const home = resolve(options.home ?? homedir());
  const env = options.env ?? process.env;
  const codexHome = argv.includes("--global")
    ? resolve(env.CODEX_HOME || join(home, ".codex"))
    : join(resolve(options.cwd ?? process.cwd()), ".codex");
  return join(codexHome, "model-router-v2-state.json");
}

function installLocations(argv, options) {
  const global = argv.includes("--global");
  const home = resolve(options.home ?? homedir());
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const codexHome = global
    ? resolve(env.CODEX_HOME || join(home, ".codex"))
    : join(cwd, ".codex");
  const skillsHome = join(codexHome, "skills");
  const agents = join(codexHome, "agents");
  return {
    codexHome,
    agents,
    skills: skillsHome,
    bundledSkills: join(skillsHome, ".system"),
    config: join(codexHome, "config.toml"),
    backup: join(codexHome, "config.toml.codex-model-router.bak"),
    state: join(codexHome, "model-router-state.json"),
    v2State: join(codexHome, "model-router-v2-state.json"),
    terra: join(agents, "terra.toml"),
    luna: join(agents, "luna.toml"),
    sol: join(agents, "sol.toml"),
    skill: join(skillsHome, "model-router", "SKILL.md"),
    planning: join(skillsHome, "implementation-planning", "SKILL.md")
  };
}

function parseKnownPayload(payload, label) {
  if (payload === label) return { matched: true, detail: "" };
  const prefix = `${label} (`;
  if (payload.startsWith(prefix) && payload.endsWith(")")) {
    return { matched: true, detail: payload.slice(prefix.length, -1) };
  }
  return { matched: false, detail: "" };
}

function formatPathStatus(status, path, detail) {
  return `${status}: ${path}${detail ? ` (${detail})` : ""}`;
}

function rewriteManagedOutputLine(line, argv, options) {
  const separator = line.indexOf(": ");
  if (separator < 0) return line;
  const status = line.slice(0, separator);
  const payload = line.slice(separator + 2);
  const location = installLocations(argv, options);
  const aliases = [
    ["terra migration", location.terra, "migration"],
    ["luna migration", location.luna, "migration"],
    ["sol migration", location.sol, "migration"],
    ["skill migration", location.skill, "migration"],
    ["planning migration", location.planning, "migration"],
    ["config backup", location.backup, ""],
    ["config.toml", location.config, ""],
    ["terra", location.terra, ""],
    ["luna", location.luna, ""],
    ["sol", location.sol, ""],
    ["skill", location.skill, ""],
    ["planning", location.planning, ""],
    ["state", location.state, ""]
  ];

  for (const [label, path, fixedDetail] of aliases) {
    const parsed = parseKnownPayload(payload, label);
    if (!parsed.matched) continue;
    return formatPathStatus(status, path, parsed.detail || fixedDetail);
  }

  const experimental = parseKnownPayload(payload, "experimental-v2");
  if (experimental.matched) {
    const detail = experimental.detail;
    if (detail === "experimental V2 state" || detail.includes("experimental V2 state")) {
      return formatPathStatus(status, location.v2State, detail === "experimental V2 state" ? "" : detail);
    }
    if (detail === "config.toml") {
      return formatPathStatus(status, location.config, "experimental V2 configuration");
    }
    return formatPathStatus(status, location.config, detail || "experimental V2 configuration");
  }

  return line;
}

function withPathAwareOutput(argv, options) {
  const output = options.output ?? console.log;
  return {
    ...options,
    output: (line) => output(String(line)
      .split("\n")
      .map((part) => rewriteManagedOutputLine(part, argv, options))
      .join("\n"))
  };
}

function printInstallLocations(argv, options) {
  const output = options.output ?? console.log;
  const location = installLocations(argv, options);
  output(`location: Codex agents (${location.agents})`);
  output(`location: Codex user skills (${location.skills})`);
  output(`note: ${location.bundledSkills} is reserved for bundled Codex skills.`);
}

async function printHelp(options) {
  const output = options.output ?? console.log;
  const lines = [];
  await runBaseCli(["--help"], { ...options, output: (line) => lines.push(String(line)) });
  const help = lines.join("\n").replace(
    "install [--global] [--set-default]",
    "install [--global] [--set-default] [--v2]"
  );
  output(`${help}\n\nV2 is disabled by default. Add --v2 to install the package-managed multi-agent V2 configuration.`);
  return 0;
}

export async function runCli(argv, options = {}) {
  const output = options.output ?? console.log;
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return printHelp(options);

  const v2Requested = argv.includes("--v2");
  if (v2Requested && argv[0] !== "install") {
    output("--v2 is supported only for install");
    return 1;
  }

  const baseArgv = argv.filter((value) => value !== "--v2");
  const flags = scopeArgs(argv);

  if (argv[0] === "install" && v2Requested) {
    let scopedOptions;
    try {
      scopedOptions = await validateScope(argv, options);
    } catch (error) {
      output(`fail: ${error.message}`);
      return 1;
    }

    const pathOptions = withPathAwareOutput(baseArgv, scopedOptions);
    const statePath = v2StatePath(argv, scopedOptions);
    const stateExisted = await exists(statePath);
    const v2Result = await runV2Command(["enable", ...flags], pathOptions);
    if (v2Result !== 0) return v2Result;

    const stateCreated = !stateExisted && await exists(statePath);
    const baseResult = await runBaseCli(baseArgv, pathOptions);
    if (baseResult !== 0 && stateCreated) {
      await cleanupV2AfterUninstall(flags, pathOptions);
    }
    if (baseResult === 0) printInstallLocations(baseArgv, pathOptions);
    return baseResult;
  }

  if (argv[0] === "install") {
    const pathOptions = withPathAwareOutput(baseArgv, options);
    const baseResult = await runBaseCli(baseArgv, pathOptions);
    if (baseResult !== 0) return baseResult;
    printInstallLocations(baseArgv, pathOptions);
    return cleanupV2AfterUninstall(flags, pathOptions);
  }

  if (argv[0] === "uninstall") {
    let scopedOptions;
    try {
      scopedOptions = await validateScope(argv, options);
    } catch (error) {
      output(`fail: ${error.message}`);
      return 1;
    }

    const pathOptions = withPathAwareOutput(baseArgv, scopedOptions);
    const v2Result = await cleanupV2AfterUninstall(flags, pathOptions);
    const baseResult = await runBaseCli(baseArgv, pathOptions);
    return baseResult || v2Result;
  }

  return runBaseCli(baseArgv, withPathAwareOutput(baseArgv, options));
}
