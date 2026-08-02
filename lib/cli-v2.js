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
  const skillsHome = global
    ? join(home, ".agents", "skills")
    : join(cwd, ".agents", "skills");
  return {
    agents: join(codexHome, "agents"),
    skills: skillsHome,
    bundledSkills: join(codexHome, "skills", ".system")
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

    const statePath = v2StatePath(argv, scopedOptions);
    const stateExisted = await exists(statePath);
    const v2Result = await runV2Command(["enable", ...flags], scopedOptions);
    if (v2Result !== 0) return v2Result;

    const stateCreated = !stateExisted && await exists(statePath);
    const baseResult = await runBaseCli(baseArgv, scopedOptions);
    if (baseResult !== 0 && stateCreated) {
      await cleanupV2AfterUninstall(flags, scopedOptions);
    }
    if (baseResult === 0) printInstallLocations(baseArgv, scopedOptions);
    return baseResult;
  }

  if (argv[0] === "install") {
    const baseResult = await runBaseCli(baseArgv, options);
    if (baseResult !== 0) return baseResult;
    printInstallLocations(baseArgv, options);
    return cleanupV2AfterUninstall(flags, options);
  }

  if (argv[0] === "uninstall") {
    let scopedOptions;
    try {
      scopedOptions = await validateScope(argv, options);
    } catch (error) {
      output(`fail: ${error.message}`);
      return 1;
    }

    const v2Result = await cleanupV2AfterUninstall(flags, scopedOptions);
    const baseResult = await runBaseCli(baseArgv, scopedOptions);
    return baseResult || v2Result;
  }

  return runBaseCli(baseArgv, options);
}
