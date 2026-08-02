import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
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

  const help = await exec(process.execPath, [binary, "--help"], { cwd: project });
  assert.match(help.stdout, /npx codex-model-router install/);
  assert.match(help.stdout, /npx codex-model-router uninstall/);
  assert.match(help.stdout, /--set-default/);
  assert.match(help.stdout, /--v2/);
  assert.match(help.stdout, /disabled by default/);
  assert.doesNotMatch(help.stdout, /\bv2 enable\b/);
  assert.doesNotMatch(help.stdout, /\bstatus\b/);
  assert.doesNotMatch(help.stdout, /--dry-run/);

  await assert.rejects(
    exec(process.execPath, [binary, "install", "--dry-run"], { cwd: project }),
    /Command failed/
  );
  await assert.rejects(access(join(project, ".codex")));

  await exec(process.execPath, [binary, "install", "--v2"], { cwd: project });
  const config = await readFile(join(project, ".codex", "config.toml"), "utf8");
  assert.match(config, /\[features\.multi_agent_v2\]/);
  assert.match(config, /tool_namespace = "agents"/);
  await access(join(project, ".codex", "model-router-v2-state.json"));
  assert.match(await readFile(join(project, ".codex", "agents", "terra.toml"), "utf8"), /gpt-5\.6-terra/);
  assert.match(await readFile(join(project, ".codex", "agents", "luna.toml"), "utf8"), /model_reasoning_effort = "xhigh"/);
  assert.match(await readFile(join(project, ".codex", "agents", "sol.toml"), "utf8"), /sandbox_mode = "read-only"/);
  assert.match(await readFile(join(project, ".agents", "skills", "model-router", "SKILL.md"), "utf8"), /REQUIREMENT_EVIDENCE/);
  assert.match(await readFile(join(project, ".agents", "skills", "implementation-planning", "SKILL.md"), "utf8"), /EVIDENCE_VERSION/);

  await exec(process.execPath, [binary, "install"], { cwd: project });
  await assert.rejects(access(join(project, ".codex", "model-router-v2-state.json")));
  await assert.rejects(access(join(project, ".codex", "config.toml")));
  await access(join(project, ".codex", "agents", "luna.toml"));

  await exec(process.execPath, [binary, "uninstall"], { cwd: project });
  await assert.rejects(access(join(project, ".codex")));
  await assert.rejects(access(join(project, ".agents")));
  await rm(tarball, { force: true });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
