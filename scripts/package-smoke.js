import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "codex-model-router-pack-"));

try {
  const packed = await exec(npm, ["pack", "--json", "--ignore-scripts"], { cwd: root });
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = join(root, filename);
  const project = join(temporary, "project");
  await mkdir(project, { recursive: true });
  await exec(npm, ["init", "-y"], { cwd: project });
  await exec(npm, ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], { cwd: project });
  const binary = join(project, "node_modules", "codex-model-router", "bin", "codex-model-router.js");
  await exec(process.execPath, [binary, "install"], { cwd: project });
  await exec(process.execPath, [binary, "doctor"], { cwd: project });
  assert.match(await readFile(join(project, ".codex", "config.toml"), "utf8"), /gpt-5\.6-terra/);
  await exec(process.execPath, [binary, "uninstall"], { cwd: project });
  await rm(tarball, { force: true });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
