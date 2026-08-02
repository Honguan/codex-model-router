import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveLocations } from "./enhanced-cli.js";
import { MANAGED_FILE_NAMES } from "./manifest.js";

const SUPPORTED_STATE_VERSIONS = new Set([2, 3, 4]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function normalizePath(path) {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function samePath(left, right) {
  return typeof left === "string" && typeof right === "string" &&
    normalizePath(left) === normalizePath(right);
}

function isWithin(path, root) {
  if (typeof path !== "string" || typeof root !== "string" || !isAbsolute(path)) return false;
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function readUtf8(path) {
  try {
    const bytes = await readFile(path);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${path} is not valid UTF-8`);
    return { exists: true, text };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: "" };
    throw error;
  }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  let mode = 0o600;
  try { mode = (await stat(path)).mode; } catch (error) {
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

function assertPath(actual, expected, label) {
  if (!samePath(actual, expected)) throw new Error(`unsafe legacy state path for ${label}`);
}

function validateLegacyHomeProjectState(state, locations) {
  if (!state || typeof state !== "object") throw new Error("legacy state is not an object");
  if (!SUPPORTED_STATE_VERSIONS.has(state.version)) throw new Error(`unsupported legacy state version: ${state.version}`);
  if (state.scope !== "project") throw new Error("legacy state is not project scoped");

  const expectedCodex = join(locations.userHome, ".codex");
  const expectedSkills = join(locations.userHome, ".agents", "skills");
  const expectedSkillsRoot = dirname(expectedSkills);
  assertPath(locations.selected.codexHome, expectedCodex, "selected Codex root");
  assertPath(locations.selected.skillsHome, expectedSkills, "selected skills root");
  assertPath(state.roots?.codex, expectedCodex, "Codex root");
  assertPath(state.roots?.skills, expectedSkills, "skills root");
  assertPath(state.roots?.skillsRoot ?? dirname(state.roots?.skills || ""), expectedSkillsRoot, "skills parent root");
  assertPath(state.config?.path, locations.selected.config, "config");

  if (typeof state.config?.createdFile !== "boolean" || typeof state.config?.values !== "object" || state.config.values === null) {
    throw new Error("invalid legacy config state");
  }

  if (!state.files || typeof state.files !== "object" || Array.isArray(state.files)) {
    throw new Error("invalid legacy files state");
  }
  for (const [name, item] of Object.entries(state.files)) {
    if (!MANAGED_FILE_NAMES.includes(name)) throw new Error(`unknown legacy managed file: ${name}`);
    assertPath(item?.path, locations.selected[name], name);
    if (!HASH_PATTERN.test(item?.hash || "")) throw new Error(`invalid legacy hash for ${name}`);
  }

  if (state.backup) {
    assertPath(state.backup.path, locations.selected.backup, "backup");
    if (!HASH_PATTERN.test(state.backup.hash || "")) throw new Error("invalid legacy backup hash");
  }

  if (!Array.isArray(state.createdDirs)) throw new Error("invalid legacy createdDirs state");
  for (const directory of state.createdDirs) {
    if (!isWithin(directory, expectedCodex) && !isWithin(directory, expectedSkillsRoot)) {
      throw new Error(`unsafe legacy managed directory: ${directory}`);
    }
  }
}

async function readCandidate(locations) {
  const file = await readUtf8(locations.selected.state);
  if (!file.exists) return { status: "none" };
  let state;
  try { state = JSON.parse(file.text); } catch { return { status: "none" }; }
  if (state?.scope !== "project") return { status: "none" };
  try {
    validateLegacyHomeProjectState(state, locations);
    return { status: "candidate", state };
  } catch (error) {
    return { status: "blocked", detail: error.message };
  }
}

async function assertPhysicalCodexRoot(locations) {
  const expected = join(locations.userHome, ".codex");
  const info = await lstat(locations.selected.codexHome);
  if (info.isSymbolicLink()) throw new Error("legacy Codex root is a symbolic link or junction");
  const physical = await realpath(locations.selected.codexHome);
  if (!samePath(physical, expected)) throw new Error(`legacy Codex root resolves outside ${expected}`);
  const stateInfo = await lstat(locations.selected.state);
  if (stateInfo.isSymbolicLink()) throw new Error("legacy state file is a symbolic link or junction");
}

async function acquireMigrationLock(locations) {
  const token = randomUUID();
  let handle;
  try {
    handle = await open(locations.selected.lock, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({
      version: 1,
      token,
      pid: process.pid,
      hostname: hostname(),
      command: "scope-migration",
      scope: "global",
      startedAt: new Date().toISOString()
    }, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    return { token };
  } catch (error) {
    try { await handle?.close(); } catch {}
    if (error?.code === "EEXIST") throw new Error("scope is locked; retry after the current operation finishes");
    throw error;
  }
}

async function releaseMigrationLock(locations) {
  try { await rm(locations.selected.lock, { force: true }); } catch {}
}

function isRoutingCommand(argv) {
  if (argv[0] === "v2") return false;
  return ["enable", "disable", "status", "install", "uninstall", "doctor", "adopt", "repair"].includes(argv[0]);
}

function isMutatingRoutingCommand(argv) {
  return ["enable", "disable", "install", "uninstall", "repair"].includes(argv[0]);
}

function hasFlag(argv, name) {
  return argv.some((token) => token === name || token.startsWith(`${name}=`));
}

export async function migrateLegacyHomeProjectState(argv, options = {}) {
  if (!isRoutingCommand(argv) || !hasFlag(argv, "--global")) return { status: "none" };

  const locations = await resolveLocations(options, true);
  const expectedCodex = join(locations.userHome, ".codex");
  if (!samePath(locations.selected.codexHome, expectedCodex)) return { status: "none" };

  const candidate = await readCandidate(locations);
  if (candidate.status !== "candidate") return candidate;

  if (hasFlag(argv, "--dry-run")) return { status: "needed", dryRun: true };
  if (!isMutatingRoutingCommand(argv)) return { status: "needed", dryRun: false };

  let lock;
  try {
    await assertPhysicalCodexRoot(locations);
    const journal = await readUtf8(locations.selected.journal);
    if (journal.exists) throw new Error("an unfinished transaction must be recovered before scope migration");
    lock = await acquireMigrationLock(locations);

    const afterLock = await readCandidate(locations);
    if (afterLock.status === "none") return { status: "none" };
    if (afterLock.status === "blocked") return afterLock;
    const migrated = { ...afterLock.state, scope: "global" };
    await atomicWrite(locations.selected.state, `${JSON.stringify(migrated, null, 2)}\n`);
    return { status: "migrated" };
  } catch (error) {
    return { status: "blocked", detail: error.message };
  } finally {
    if (lock) await releaseMigrationLock(locations);
  }
}
