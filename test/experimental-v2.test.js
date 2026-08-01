import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runCli } from "../lib/agent-reasoning-cli.js";
import { runV2Command } from "../lib/experimental-v2.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-model-router-v2-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
  return {
    root,
    project,
    home,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function collect() {
  const lines = [];
  return { lines, output: (line) => lines.push(String(line)) };
}

function paths(dir, codexHome = join(dir.project, ".codex")) {
  return {
    codexHome,
    config: join(codexHome, "config.toml"),
    state: join(codexHome, "model-router-v2-state.json"),
    lock: join(codexHome, "model-router.lock")
  };
}

test("V2 dry-run performs no writes", async () => {
  const dir = await fixture();
  try {
    const result = collect();
    assert.equal(await runV2Command(["enable", "--dry-run"], {
      cwd: dir.project,
      home: dir.home,
      output: result.output
    }), 0);
    assert.equal(await exists(paths(dir).codexHome), false);
    assert(result.lines.some((line) => line.startsWith("would-create: experimental-v2")));
  } finally {
    await dir.cleanup();
  }
});

test("managed V2 preserves BOM, CRLF, and unrelated config byte-for-byte", async () => {
  const dir = await fixture();
  try {
    const target = paths(dir);
    const original = '\uFEFFmodel = "custom"\r\n# keep this comment\r\n';
    await mkdir(dirname(target.config), { recursive: true });
    await writeFile(target.config, original, "utf8");

    assert.equal(await runV2Command(["enable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    const enabled = await readFile(target.config, "utf8");
    assert(enabled.startsWith(original));
    assert.match(enabled, /\[features\.multi_agent_v2\]\r\n/);
    assert.match(enabled, /hide_spawn_agent_metadata = false\r\n/);
    assert.match(enabled, /tool_namespace = "agents"\r\n/);
    assert.equal(await exists(target.state), true);

    const status = collect();
    assert.equal(await runV2Command(["status"], {
      cwd: dir.project,
      home: dir.home,
      output: status.output
    }), 0);
    assert(status.lines.some((line) => line.startsWith("healthy: experimental-v2")));

    assert.equal(await runV2Command(["disable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    assert.equal(await readFile(target.config, "utf8"), original);
    assert.equal(await exists(target.state), false);
  } finally {
    await dir.cleanup();
  }
});

test("BOM-only config remains identifiable and restores exactly", async () => {
  const dir = await fixture();
  try {
    const target = paths(dir);
    const original = "\uFEFF";
    await mkdir(dirname(target.config), { recursive: true });
    await writeFile(target.config, original, "utf8");

    assert.equal(await runV2Command(["enable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    assert.equal(await runV2Command(["status"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    assert.equal(await runV2Command(["disable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    assert.equal(await readFile(target.config, "utf8"), original);
  } finally {
    await dir.cleanup();
  }
});

test("V2 creates and later removes an otherwise empty config", async () => {
  const dir = await fixture();
  try {
    const target = paths(dir);
    assert.equal(await runV2Command(["enable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    assert.equal(await exists(target.config), true);
    assert.equal(await runV2Command(["disable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    assert.equal(await exists(target.config), false);
    assert.equal(await exists(target.state), false);
  } finally {
    await dir.cleanup();
  }
});

test("pre-existing V2 configuration is preserved and remains unmanaged", async () => {
  const dir = await fixture();
  try {
    const target = paths(dir);
    const original = '[features.multi_agent_v2]\ntool_namespace = "custom"\n';
    await mkdir(dirname(target.config), { recursive: true });
    await writeFile(target.config, original, "utf8");
    const result = collect();
    assert.equal(await runV2Command(["enable"], {
      cwd: dir.project,
      home: dir.home,
      output: result.output
    }), 0);
    assert.equal(await readFile(target.config, "utf8"), original);
    assert.equal(await exists(target.state), false);
    assert(result.lines.some((line) => line.startsWith("preserve: experimental-v2")));
  } finally {
    await dir.cleanup();
  }
});

test("user changes inside the managed V2 block are never overwritten", async () => {
  const dir = await fixture();
  try {
    const target = paths(dir);
    await runV2Command(["enable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    });
    const changed = (await readFile(target.config, "utf8"))
      .replace('tool_namespace = "agents"', 'tool_namespace = "custom"');
    await writeFile(target.config, changed, "utf8");

    assert.equal(await runV2Command(["status"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 1);
    assert.equal(await runV2Command(["disable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 1);
    assert.equal(await readFile(target.config, "utf8"), changed);
    assert.equal(await exists(target.state), true);
  } finally {
    await dir.cleanup();
  }
});

test("stale same-host scope lock is recovered conservatively", async () => {
  const dir = await fixture();
  try {
    const target = paths(dir);
    await mkdir(target.codexHome, { recursive: true });
    await writeFile(target.lock, `${JSON.stringify({
      version: 1,
      token: "stale-token",
      pid: 2147483647,
      hostname: hostname(),
      command: "interrupted-operation",
      scope: "project",
      startedAt: "2000-01-01T00:00:00.000Z"
    }, null, 2)}\n`, "utf8");

    assert.equal(await runV2Command(["enable"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
    assert.equal(await exists(target.lock), false);
    assert.equal(await runV2Command(["status"], {
      cwd: dir.project,
      home: dir.home,
      output: () => {}
    }), 0);
  } finally {
    await dir.cleanup();
  }
});

test("global V2 scope honors CODEX_HOME", async () => {
  const dir = await fixture();
  try {
    const codexHome = join(dir.root, "custom-codex-home");
    const target = paths(dir, codexHome);
    const options = {
      cwd: dir.project,
      home: dir.home,
      env: { ...process.env, CODEX_HOME: codexHome },
      output: () => {}
    };
    assert.equal(await runV2Command(["enable", "--global"], options), 0);
    assert.equal(await exists(target.config), true);
    assert.equal(await exists(target.state), true);
    assert.equal(await runV2Command(["disable", "--global"], options), 0);
    assert.equal(await exists(target.config), false);
  } finally {
    await dir.cleanup();
  }
});

test("normal install never enables V2 and uninstall cleans a managed opt-in", async () => {
  const dir = await fixture();
  try {
    const target = paths(dir);
    const options = { cwd: dir.project, home: dir.home, output: () => {} };
    assert.equal(await runCli(["install"], options), 0);
    assert.equal(await exists(target.state), false);
    const installedConfig = await exists(target.config)
      ? await readFile(target.config, "utf8")
      : "";
    assert.doesNotMatch(installedConfig, /multi_agent_v2/);

    assert.equal(await runCli(["v2", "enable"], options), 0);
    assert.equal(await exists(target.state), true);
    assert.equal(await runCli(["uninstall"], options), 0);
    assert.equal(await exists(target.state), false);
    assert.equal(await exists(target.config), false);
  } finally {
    await dir.cleanup();
  }
});
