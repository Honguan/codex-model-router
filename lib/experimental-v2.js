import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const STATE_FILE = "model-router-v2-state.json";
const LOCK_FILE = "model-router.lock";
const START_MARKER = "# >>> codex-model-router experimental multi-agent-v2 >>>";
const END_MARKER = "# <<< codex-model-router experimental multi-agent-v2 <<<";
const STATE_VERSION = 1;

export const EXPERIMENTAL_V2_SETTINGS = Object.freeze({
  hide_spawn_agent_metadata: false,
  tool_namespace: "agents"
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(path) {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithin(path, root) {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
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
      if (parent === current) throw new Error(`no existing ancestor for ${path}`);
      current = parent;
    }
  }
}

async function canonicalize(path) {
  const absolute = resolve(path);
  const ancestor = await nearestExistingAncestor(absolute);
  return resolve(await realpath(ancestor), relative(ancestor, absolute));
}

async function assertSafePath(target, root, anchor, label) {
  const absoluteTarget = resolve(target);
  const absoluteRoot = resolve(root);
  const absoluteAnchor = resolve(anchor);
  if (!isWithin(absoluteTarget, absoluteRoot) || !isWithin(absoluteTarget, absoluteAnchor)) {
    throw new Error(`unsafe path for ${label}: ${absoluteTarget}`);
  }

  const physicalAnchor = await realpath(absoluteAnchor);
  let current = absoluteAnchor;
  const inspect = [current];
  for (const component of relative(absoluteAnchor, absoluteTarget).split(sep).filter(Boolean)) {
    current = join(current, component);
    inspect.push(current);
  }

  for (let index = 0; index < inspect.length; index += 1) {
    const candidate = inspect[index];
    let info;
    try {
      info = await lstat(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`unsafe symbolic link or junction: ${candidate}`);
    if (index < inspect.length - 1 && !info.isDirectory()) {
      throw new Error(`unsafe non-directory path component: ${candidate}`);
    }
    const physical = await realpath(candidate);
    const expected = resolve(physicalAnchor, relative(absoluteAnchor, candidate));
    if (normalizePath(physical) !== normalizePath(expected)) {
      throw new Error(`unsafe redirected path: ${candidate}`);
    }
  }
}

async function locationFor(options, global) {
  const home = await canonicalize(options.home ?? homedir());
  const cwd = await canonicalize(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const codexHome = global
    ? resolve(env.CODEX_HOME || join(home, ".codex"))
    : join(cwd, ".codex");
  const anchor = global ? await nearestExistingAncestor(codexHome) : cwd;
  const location = {
    scope: global ? "global" : "project",
    codexHome,
    config: join(codexHome, "config.toml"),
    state: join(codexHome, STATE_FILE),
    lock: join(codexHome, LOCK_FILE),
    anchor
  };
  await validateLocation(location);
  return location;
}

async function validateLocation(location) {
  for (const [label, target] of Object.entries({
    "Codex home": location.codexHome,
    "config.toml": location.config,
    "experimental V2 state": location.state,
    "scope lock": location.lock
  })) {
    await assertSafePath(target, location.codexHome, location.anchor, label);
  }
}

async function readText(path) {
  try {
    const bytes = await readFile(path);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${path} is not valid UTF-8`);
    if (text.includes("\0")) throw new Error(`${path} contains a NUL byte`);
    return { exists: true, text };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: "" };
    throw error;
  }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  let mode = 0o600;
  try {
    mode = (await stat(path)).mode;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await rm(temporary, { force: true }); } catch {}
    throw error;
  }
}

function newlineFor(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function managedBlock(newline) {
  return [
    START_MARKER,
    "[features.multi_agent_v2]",
    "hide_spawn_agent_metadata = false",
    'tool_namespace = "agents"',
    END_MARKER,
    ""
  ].join(newline);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findManagedV2Block(content) {
  const starts = [...content.matchAll(new RegExp(`^${escapeRegExp(START_MARKER)}\\r?$`, "gm"))];
  const ends = [...content.matchAll(new RegExp(`^${escapeRegExp(END_MARKER)}\\r?$`, "gm"))];
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index <= starts[0].index) {
    return { error: "duplicate, incomplete, or misordered experimental V2 markers" };
  }
  const start = starts[0].index;
  let end = ends[0].index + ends[0][0].length;
  if (content[end] === "\n") end += 1;
  return { start, end, content: content.slice(start, end) };
}

function stripInlineComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (quote === '"' && character === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (character === quote && !escaped) quote = null;
      escaped = false;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "#") return line.slice(0, index);
  }
  return line;
}

function hasUnmanagedV2(content) {
  return content.split(/\r?\n/).some((line) => /\bmulti_agent_v2\b/.test(stripInlineComment(line)));
}

function appendBlock(original) {
  const newline = newlineFor(original);
  const block = managedBlock(newline);
  const hasBom = original.charCodeAt(0) === 0xfeff;
  const body = original.slice(hasBom ? 1 : 0);
  let separator = "";
  if (body.length > 0) {
    if (body.endsWith(`${newline}${newline}`)) separator = "";
    else if (body.endsWith(newline)) separator = newline;
    else separator = `${newline}${newline}`;
  } else if (hasBom) {
    separator = newline;
  }
  return { content: `${original}${separator}${block}`, block, separator };
}

function validateState(raw, location) {
  if (!raw || typeof raw !== "object" || raw.version !== STATE_VERSION) {
    throw new Error("experimental V2 state is invalid or unsupported");
  }
  if (raw.scope !== location.scope) throw new Error("experimental V2 state scope mismatch");
  if (normalizePath(raw.configPath) !== normalizePath(location.config)) {
    throw new Error("experimental V2 state path mismatch");
  }
  if (typeof raw.createdConfig !== "boolean") throw new Error("experimental V2 createdConfig is invalid");
  if (typeof raw.separator !== "string" || !["", "\n", "\n\n", "\r\n", "\r\n\r\n"].includes(raw.separator)) {
    throw new Error("experimental V2 separator is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(raw.blockHash || "")) throw new Error("experimental V2 block hash is invalid");
  return raw;
}

async function loadState(location) {
  const file = await readText(location.state);
  if (!file.exists) return { exists: false, state: null };
  let raw;
  try {
    raw = JSON.parse(file.text);
  } catch {
    throw new Error("experimental V2 state is not valid JSON");
  }
  return { exists: true, state: validateState(raw, location) };
}

async function inspect(location) {
  const state = await loadState(location);
  const config = await readText(location.config);
  const block = findManagedV2Block(config.text);
  if (block?.error) return { status: "invalid", detail: block.error, state, config, block };
  if (!state.exists) {
    if (block) return { status: "untracked", detail: "package markers exist without state", state, config, block };
    if (hasUnmanagedV2(config.text)) {
      return { status: "unmanaged", detail: "pre-existing V2 configuration is preserved", state, config, block };
    }
    return { status: "disabled", state, config, block };
  }
  if (!config.exists) return { status: "missing", detail: "config.toml is missing", state, config, block };
  if (!block) return { status: "missing", detail: "managed V2 block is missing", state, config, block };
  if (digest(block.content) !== state.state.blockHash) {
    return { status: "user-modified", detail: "managed V2 block changed", state, config, block };
  }
  return { status: "managed", state, config, block };
}

async function inspectLock(location) {
  const file = await readText(location.lock);
  if (!file.exists) return { status: "none" };
  let metadata;
  try {
    metadata = JSON.parse(file.text);
  } catch {
    return { status: "corrupt", detail: "lock file is not valid JSON" };
  }
  if (
    !Number.isInteger(metadata.pid) ||
    metadata.pid <= 0 ||
    typeof metadata.hostname !== "string" ||
    typeof metadata.token !== "string"
  ) {
    return { status: "corrupt", detail: "lock metadata is invalid" };
  }
  if (metadata.hostname !== hostname()) {
    return { status: "active", metadata, detail: "lock belongs to another host" };
  }
  let alive = true;
  try {
    process.kill(metadata.pid, 0);
  } catch (error) {
    if (["ESRCH", "EINVAL"].includes(error?.code)) alive = false;
    else if (error?.code !== "EPERM") throw error;
  }
  return alive ? { status: "active", metadata } : { status: "stale", metadata };
}

async function acquireLock(location, command) {
  await mkdir(location.codexHome, { recursive: true });
  await validateLocation(location);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID();
    let handle;
    try {
      handle = await open(location.lock, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        version: 1,
        token,
        pid: process.pid,
        hostname: hostname(),
        command,
        scope: location.scope,
        startedAt: new Date().toISOString()
      }, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return token;
    } catch (error) {
      try { await handle?.close(); } catch {}
      if (error?.code !== "EEXIST") throw error;
      const lock = await inspectLock(location);
      if (lock.status === "none") continue;
      if (lock.status === "stale") {
        const before = await readText(location.lock);
        const again = await readText(location.lock);
        if (before.exists && again.exists && before.text === again.text) {
          await rm(location.lock, { force: true });
          continue;
        }
      }
      const detail = lock.metadata
        ? `${lock.metadata.command || "operation"} pid ${lock.metadata.pid}`
        : lock.detail || "unknown lock owner";
      throw new Error(`scope is locked by ${detail}`);
    }
  }
  throw new Error("unable to acquire scope lock");
}

async function releaseLock(location, token) {
  if (!token) return;
  try {
    const lock = await readText(location.lock);
    if (!lock.exists) return;
    const metadata = JSON.parse(lock.text);
    if (metadata.token === token) await rm(location.lock, { force: true });
  } catch {}
}

function print(output, status, detail) {
  output?.(`${status}: experimental-v2${detail ? ` (${detail})` : ""}`);
}

function enablePlan(current, location) {
  const next = appendBlock(current.config.text);
  return {
    configContent: next.content,
    stateContent: `${JSON.stringify({
      version: STATE_VERSION,
      scope: location.scope,
      configPath: location.config,
      createdConfig: !current.config.exists,
      separator: next.separator,
      blockHash: digest(next.block),
      enabledAt: new Date().toISOString()
    }, null, 2)}\n`,
    configStatus: current.config.exists ? "update" : "create"
  };
}

function repairPlan(current) {
  const newline = newlineFor(current.config.text);
  const block = managedBlock(newline);
  const appended = current.block ? null : appendBlock(current.config.text);
  return {
    configContent: current.block
      ? `${current.config.text.slice(0, current.block.start)}${block}${current.config.text.slice(current.block.end)}`
      : appended.content,
    stateContent: `${JSON.stringify({
      ...current.state.state,
      createdConfig: current.state.state.createdConfig || !current.config.exists,
      separator: current.block ? current.state.state.separator : appended.separator,
      blockHash: digest(block),
      repairedAt: new Date().toISOString()
    }, null, 2)}\n`
  };
}

function disablePlan(current) {
  let before = current.config.text.slice(0, current.block.start);
  const separator = current.state.state.separator;
  if (separator && before.endsWith(separator)) before = before.slice(0, -separator.length);
  const restored = `${before}${current.config.text.slice(current.block.end)}`;
  const empty = restored.replace(/^\uFEFF/, "").trim() === "";
  return {
    restored,
    deleteConfig: current.state.state.createdConfig && empty
  };
}

async function restoreOriginalConfig(location, config) {
  if (config.exists) await atomicWrite(location.config, config.text);
  else await rm(location.config, { force: true });
}

async function enable(location, options) {
  const preview = await inspect(location);
  if (preview.status === "managed") {
    print(options.output, "skip", "already enabled and managed");
    return 0;
  }
  if (preview.status === "unmanaged") {
    print(options.output, "preserve", preview.detail);
    return 0;
  }
  const repairing = ["user-modified", "missing"].includes(preview.status);
  if (!repairing && preview.status !== "disabled") {
    print(options.output, "fail", preview.detail || preview.status);
    return 1;
  }
  if (options.dryRun) {
    if (repairing) {
      print(options.output, "would-repair", "managed V2 block");
      print(options.output, "would-update", "experimental V2 state");
      return 0;
    }
    const plan = enablePlan(preview, location);
    print(options.output, `would-${plan.configStatus}`, "config.toml");
    print(options.output, "would-create", "experimental V2 state");
    return 0;
  }

  let token;
  try {
    token = await acquireLock(location, repairing ? "v2-repair" : "v2-enable");
    const current = await inspect(location);
    const expectedStatus = repairing ? preview.status : "disabled";
    if (current.status !== expectedStatus) {
      print(options.output, "fail", `state changed during ${repairing ? "repair" : "enable"}: ${current.status}`);
      return 1;
    }

    if (repairing) {
      const plan = repairPlan(current);
      await atomicWrite(location.config, plan.configContent);
      try {
        await atomicWrite(location.state, plan.stateContent);
      } catch (error) {
        await restoreOriginalConfig(location, current.config);
        throw error;
      }
      print(options.output, "repair", "managed V2 block restored");
      print(options.output, "update", "experimental V2 state");
      return 0;
    }

    const plan = enablePlan(current, location);
    await atomicWrite(location.config, plan.configContent);
    try {
      await atomicWrite(location.state, plan.stateContent);
    } catch (error) {
      await restoreOriginalConfig(location, current.config);
      throw error;
    }
    print(options.output, plan.configStatus, "config.toml");
    print(options.output, "create", "experimental V2 state");
    return 0;
  } finally {
    await releaseLock(location, token);
  }
}

async function disable(location, options) {
  const preview = await inspect(location);
  if (preview.status === "disabled" || preview.status === "unmanaged") {
    if (!options.onlyManaged) print(options.output, preview.status === "disabled" ? "skip" : "preserve", preview.detail || "not enabled by this package");
    return 0;
  }
  if (preview.status !== "managed") {
    print(options.output, "preserve", preview.detail || preview.status);
    return 1;
  }
  if (options.dryRun) {
    const plan = disablePlan(preview);
    print(options.output, plan.deleteConfig ? "would-remove" : "would-update", "config.toml");
    print(options.output, "would-remove", "experimental V2 state");
    return 0;
  }

  let token;
  try {
    token = await acquireLock(location, "v2-disable");
    const current = await inspect(location);
    if (current.status !== "managed") {
      print(options.output, "preserve", `state changed during disable: ${current.status}`);
      return 1;
    }
    const plan = disablePlan(current);
    if (plan.deleteConfig) await rm(location.config, { force: true });
    else await atomicWrite(location.config, plan.restored);
    try {
      await rm(location.state, { force: true });
    } catch (error) {
      await atomicWrite(location.config, current.config.text);
      throw error;
    }
    print(options.output, plan.deleteConfig ? "remove" : "update", "config.toml");
    print(options.output, "remove", "experimental V2 state");
    return 0;
  } finally {
    await releaseLock(location, token);
  }
}

async function status(location, options) {
  const current = await inspect(location);
  const mapping = {
    managed: ["healthy", "managed experimental setting"],
    disabled: ["disabled", "not enabled"],
    unmanaged: ["preserve", current.detail],
    untracked: ["unsafe-state", current.detail],
    missing: ["missing", current.detail],
    "user-modified": ["user-modified", current.detail],
    invalid: ["invalid", current.detail]
  };
  const [label, detail] = mapping[current.status] || ["invalid", current.status];
  if (!(options.quietIfDisabled && current.status === "disabled")) print(options.output, label, detail);
  return ["managed", "disabled", "unmanaged"].includes(current.status) ? 0 : 1;
}

function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [action, ...flags] = argv;
  if (!["enable", "disable", "status"].includes(action)) return { error: "unknown V2 action" };
  const parsed = { action, global: false, dryRun: false };
  for (const flag of flags) {
    if (flag === "--global") parsed.global = true;
    else if (flag === "--dry-run" && action !== "status") parsed.dryRun = true;
    else return { error: `unsupported option for v2 ${action}: ${flag}` };
  }
  return parsed;
}

export function v2Usage() {
  return `Experimental Codex multi-agent V2 settings\n\nUsage:\n  codex-model-router v2 enable [--global] [--dry-run]\n  codex-model-router v2 disable [--global] [--dry-run]\n  codex-model-router v2 status [--global]\n\nThis is an undocumented Codex setting and may change or stop working without notice.`;
}

export async function runV2Command(argv, options = {}) {
  const output = options.output ?? console.log;
  const parsed = parseArgs(argv);
  if (parsed.help) {
    output(v2Usage());
    return 0;
  }
  if (parsed.error) {
    output(`${parsed.error}\n\n${v2Usage()}`);
    return 1;
  }
  try {
    const location = await locationFor(options, parsed.global);
    if (parsed.action === "enable") return enable(location, { output, dryRun: parsed.dryRun });
    if (parsed.action === "disable") return disable(location, { output, dryRun: parsed.dryRun });
    return status(location, { output });
  } catch (error) {
    print(output, "fail", error.message);
    return 1;
  }
}

function scopeFlags(argv) {
  return { global: argv.includes("--global"), dryRun: argv.includes("--dry-run") };
}

export async function reportV2Doctor(argv, options = {}) {
  const output = options.output ?? console.log;
  try {
    const location = await locationFor(options, scopeFlags(argv).global);
    return status(location, { output, quietIfDisabled: true });
  } catch (error) {
    print(output, "fail", error.message);
    return 1;
  }
}

export async function cleanupV2AfterUninstall(argv, options = {}) {
  const output = options.output ?? console.log;
  try {
    const flags = scopeFlags(argv);
    const location = await locationFor(options, flags.global);
    if (!(await readText(location.state)).exists) return 0;
    return disable(location, { output, dryRun: flags.dryRun, onlyManaged: true });
  } catch (error) {
    print(output, "fail", error.message);
    return 1;
  }
}
