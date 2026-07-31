import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { run } from "../lib/router.js";

const exec = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-"));
  return {
    root,
    project: join(root, "project folder"),
    home: join(root, "home"),
    async cleanup() { await rm(root, { recursive: true, force: true }); }
  };
}

async function text(path) { return readFile(path, "utf8"); }

test("exposes the codex-model-router binary", async () => {
  const dir = await fixture();
  try {
    await mkdir(dir.project, { recursive: true });
    const result = await exec(process.execPath, [join(process.cwd(), "bin", "codex-model-router.js"), "install"], { cwd: dir.project });
    assert.match(result.stdout, /created: luna/);
    const doctor = await exec(process.execPath, [join(process.cwd(), "bin", "codex-model-router.js"), "doctor"], { cwd: dir.project });
    assert.match(doctor.stdout, /healthy/);
  } finally { await dir.cleanup(); }
});

test("installs and removes project configuration without touching unrelated settings", async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    await writeFile(join(dir.project, ".codex", "config.toml"), "theme = \"dark\"\n");

    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 0);
    const config = await text(join(dir.project, ".codex", "config.toml"));
    assert.match(config, /^theme = "dark"$/m);
    assert.match(config, /^model = "gpt-5.6-terra"$/m);
    assert.match(config, /^model_reasoning_effort = "high"$/m);
    assert.match(await text(join(dir.project, ".codex", "agents", "luna.toml")), /model = "gpt-5.6-luna"/);
    assert.match(await text(join(dir.project, ".codex", "agents", "sol.toml")), /sandbox_mode = "read-only"/);
    assert.match(await text(join(dir.project, ".agents", "skills", "model-router", "SKILL.md")), /Terra handles/);

    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home }), 0);
    assert.equal(await text(join(dir.project, ".codex", "config.toml")), "theme = \"dark\"\n");
  } finally { await dir.cleanup(); }
});

test("installs global configuration in Windows-compatible paths", async () => {
  const dir = await fixture();
  try {
    assert.equal(await run(["install", "--global"], { cwd: dir.project, home: dir.home }), 0);
    assert.match(await text(join(dir.home, ".codex", "config.toml")), /gpt-5.6-terra/);
    assert.match(await text(join(dir.home, ".codex", "agents", "sol.toml")), /read-only/);
    assert.match(await text(join(dir.home, ".agents", "skills", "model-router", "SKILL.md")), /Luna/);
  } finally { await dir.cleanup(); }
});

test("is repeatable and preserves user edits to managed values and files", async () => {
  const dir = await fixture();
  try {
    await run(["install"], { cwd: dir.project, home: dir.home });
    const config = join(dir.project, ".codex", "config.toml");
    const luna = join(dir.project, ".codex", "agents", "luna.toml");
    const sol = join(dir.project, ".codex", "agents", "sol.toml");
    const skill = join(dir.project, ".agents", "skills", "model-router", "SKILL.md");
    await writeFile(config, (await text(config)).replace("gpt-5.6-terra", "custom-model").replace("high", "medium"));
    await writeFile(luna, "user agent\n");
    await writeFile(sol, "user reviewer\n");
    await writeFile(skill, "user skill\n");

    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 0);
    assert.match(await text(config), /custom-model/);
    assert.equal(await text(luna), "user agent\n");
    assert.equal(await text(sol), "user reviewer\n");
    assert.equal(await text(skill), "user skill\n");
    assert.equal(await run(["uninstall"], { cwd: dir.project, home: dir.home }), 0);
    assert.match(await text(config), /custom-model/);
    assert.equal(await text(luna), "user agent\n");
    assert.equal(await text(sol), "user reviewer\n");
    assert.equal(await text(skill), "user skill\n");
  } finally { await dir.cleanup(); }
});

test("refuses malformed TOML and preserves CRLF files", async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir.project, ".codex"), { recursive: true });
    const config = join(dir.project, ".codex", "config.toml");
    await writeFile(config, "theme = \"dark\"\r\n");
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 0);
    assert.match(await text(config), /\r\n/);

    await writeFile(config, "model = \"broken\n");
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home }), 1);
    assert.equal(await text(config), "model = \"broken\n");
  } finally { await dir.cleanup(); }
});

test("doctor reports action required when a managed file changes", async () => {
  const dir = await fixture();
  try {
    await run(["install"], { cwd: dir.project, home: dir.home });
    await writeFile(join(dir.project, ".codex", "agents", "sol.toml"), "changed\n");
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home }), 1);
  } finally { await dir.cleanup(); }
});
