import { createHash, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { applyEdits, insertionEdit, removalEdit, scanToml } from "./toml.js";
import {
  AGENT_EXPECTATIONS,
  DEFAULTS,
  LEGACY_TEMPLATES,
  TEMPLATES,
  VERSION
} from "./manifest.js";

export { VERSION };

const STATE_VERSION = 3;
const LOCK_FILE = "model-router.lock";
const JOURNAL_FILE = "model-router-transaction.json";
const TRANSACTION_DIR = "model-router-transaction-data";
const TEST_CRASH_ENV = "CODEX_MODEL_ROUTER_TEST_CRASH_AFTER";
const TEST_HOLD_LOCK_ENV = "CODEX_MODEL_ROUTER_TEST_HOLD_LOCK_MS";
const TESTING_ENV = "CODEX_MODEL_ROUTER_TESTING";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function quoteToml(value) {
  return JSON.stringify(value);
}

function normalizeForCompare(path) {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithin(path, root) {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readBytes(path) {
  try {
    return { exists: true, bytes: await readFile(path) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, bytes: null };
    throw error;
  }
}

async function readText(path) {
  const file = await readBytes(path);
  if (!file.exists) return { exists: false, text: undefined };
  const text = file.bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(file.bytes)) {
    const error = new Error(`${path} is not valid UTF-8`);
    error.code = "INVALID_UTF8";
    throw error;
  }
  return { exists: true, text };
}

async function atomicWriteBytes(path, bytes) {
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
    await handle.writeFile(bytes);
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

async function atomicWrite(path, content) {
  return atomicWriteBytes(path, Buffer.from(content, "utf8"));
}

async function directoryExists(path) {
  try {
    return (await stat(path)).isDirectory();
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
      if (parent === current) throw new Error(`no existing ancestor for ${path}`);
      current = parent;
    }
  }
}

async function assertNoIndirection(target, root, anchor, label) {
  const absoluteTarget = resolve(target);
  const absoluteRoot = resolve(root);
  const absoluteAnchor = resolve(anchor);
  if (!isWithin(absoluteTarget, absoluteRoot)) {
    throw new Error(`unsafe path for ${label}: ${absoluteTarget} is outside ${absoluteRoot}`);
  }
  if (!isWithin(absoluteTarget, absoluteAnchor)) {
    throw new Error(`unsafe path for ${label}: ${absoluteTarget} is outside anchor ${absoluteAnchor}`);
  }

  const rel = relative(absoluteAnchor, absoluteTarget);
  const components = rel ? rel.split(sep) : [];
  let current = absoluteAnchor;
  const inspect = [current];
  for (const component of components) {
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
    if (info.isSymbolicLink()) {
      throw new Error(`unsafe path component for ${label}: ${candidate} is a symbolic link or junction`);
    }
    if (index < inspect.length - 1 && !info.isDirectory()) {
      throw new Error(`unsafe path component for ${label}: ${candidate} is not a directory`);
    }
    const physical = await realpath(candidate);
    if (normalizeForCompare(physical) !== normalizeForCompare(candidate)) {
      throw new Error(`unsafe path component for ${label}: ${candidate} resolves to ${physical}`);
    }
  }
}

function expectedPaths({ cwd, home, global, env }) {
  const userHome = resolve(home ?? homedir());
  const projectRoot = resolve(cwd);
  const codexHome = global
    ? resolve(env?.CODEX_HOME || join(userHome, ".codex"))
    : join(projectRoot, ".codex");
  const skillsHome = global
    ? join(userHome, ".agents", "skills")
    : join(projectRoot, ".agents", "skills");
  const skillsRoot = dirname(skillsHome);
  return {
    scope: global ? "global" : "project",
    projectRoot,
    userHome,
    codexHome,
    skillsHome,
    skillsRoot,
    config: join(codexHome, "config.toml"),
    state: join(codexHome, "model-router-state.json"),
    backup: join(codexHome, "config.toml.codex-model-router.bak"),
    luna: join(codexHome, ...TEMPLATES.luna.relative),
    sol: join(codexHome, ...TEMPLATES.sol.relative),
    skill: join(skillsHome, "model-router", "SKILL.md"),
    lock: join(codexHome, LOCK_FILE),
    journal: join(codexHome, JOURNAL_FILE),
    transactionData: join(codexHome, TRANSACTION_DIR)
  };
}

async function safetyAnchors(location) {
  const codexAnchor = location.scope === "project"
    ? location.projectRoot
    : await nearestExistingAncestor(location.codexHome);
  const skillsAnchor = location.scope === "project"
    ? location.projectRoot
    : location.userHome;
  return { codexAnchor, skillsAnchor };
}

async function validateLocationSafety(location) {
  const { codexAnchor, skillsAnchor } = await safetyAnchors(location);
  const codexTargets = [
    location.codexHome,
    location.config,
    location.state,
    location.backup,
    location.luna,
    location.sol,
    location.lock,
    location.journal,
    location.transactionData
  ];
  for (const target of codexTargets) {
    await assertNoIndirection(target, location.codexHome, codexAnchor, target);
  }
  const skillsTargets = [location.skillsRoot, location.skillsHome, location.skill];
  for (const target of skillsTargets) {
    await assertNoIndirection(target, location.skillsRoot, skillsAnchor, target);
  }
}

function assertExactPath(actual, expected, label) {
  if (normalizeForCompare(actual) !== normalizeForCompare(expected)) {
    throw new Error(`unsafe state path for ${label}`);
  }
}

function freshState(location) {
  return {
    version: STATE_VERSION,
    packageVersion: VERSION,
    scope: location.scope,
    roots: {
      codex: location.codexHome,
      skills: location.skillsHome,
      skillsRoot: location.skillsRoot
    },
    config: {
      path: location.config,
      createdFile: false,
      values: {}
    },
    files: {},
    backup: null,
    createdDirs: []
  };
}

function normalizeLegacyState(raw, location) {
  const state = freshState(location);
  if (!raw?.config || !raw?.files) throw new Error("invalid legacy state structure");
  assertExactPath(raw.config.path, location.config, "config");
  for (const [key, item] of Object.entries(raw.config.values || {})) {
    if (!Object.hasOwn(DEFAULTS, key) || item?.installed !== DEFAULTS[key]) {
      throw new Error(`invalid legacy state value: ${key}`);
    }
    state.config.values[key] = {
      installed: item.installed,
      previousRaw: item.previous == null ? null : quoteToml(String(item.previous)),
      source: item.previous == null ? "inserted" : "replaced"
    };
  }
  for (const name of ["luna", "sol", "skill"]) {
    const item = raw.files[name];
    if (!item) continue;
    assertExactPath(item.path, location[name], name);
    state.files[name] = { path: location[name], hash: item.hash };
  }
  if (raw.backup) {
    assertExactPath(raw.backup.path, location.backup, "backup");
    state.backup = { path: location.backup, hash: raw.backup.hash };
  }
  return state;
}

function validateState(raw, location) {
  if (!raw || typeof raw !== "object") throw new Error("state is not an object");
  let state;
  if (!raw.version) state = normalizeLegacyState(raw, location);
  else if (raw.version === 2 || raw.version === STATE_VERSION) state = structuredClone(raw);
  else throw new Error(`unsupported state version: ${raw.version}`);

  state.version = STATE_VERSION;
  if (state.scope !== location.scope) throw new Error("state scope does not match this command");
  assertExactPath(state.roots?.codex, location.codexHome, "Codex root");
  assertExactPath(state.roots?.skills, location.skillsHome, "skills root");
  assertExactPath(state.roots?.skillsRoot ?? dirname(state.roots?.skills || ""), location.skillsRoot, "skills parent root");
  assertExactPath(state.config?.path, location.config, "config");
  if (typeof state.config.createdFile !== "boolean" || typeof state.config.values !== "object") {
    throw new Error("invalid config state");
  }
  for (const [key, item] of Object.entries(state.config.values)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`unknown managed config key: ${key}`);
    if (item?.installed !== DEFAULTS[key]) throw new Error(`invalid installed value for ${key}`);
    if (!(item.previousRaw === null || typeof item.previousRaw === "string")) {
      throw new Error(`invalid previous value for ${key}`);
    }
  }
  state.files ||= {};
  for (const [name, item] of Object.entries(state.files)) {
    if (!Object.hasOwn(TEMPLATES, name)) throw new Error(`unknown managed file: ${name}`);
    assertExactPath(item.path, location[name], name);
    if (!/^[a-f0-9]{64}$/.test(item.hash || "")) throw new Error(`invalid hash for ${name}`);
  }
  if (state.backup) {
    assertExactPath(state.backup.path, location.backup, "backup");
    if (!/^[a-f0-9]{64}$/.test(state.backup.hash || "")) throw new Error("invalid backup hash");
  }
  if (!Array.isArray(state.createdDirs)) throw new Error("invalid createdDirs state");
  for (const directory of state.createdDirs) {
    if (!isWithin(directory, location.codexHome) && !isWithin(directory, location.skillsRoot)) {
      throw new Error(`unsafe managed directory: ${directory}`);
    }
  }
  state.packageVersion = VERSION;
  return state;
}

async function loadState(location) {
  const file = await readText(location.state);
  if (!file.exists) return { exists: false, state: freshState(location) };
  let raw;
  try {
    raw = JSON.parse(file.text);
  } catch {
    throw new Error("state file is not valid JSON");
  }
  return { exists: true, state: validateState(raw, location) };
}

function rootAssignments(scan) {
  const values = new Map();
  for (const assignment of scan.assignments) {
    if (assignment.table.length === 0 && assignment.keySegments.length === 1) {
      const key = assignment.keySegments[0];
      if (values.has(key)) throw new Error(`duplicate top-level ${key}`);
      values.set(key, assignment);
    }
  }
  return values;
}

function semanticValue(assignment) {
  return assignment?.parsedValue?.kind === "string" ? assignment.parsedValue.value : null;
}

function addMessage(plan, status, label, detail) {
  plan.messages.push({ status, label, detail });
}

function addWrite(plan, path, content, status, label) {
  plan.operations.push({ kind: "write", path, content: Buffer.from(content, "utf8") });
  addMessage(plan, status, label);
}

function addDelete(plan, path, label) {
  plan.operations.push({ kind: "delete", path });
  addMessage(plan, "remove", label);
}

function addRemoveDirectory(plan, path) {
  plan.operations.push({ kind: "rmdir", path });
  addMessage(plan, "remove-if-empty", path);
}

function failPlan(plan, message) {
  plan.failed = true;
  addMessage(plan, "fail", "operation", message);
}

function stateJson(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

async function missingDirectories(location) {
  const candidates = [
    location.codexHome,
    dirname(location.luna),
    location.skillsRoot,
    location.skillsHome,
    dirname(location.skill)
  ];
  const unique = [...new Set(candidates.map((value) => resolve(value)))].sort((a, b) => a.length - b.length);
  const missing = [];
  for (const directory of unique) {
    if (!(await directoryExists(directory))) missing.push(directory);
  }
  return missing;
}

function patchInstallConfig(original, state, setDefault) {
  const scan = scanToml(original);
  const edits = [];
  const additions = [];
  const nextValues = structuredClone(state.config.values || {});

  for (const [key, installed] of Object.entries(DEFAULTS)) {
    const assignment = scan.targets.get(key);
    const tracked = nextValues[key];
    if (assignment && assignment.parsedValue.kind !== "string") {
      throw new Error(`${key} must be a TOML string`);
    }
    const current = semanticValue(assignment);
    if (!assignment) {
      additions.push(`${key} = ${quoteToml(installed)}`);
      nextValues[key] = tracked || { installed, previousRaw: null, source: "inserted" };
      continue;
    }
    if (!setDefault) continue;
    if (current === installed) continue;
    edits.push({ start: assignment.valueStart, end: assignment.valueEnd, text: quoteToml(installed) });
    nextValues[key] = tracked || {
      installed,
      previousRaw: assignment.rawValue,
      source: "replaced"
    };
  }

  const insert = insertionEdit(original, scan, additions);
  if (insert) edits.push(insert);
  return {
    content: edits.length ? applyEdits(original, edits) : original,
    values: nextValues,
    changed: edits.length > 0
  };
}

function patchUninstallConfig(original, stateValues) {
  const scan = scanToml(original);
  const edits = [];
  const preserved = [];
  for (const [key, item] of Object.entries(stateValues || {})) {
    const assignment = scan.targets.get(key);
    if (!assignment) continue;
    if (semanticValue(assignment) !== item.installed) {
      preserved.push(key);
      continue;
    }
    if (item.previousRaw === null) edits.push(removalEdit(assignment));
    else edits.push({ start: assignment.valueStart, end: assignment.valueEnd, text: item.previousRaw });
  }
  return {
    content: edits.length ? applyEdits(original, edits) : original,
    changed: edits.length > 0,
    preserved
  };
}

async function planInstall(scope, flags) {
  const location = expectedPaths(scope);
  const plan = { command: "install", location, operations: [], messages: [], failed: false };
  let loaded;
  try {
    loaded = await loadState(location);
  } catch (error) {
    failPlan(plan, error.message);
    return plan;
  }
  const state = loaded.state;
  const config = await readText(location.config);
  const original = config.exists ? config.text : "";
  let patched;
  try {
    patched = patchInstallConfig(original, state, flags.setDefault);
  } catch (error) {
    failPlan(plan, error.message);
    return plan;
  }

  const createdDirs = await missingDirectories(location);
  plan.createdDirs = createdDirs;
  state.createdDirs = [...new Set([...(state.createdDirs || []), ...createdDirs])];
  state.config.createdFile = state.config.createdFile || (!config.exists && patched.changed);
  state.config.values = patched.values;

  if (patched.changed) {
    if (!state.backup && config.exists) {
      const backup = await readText(location.backup);
      if (backup.exists) {
        failPlan(plan, `untracked backup already exists: ${location.backup}`);
        return plan;
      }
      state.backup = { path: location.backup, hash: digest(Buffer.from(original, "utf8")) };
      addWrite(plan, location.backup, original, "create", "config backup");
    }
    addWrite(plan, location.config, patched.content, config.exists ? "update" : "create", "config.toml");
  } else {
    addMessage(
      plan,
      "preserve",
      "config.toml",
      flags.setDefault ? "already matches or contains protected values" : "existing defaults preserved"
    );
  }

  for (const name of ["luna", "sol", "skill"]) {
    const current = await readText(location[name]);
    const tracked = state.files[name];
    const template = TEMPLATES[name].content;

    if (!current.exists) {
      state.files[name] = { path: location[name], hash: digest(Buffer.from(template, "utf8")) };
      addWrite(plan, location[name], template, "create", name);
      continue;
    }

    const currentHash = digest(Buffer.from(current.text, "utf8"));
    if (tracked && currentHash === tracked.hash) {
      if (current.text === template) {
        addMessage(plan, "skip", name, "already managed");
      } else if ((LEGACY_TEMPLATES[name] || []).includes(current.text)) {
        state.files[name].hash = digest(Buffer.from(template, "utf8"));
        addWrite(plan, location[name], template, "update", `${name} migration`);
      } else {
        addMessage(plan, "preserve", name, "managed content is not a recognized package template");
      }
    } else {
      addMessage(plan, "preserve", name, tracked ? "user-modified" : "pre-existing");
    }
  }

  state.version = STATE_VERSION;
  state.packageVersion = VERSION;
  const existingState = await readText(location.state);
  addWrite(plan, location.state, stateJson(state), existingState.exists ? "update" : "create", "state");
  return plan;
}

async function planUninstall(scope) {
  const location = expectedPaths(scope);
  const plan = { command: "uninstall", location, operations: [], messages: [], failed: false };
  let loaded;
  try {
    loaded = await loadState(location);
  } catch (error) {
    failPlan(plan, error.message);
    return plan;
  }
  if (!loaded.exists) {
    addMessage(plan, "skip", "state", "not installed");
    return plan;
  }
  const state = loaded.state;
  const config = await readText(location.config);

  if (Object.keys(state.config.values || {}).length && config.exists) {
    let patched;
    try {
      patched = patchUninstallConfig(config.text, state.config.values);
    } catch (error) {
      failPlan(plan, error.message);
      return plan;
    }
    for (const key of patched.preserved) addMessage(plan, "preserve", key, "user-modified");
    if (patched.changed) {
      const empty = patched.content.replace(/^\uFEFF/, "").trim() === "";
      if (state.config.createdFile && empty) addDelete(plan, location.config, "config.toml");
      else addWrite(plan, location.config, patched.content, "update", "config.toml");
    } else if (!patched.preserved.length) {
      addMessage(plan, "skip", "config.toml", "managed values already missing");
    }
  } else if (Object.keys(state.config.values || {}).length) {
    addMessage(plan, "skip", "config.toml", "already missing");
  }
  state.config.values = {};

  for (const name of ["luna", "sol", "skill"]) {
    const tracked = state.files[name];
    if (!tracked) continue;
    const current = await readText(location[name]);
    if (!current.exists) addMessage(plan, "skip", name, "already missing");
    else if (digest(Buffer.from(current.text, "utf8")) === tracked.hash) addDelete(plan, location[name], name);
    else addMessage(plan, "preserve", name, "user-modified");
    delete state.files[name];
  }

  if (state.backup) {
    const backup = await readText(location.backup);
    if (!backup.exists) addMessage(plan, "skip", "config backup", "already missing");
    else if (digest(Buffer.from(backup.text, "utf8")) === state.backup.hash) {
      addDelete(plan, location.backup, "config backup");
    } else {
      addMessage(plan, "preserve", "config backup", "user-modified");
    }
    state.backup = null;
  }

  addDelete(plan, location.state, "state");
  for (const directory of [...state.createdDirs].sort((a, b) => b.length - a.length)) {
    addRemoveDirectory(plan, directory);
  }
  return plan;
}

function signatureFromBytes(file) {
  return file.exists
    ? { exists: true, hash: digest(file.bytes) }
    : { exists: false, hash: null };
}

async function signature(path) {
  return signatureFromBytes(await readBytes(path));
}

function sameSignature(left, right) {
  return Boolean(left?.exists) === Boolean(right?.exists) &&
    (!left?.exists || left.hash === right.hash);
}

async function inspectLock(location) {
  const lock = await readText(location.lock);
  if (!lock.exists) return { status: "none" };
  let metadata;
  try {
    metadata = JSON.parse(lock.text);
  } catch {
    return { status: "corrupt", detail: "lock file is not valid JSON" };
  }
  if (!Number.isInteger(metadata.pid) || metadata.pid <= 0 || typeof metadata.hostname !== "string") {
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
  return alive
    ? { status: "active", metadata }
    : { status: "stale", metadata };
}

async function acquireLock(location, command, output, env) {
  let createdRoot = false;
  if (!(await directoryExists(location.codexHome))) {
    await mkdir(location.codexHome, { recursive: true });
    createdRoot = true;
  }
  await validateLocationSafety(location);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    let handle;
    try {
      handle = await open(location.lock, "wx", 0o600);
      const metadata = {
        version: 1,
        token,
        pid: process.pid,
        hostname: hostname(),
        command,
        scope: location.scope,
        startedAt: new Date().toISOString()
      };
      await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      const hold = Number.parseInt(env?.[TEST_HOLD_LOCK_ENV] || "", 10);
      if (env?.[TESTING_ENV] === "1" && Number.isFinite(hold) && hold > 0) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, hold));
      }
      return { token, createdRoot, command };
    } catch (error) {
      try { await handle?.close(); } catch {}
      if (error?.code !== "EEXIST") throw error;
      const lock = await inspectLock(location);
      if (lock.status === "stale") {
        const before = await readText(location.lock);
        const again = await readText(location.lock);
        if (before.exists && again.exists && before.text === again.text) {
          await rm(location.lock, { force: true });
          output?.(`recover: stale lock (${lock.metadata.command || "unknown"} pid ${lock.metadata.pid})`);
          continue;
        }
      }
      const detail = lock.metadata
        ? `${lock.metadata.command || "operation"} pid ${lock.metadata.pid} since ${lock.metadata.startedAt || "unknown"}`
        : lock.detail || "unknown lock owner";
      throw new Error(`scope is locked by ${detail}`);
    }
  }
  throw new Error("unable to acquire scope lock");
}

async function releaseLock(location, lock) {
  if (!lock) return;
  try {
    await validateLocationSafety(location);
    const current = await readText(location.lock);
    if (!current.exists) return;
    const metadata = JSON.parse(current.text);
    if (metadata.token === lock.token) await rm(location.lock, { force: true });
  } catch {}
  if (lock.createdRoot || lock.command === "uninstall") {
    try { await rmdir(location.codexHome); } catch {}
  }
}

function operationAfterSignature(operation) {
  if (operation.kind === "write") {
    return { exists: true, hash: digest(operation.content) };
  }
  if (operation.kind === "delete") {
    return { exists: false, hash: null };
  }
  throw new Error(`unknown operation kind: ${operation.kind}`);
}

async function validateJournal(raw, location) {
  if (!raw || typeof raw !== "object" || raw.version !== 1) {
    throw new Error("unsupported transaction journal");
  }
  if (raw.scope !== location.scope || typeof raw.id !== "string" || !Array.isArray(raw.operations)) {
    throw new Error("invalid transaction journal structure");
  }
  if (!["preparing", "ready", "applying"].includes(raw.status)) {
    throw new Error("invalid transaction status");
  }
  for (let index = 0; index < raw.operations.length; index += 1) {
    const operation = raw.operations[index];
    if (!["write", "delete"].includes(operation.kind)) {
      throw new Error(`invalid transaction operation ${index}`);
    }
    if (typeof operation.path !== "string" || !isAbsolute(operation.path)) {
      throw new Error(`invalid transaction path ${index}`);
    }
    const expected = isWithin(operation.path, location.skillsRoot)
      ? location.skillsRoot
      : location.codexHome;
    if (!isWithin(operation.path, expected)) throw new Error(`unsafe transaction path: ${operation.path}`);
    if (!operation.before || typeof operation.before.exists !== "boolean") {
      throw new Error(`invalid transaction snapshot ${index}`);
    }
    if (operation.before.exists && !/^[a-f0-9]{64}$/.test(operation.before.hash || "")) {
      throw new Error(`invalid transaction hash ${index}`);
    }
    if (operation.before.exists && !operation.snapshot) {
      throw new Error(`missing transaction snapshot ${index}`);
    }
    if (operation.snapshot) {
      if (!/^[0-9]{4}\.snapshot$/.test(operation.snapshot)) {
        throw new Error(`invalid transaction snapshot name ${index}`);
      }
      const snapshotRoot = join(location.transactionData, raw.id);
      const snapshot = join(snapshotRoot, operation.snapshot);
      if (!isWithin(snapshot, snapshotRoot)) throw new Error(`unsafe transaction snapshot ${index}`);
      await assertNoIndirection(snapshot, snapshotRoot, location.codexHome, `transaction snapshot ${index}`);
      const snapshotFile = await readBytes(snapshot);
      if (!snapshotFile.exists || digest(snapshotFile.bytes) !== operation.before.hash) {
        throw new Error(`corrupt transaction snapshot ${index}`);
      }
    }
    if (!operation.after || typeof operation.after.exists !== "boolean") {
      throw new Error(`invalid transaction target ${index}`);
    }
    if (operation.after.exists && !/^[a-f0-9]{64}$/.test(operation.after.hash || "")) {
      throw new Error(`invalid transaction target hash ${index}`);
    }
  }
  return raw;
}

async function readJournal(location) {
  const file = await readText(location.journal);
  if (!file.exists) return { exists: false };
  let raw;
  try {
    raw = JSON.parse(file.text);
  } catch {
    return { exists: true, classification: "corrupt", detail: "journal is not valid JSON" };
  }
  try {
    const journal = await validateJournal(raw, location);
    return { exists: true, journal };
  } catch (error) {
    return { exists: true, classification: "corrupt", detail: error.message };
  }
}

async function classifyJournal(location) {
  const loaded = await readJournal(location);
  if (!loaded.exists || loaded.classification === "corrupt") return loaded;
  const journal = loaded.journal;
  if (journal.status === "preparing") {
    return {
      exists: true,
      classification: "unfinished",
      detail: "preparation was interrupted before managed writes",
      journal
    };
  }
  const states = [];
  for (const operation of journal.operations) {
    const current = await signature(operation.path);
    if (sameSignature(current, operation.before)) states.push("before");
    else if (sameSignature(current, operation.after)) states.push("after");
    else states.push("conflict");
  }
  const conflictIndex = states.indexOf("conflict");
  if (conflictIndex >= 0) {
    return {
      exists: true,
      classification: "conflicting",
      detail: `managed path changed after interruption: ${journal.operations[conflictIndex].path}`,
      journal,
      states
    };
  }
  return {
    exists: true,
    classification: "recoverable",
    detail: `${states.filter((state) => state === "after").length} applied operation(s) can be rolled back`,
    journal,
    states
  };
}

async function cleanupTransaction(location, journal) {
  if (journal?.id) await rm(join(location.transactionData, journal.id), { recursive: true, force: true });
  await rm(location.journal, { force: true });
  try { await rmdir(location.transactionData); } catch {}
}

async function recoverTransaction(location, output) {
  const classified = await classifyJournal(location);
  if (!classified.exists) return;
  if (classified.classification === "corrupt") {
    throw new Error(`corrupt transaction: ${classified.detail}`);
  }
  if (classified.classification === "conflicting") {
    throw new Error(`conflicting transaction: ${classified.detail}`);
  }
  const journal = classified.journal;
  if (classified.classification === "unfinished") {
    await cleanupTransaction(location, journal);
    output?.("recover: unfinished transaction (no managed writes were applied)");
    return;
  }

  for (let index = journal.operations.length - 1; index >= 0; index -= 1) {
    await validateLocationSafety(location);
    const operation = journal.operations[index];
    const current = await signature(operation.path);
    if (sameSignature(current, operation.before)) continue;
    if (!sameSignature(current, operation.after)) {
      throw new Error(`conflicting transaction during recovery: ${operation.path}`);
    }
    if (!operation.before.exists) {
      await rm(operation.path, { force: true });
      continue;
    }
    const snapshot = join(location.transactionData, journal.id, operation.snapshot);
    const bytes = await readFile(snapshot);
    if (digest(bytes) !== operation.before.hash) {
      throw new Error(`corrupt transaction snapshot: ${operation.path}`);
    }
    await atomicWriteBytes(operation.path, bytes);
  }
  await cleanupTransaction(location, journal);
  output?.("recover: interrupted transaction rolled back");
}

async function prepareJournal(plan) {
  const id = randomUUID();
  const dataRoot = join(plan.location.transactionData, id);
  const operations = [];
  const journal = {
    version: 1,
    id,
    scope: plan.location.scope,
    command: plan.command,
    createdAt: new Date().toISOString(),
    status: "preparing",
    recovery: "rollback",
    operations
  };
  await atomicWrite(plan.location.journal, `${JSON.stringify(journal, null, 2)}\n`);
  await mkdir(dataRoot, { recursive: true });

  const transactionalOperations = plan.operations.filter((operation) => operation.kind !== "rmdir");
  for (let index = 0; index < transactionalOperations.length; index += 1) {
    const operation = transactionalOperations[index];
    let before;
    let snapshot = null;
    const current = await readBytes(operation.path);
    before = signatureFromBytes(current);
    if (current.exists) {
      snapshot = `${String(index).padStart(4, "0")}.snapshot`;
      const snapshotPath = join(dataRoot, snapshot);
      await writeFile(snapshotPath, current.bytes, { mode: 0o600, flag: "wx" });
    }
    operations.push({
      kind: operation.kind,
      path: operation.path,
      label: operation.label || "",
      before,
      after: operationAfterSignature(operation),
      snapshot,
      done: false
    });
    await atomicWrite(plan.location.journal, `${JSON.stringify(journal, null, 2)}\n`);
  }
  journal.status = "ready";
  await atomicWrite(plan.location.journal, `${JSON.stringify(journal, null, 2)}\n`);
  return journal;
}

async function applyOperation(operation) {
  if (operation.kind === "write") await atomicWriteBytes(operation.path, operation.content);
  else if (operation.kind === "delete") await rm(operation.path, { force: true });
  else if (operation.kind === "rmdir") {
    try {
      await rmdir(operation.path);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
    }
  } else {
    throw new Error(`unknown operation kind: ${operation.kind}`);
  }
}

async function executePlan(plan, env) {
  if (plan.failed) return { ok: false };
  if (!plan.operations.length) return { ok: true };
  let journal;
  try {
    const transactionalOperations = plan.operations.filter((operation) => operation.kind !== "rmdir");
    const directoryOperations = plan.operations.filter((operation) => operation.kind === "rmdir");
    if (transactionalOperations.length) {
      journal = await prepareJournal(plan);
      journal.status = "applying";
      await atomicWrite(plan.location.journal, `${JSON.stringify(journal, null, 2)}\n`);
      for (let index = 0; index < transactionalOperations.length; index += 1) {
        await validateLocationSafety(plan.location);
        await applyOperation(transactionalOperations[index]);
        journal.operations[index].done = true;
        await atomicWrite(plan.location.journal, `${JSON.stringify(journal, null, 2)}\n`);
        const crashAfter = Number.parseInt(env?.[TEST_CRASH_ENV] || "", 10);
        if (env?.[TESTING_ENV] === "1" && crashAfter === index + 1) process.exit(91);
      }
      await cleanupTransaction(plan.location, journal);
    }
    for (const operation of directoryOperations) {
      await validateLocationSafety(plan.location);
      await applyOperation(operation);
    }
    return { ok: true };
  } catch (error) {
    try {
      await recoverTransaction(plan.location);
    } catch (recoveryError) {
      return { ok: false, error: new Error(`${error.message}; recovery failed: ${recoveryError.message}`) };
    }
    return { ok: false, error };
  }
}

function formatMessage(message, dryRun) {
  const preview = dryRun && ["create", "update", "remove", "remove-if-empty"].includes(message.status)
    ? `would-${message.status}`
    : message.status;
  return `${preview}: ${message.label}${message.detail ? ` (${message.detail})` : ""}`;
}

function printPlan(plan, output, dryRun) {
  for (const message of plan.messages) output?.(formatMessage(message, dryRun));
}

function getAgentValues(content) {
  return rootAssignments(scanToml(content));
}

function getString(assignments, key) {
  const assignment = assignments.get(key);
  return assignment?.parsedValue?.kind === "string" ? assignment.parsedValue.value : null;
}

function validateSkill(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return "invalid front matter";
  const front = match[1];
  const body = match[2];
  if (!/^name:\s*model-router\s*$/m.test(front)) return "incorrect skill name";
  if (!/^description:\s*\S.+$/m.test(front)) return "missing skill description";
  const requirements = [/Terra/i, /Luna/i, /Sol/i, /workspace-write/i, /simple question/i, /minimum number|fewest/i];
  if (requirements.some((pattern) => !pattern.test(body))) return "missing required routing rule";
  return null;
}

function doctorStatus(messages, status, label, detail) {
  messages.push({ status, label, detail });
  return status === "healthy";
}

async function doctor(scope) {
  const location = expectedPaths(scope);
  const messages = [];
  let healthy = true;
  try {
    await validateLocationSafety(location);
  } catch (error) {
    doctorStatus(messages, "unsafe-state", "path", error.message);
    return { healthy: false, messages };
  }

  const lock = await inspectLock(location);
  if (lock.status === "active") {
    healthy = doctorStatus(
      messages,
      "locked",
      "scope",
      `${lock.metadata.command || "operation"} pid ${lock.metadata.pid}`
    ) && healthy;
  } else if (lock.status === "stale") {
    healthy = doctorStatus(messages, "stale-lock", "scope", `pid ${lock.metadata.pid}`) && healthy;
  } else if (lock.status === "corrupt") {
    healthy = doctorStatus(messages, "unsafe-state", "lock", lock.detail) && healthy;
  }

  const transaction = await classifyJournal(location);
  if (transaction.exists) {
    const mapping = {
      unfinished: "unfinished",
      recoverable: "recoverable",
      conflicting: "conflicting",
      corrupt: "corrupt"
    };
    healthy = doctorStatus(
      messages,
      mapping[transaction.classification] || "invalid",
      "transaction",
      transaction.detail
    ) && healthy;
  }

  let loaded;
  try {
    loaded = await loadState(location);
  } catch (error) {
    doctorStatus(messages, "unsafe-state", "state", error.message);
    return { healthy: false, messages };
  }
  if (!loaded.exists) {
    doctorStatus(messages, "missing", "state", "run install");
    return { healthy: false, messages };
  }
  const state = loaded.state;
  doctorStatus(messages, "healthy", "state", `schema v${state.version}`);

  const config = await readText(location.config);
  if (!config.exists) {
    healthy = doctorStatus(messages, "missing", "config.toml") && healthy;
  } else {
    try {
      const scan = scanToml(config.text);
      for (const [key, expected] of Object.entries(DEFAULTS)) {
        const assignment = scan.targets.get(key);
        if (!assignment) healthy = doctorStatus(messages, "missing", key) && healthy;
        else if (assignment.parsedValue.kind !== "string") {
          healthy = doctorStatus(messages, "invalid", key, "must be a TOML string") && healthy;
        } else if (assignment.parsedValue.value !== expected) {
          const status = state.config.values[key] ? "user-modified" : "user-override";
          healthy = doctorStatus(messages, status, key, assignment.parsedValue.value ?? assignment.rawValue) && healthy;
        } else {
          doctorStatus(messages, "healthy", key, expected);
        }
      }
    } catch (error) {
      healthy = doctorStatus(messages, "invalid", "config.toml", error.message) && healthy;
    }
  }

  for (const name of ["luna", "sol"]) {
    const current = await readText(location[name]);
    if (!current.exists) {
      healthy = doctorStatus(messages, "missing", name) && healthy;
      continue;
    }
    try {
      const values = getAgentValues(current.text);
      const invalid = Object.entries(AGENT_EXPECTATIONS[name])
        .find(([key, value]) => getString(values, key) !== value);
      if (state.files[name] && digest(Buffer.from(current.text, "utf8")) !== state.files[name].hash) {
        const detail = invalid ? `${invalid[0]} is no longer ${invalid[1]}` : "managed file hash changed";
        healthy = doctorStatus(messages, "user-modified", name, detail) && healthy;
      } else if (invalid) {
        healthy = doctorStatus(messages, "invalid", name, `${invalid[0]} must be ${invalid[1]}`) && healthy;
      } else {
        doctorStatus(messages, "healthy", name);
      }
    } catch (error) {
      healthy = doctorStatus(messages, "invalid", name, error.message) && healthy;
    }
  }

  const skill = await readText(location.skill);
  if (!skill.exists) {
    healthy = doctorStatus(messages, "missing", "skill") && healthy;
  } else {
    const invalid = validateSkill(skill.text);
    if (state.files.skill && digest(Buffer.from(skill.text, "utf8")) !== state.files.skill.hash) {
      healthy = doctorStatus(messages, "user-modified", "skill", invalid || "managed file hash changed") && healthy;
    } else if (invalid) {
      healthy = doctorStatus(messages, "invalid", "skill", invalid) && healthy;
    } else {
      doctorStatus(messages, "healthy", "skill");
    }
  }

  if (state.backup) {
    const backup = await readText(location.backup);
    if (!backup.exists) healthy = doctorStatus(messages, "missing", "config backup") && healthy;
    else if (digest(Buffer.from(backup.text, "utf8")) !== state.backup.hash) {
      healthy = doctorStatus(messages, "user-modified", "config backup") && healthy;
    } else {
      doctorStatus(messages, "healthy", "config backup");
    }
  }
  return { healthy, messages };
}

function usage() {
  return `codex-model-router ${VERSION}

Usage:
  codex-model-router install [--global] [--set-default] [--dry-run]
  codex-model-router uninstall [--global] [--dry-run]
  codex-model-router doctor [--global]
  codex-model-router --version`;
}

function parseArgs(argv) {
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) return { version: true };
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return { help: true };
  const [command, ...rawFlags] = argv;
  if (!["install", "uninstall", "doctor"].includes(command)) return { error: "unknown command" };
  const flags = { global: false, dryRun: false, setDefault: false };
  for (const flag of rawFlags) {
    if (flag === "--global") flags.global = true;
    else if (flag === "--dry-run" && command !== "doctor") flags.dryRun = true;
    else if (flag === "--set-default" && command === "install") flags.setDefault = true;
    else return { error: `unsupported option for ${command}: ${flag}` };
  }
  return { command, flags };
}

async function reportNonMutatingBlockers(location, output) {
  const lock = await inspectLock(location);
  if (lock.status !== "none") {
    const detail = lock.metadata
      ? `${lock.metadata.command || "operation"} pid ${lock.metadata.pid}`
      : lock.detail;
    const status = lock.status === "stale"
      ? "stale-lock"
      : lock.status === "corrupt" ? "unsafe-state" : "locked";
    output(`${status}: scope (${detail})`);
    return false;
  }
  const transaction = await classifyJournal(location);
  if (transaction.exists) {
    output(`${transaction.classification}: transaction (${transaction.detail})`);
    return false;
  }
  return true;
}

export async function run(argv, options = {}) {
  const output = options.output ?? console.log;
  const parsed = parseArgs(argv);
  if (parsed.version) {
    output(VERSION);
    return 0;
  }
  if (parsed.help) {
    output(usage());
    return 0;
  }
  if (parsed.error) {
    output(`${parsed.error}\n\n${usage()}`);
    return 1;
  }

  const scope = {
    cwd: options.cwd ?? process.cwd(),
    home: options.home,
    env: options.env ?? process.env,
    global: parsed.flags.global
  };
  const location = expectedPaths(scope);

  try {
    await validateLocationSafety(location);
    if (parsed.command === "doctor") {
      const result = await doctor(scope);
      for (const message of result.messages) output(formatMessage(message, false));
      return result.healthy ? 0 : 1;
    }

    if (parsed.flags.dryRun) {
      if (!(await reportNonMutatingBlockers(location, output))) return 1;
      const plan = parsed.command === "install"
        ? await planInstall(scope, parsed.flags)
        : await planUninstall(scope);
      printPlan(plan, output, true);
      return plan.failed ? 1 : 0;
    }

    let lock;
    try {
      lock = await acquireLock(location, parsed.command, output, scope.env);
      await validateLocationSafety(location);
      await recoverTransaction(location, output);
      const plan = parsed.command === "install"
        ? await planInstall(scope, parsed.flags)
        : await planUninstall(scope);
      printPlan(plan, output, false);
      if (plan.failed) return 1;
      const result = await executePlan(plan, scope.env);
      if (!result.ok) {
        output(`fail: execution (${result.error?.message || "unknown error"})`);
        return 1;
      }
      return 0;
    } finally {
      await releaseLock(location, lock);
    }
  } catch (error) {
    output(`fail: ${error.message}`);
    return 1;
  }
}
