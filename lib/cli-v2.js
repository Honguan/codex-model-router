import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
    const statePath = v2StatePath(argv, options);
    const stateExisted = await exists(statePath);
    const v2Result = await runV2Command(["enable", ...flags], options);
    if (v2Result !== 0) return v2Result;

    const stateCreated = !stateExisted && await exists(statePath);
    const baseResult = await runBaseCli(baseArgv, options);
    if (baseResult !== 0 && stateCreated) {
      await cleanupV2AfterUninstall(flags, options);
    }
    return baseResult;
  }

  if (argv[0] === "install") {
    const baseResult = await runBaseCli(baseArgv, options);
    if (baseResult !== 0) return baseResult;
    return cleanupV2AfterUninstall(flags, options);
  }

  if (argv[0] === "uninstall") {
    const v2Result = await cleanupV2AfterUninstall(flags, options);
    const baseResult = await runBaseCli(baseArgv, options);
    return baseResult || v2Result;
  }

  return runBaseCli(baseArgv, options);
}
