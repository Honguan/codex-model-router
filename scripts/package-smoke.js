import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is unavailable");
const runNpm = (args, options) => exec(process.execPath, [npmCli, ...args], options);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "codex-model-router-pack-"));

try {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const packed = await runNpm(["pack", "--json", "--ignore-scripts"], { cwd: root });
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = join(root, filename);
  const project = join(temporary, "project");
  await mkdir(project, { recursive: true });
  await runNpm(["init", "-y"], { cwd: project });
  await runNpm(["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], { cwd: project });
  const binary = join(project, "node_modules", "codex-model-router", "bin", "codex-model-router.js");
  const version = await exec(process.execPath, [binary, "--version"], { cwd: project });
  assert.equal(version.stdout.trim(), packageJson.version);
  await exec(process.execPath, [binary, "install"], { cwd: project });
  await exec(process.execPath, [binary, "doctor"], { cwd: project });
  assert.match(await readFile(join(project, ".codex", "config.toml"), "utf8"), /gpt-5\.6-terra/);
  assert.match(await readFile(join(project, ".codex", "agents", "sol.toml"), "utf8"), /workspace-write/);
  await exec(process.execPath, [binary, "uninstall"], { cwd: project });
  await rm(tarball, { force: true });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
