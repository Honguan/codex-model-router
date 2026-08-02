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
  AGENT_NAMES,
  DEFAULTS,
  LEGACY_TEMPLATES,
  MANAGED_FILE_NAMES,
  SKILL_EXPECTATIONS,
  TEMPLATES,
  VERSION
} from "./manifest.js";

export { VERSION };

const STATE_VERSION = 5;
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

async function canonicalizeRoot(path) {
  const absolute = resolve(path);
  const ancestor = await nearestExistingAncestor(absolute);
  const physicalAncestor = await realpath(ancestor);
  return resolve(physicalAncestor, relative(ancestor, absolute));
}

async function canonicalizeScope(scope) {
  return {
    ...scope,
    cwd: await canonicalizeRoot(scope.cwd),
    home: await canonicalizeRoot(scope.home ?? homedir())
  };
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
  const physicalAnchor = await realpath(absoluteAnchor);
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
    const expectedPhysical = resolve(physicalAnchor, relative(absoluteAnchor, candidate));
    if (normalizeForCompare(physical) !== normalizeForCompare(expectedPhysical)) {
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
  const skillsHome = join(codexHome, "skills");
  const skillsRoot = dirname(skillsHome);
  const legacySkillsRoot = global ? join(userHome, ".agents") : join(projectRoot, ".agents");
  const legacySkillsHome = join(legacySkillsRoot, "skills");
  return {
    scope: global ? "global" : "project",
    projectRoot,
    userHome,
    codexHome,
    skillsHome,
    skillsRoot,
    legacySkillsRoot,
    legacySkillsHome,
    config: join(codexHome, "config.toml"),
    state: join(codexHome, "model-router-state.json"),
    backup: join(codexHome, "config.toml.codex-model-router.bak"),
    terra: join(codexHome, ...TEMPLATES.terra.relative),
    luna: join(codexHome, ...TEMPLATES.luna.relative),
    sol: join(codexHome, ...TEMPLATES.sol.relative),
    skill: join(skillsHome, ...TEMPLATES.skill.relative),
    planning: join(skillsHome, ...TEMPLATES.planning.relative),
    legacySkill: join(legacySkillsHome, ...TEMPLATES.skill.relative),
    legacyPlanning: join(legacySkillsHome, ...TEMPLATES.planning.relative),
    lock: join(codexHome, LOCK_FILE),
    journal: join(codexHome, JOURNAL_FILE),
    transactionData: join(codexHome, TRANSACTION_DIR)
  };
}

async function safetyAnchors(location) {
  const codexAnchor = location.scope === "project"
    ? location.projectRoot
    : await nearestExistingAncestor(location.codexHome);
  const skillsAnchor = codexAnchor;
  return { codexAnchor, skillsAnchor };
}

async function validateLocationSafety(location) {
  const { codexAnchor, skillsAnchor } = await safetyAnchors(location);
  const codexTargets = [
    location.codexHome,
    location.config,
    location.state,
    location.backup,
    location.terra,
    location.luna,
    location.sol,
    location.lock,
    location.journal,
    location.transactionData
  ];
  for (const target of codexTargets) {
    await assertNoIndirection(target, location.codexHome, codexAnchor, target);
  }
  const skillsTargets = [location.skillsRoot, location.skillsHome, location.skill, location.planning];
  for (const target of skillsTargets) {
    await assertNoIndirection(target, location.skillsRoot, skillsAnchor, target);
  }
}

function assertExactPath(actual, expected, label) {
  if (normalizeForCompare(actual) !== normalizeForCompare(expected)) {
    throw new Error(`unsafe state path for ${label}`);
  }
}

async function validateOperationPath(location, target) {
  if (isWithin(target, location.codexHome)) {
    await assertNoIndirection(target, location.codexHome, location.scope === "project" ? location.projectRoot : await nearestExistingAncestor(location.codexHome), target);
    return;
  }
  if (isWithin(target, location.legacySkillsRoot)) {
    const anchor = location.scope === "project" ? location.projectRoot : location.userHome;
    await assertNoIndirection(target, location.legacySkillsRoot, anchor, target);
    return;
  }
  throw new Error(`unsafe operation path: ${target}`);
}

function exactPath(actual, expected) {
  return typeof actual === "string" && normalizeForCompare(actual) === normalizeForCompare(expected);
}

function usesLegacySkillPaths(raw, location) {
  return exactPath(raw?.roots?.skills, location.legacySkillsHome) ||
    exactPath(raw?.roots?.skillsRoot, location.legacySkillsRoot) ||
    exactPath(raw?.files?.skill?.path, location.legacySkill) ||
    exactPath(raw?.files?.planning?.path, location.legacyPlanning);
}

function withLegacySkillPaths(location) {
  return {
    ...location,
    skillsHome: location.legacySkillsHome,
    skillsRoot: location.legacySkillsRoot,
    skill: location.legacySkill,
    planning: location.legacyPlanning
  };
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
  for (const name of MANAGED_FILE_NAMES) {
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
  const legacySkills = usesLegacySkillPaths(raw, location);
  const stateLocation = legacySkills ? withLegacySkillPaths(location) : location;
  let state;
  if (!raw.version) state = normalizeLegacyState(raw, stateLocation);
  else if ([2, 3, 4, STATE_VERSION].includes(raw.version)) state = structuredClone(raw);
  else throw new Error(`unsupported state version: ${raw.version}`);

  state.version = STATE_VERSION;
  if (state.scope !== stateLocation.scope) throw new Error("state scope does not match this command");
  assertExactPath(state.roots?.codex, stateLocation.codexHome, "Codex root");
  assertExactPath(state.roots?.skills, stateLocation.skillsHome, "skills root");
  assertExactPath(state.roots?.skillsRoot ?? dirname(state.roots?.skills || ""), stateLocation.skillsRoot, "skills parent root");
  assertExactPath(state.config?.path, stateLocation.config, "config");
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
    assertExactPath(item.path, stateLocation[name], name);
    if (!/^[a-f0-9]{64}$/.test(item.hash || "")) throw new Error(`invalid hash for ${name}`);
  }
  if (state.backup) {
    assertExactPath(state.backup.path, stateLocation.backup, "backup");
    if (!/^[a-f0-9]{64}$/.test(state.backup.hash || "")) throw new Error("invalid backup hash");
  }
  if (!Array.isArray(state.createdDirs)) throw new Error("invalid createdDirs state");
  for (const directory of state.createdDirs) {
    if (!isWithin(directory, stateLocation.codexHome) && !isWithin(directory, stateLocation.skillsRoot)) {
      throw new Error(`unsafe managed directory: ${directory}`);
    }
  }
  if (legacySkills) {
    state.roots.skills = location.skillsHome;
    state.roots.skillsRoot = location.skillsRoot;
    for (const name of ["skill", "planning"]) {
      if (state.files[name]) state.files[name].path = location[name];
    }
  }
  state.packageVersion = VERSION;
  return { state, legacySkills };
}

async function loadState(location) {
  const file = await readText(location.state);
  if (!file.exists) return { exists: false, state: freshState(location), legacySkills: false };
  let raw;
  try {
    raw = JSON.parse(file.text);
  } catch {
    throw new Error("state file is not valid JSON");
  }
  return { exists: true, ...validateState(raw, location) };
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

function adï|¶‰žËkºwµç[ÜŠÛÛ™›XÝ[™È˜[œØXÝ[Ûˆ\š[™È™XÛÝ™\žNˆ	ÛÜ\˜][Û‹œ]X
NÃBˆCBˆYˆ
[Ü\˜][Û‹˜™Y›Ü™K™^\ÝÊHÃBˆ]ØZ]›JÜ\˜][Û‹œ]È›Ü˜ÙNˆYHJNÃBˆÛÛ[YNÃBˆCBˆÛÛœÝÛ˜\ÚÝH›Ú[ŠØØ][Û‹˜[œØXÝ[Û‘]K›Ý\›˜[šYÜ\˜][Û‹œÛ˜\ÚÝ
NÃBˆÛÛœÝž]\ÈH]ØZ]™XYš[JÛ˜\ÚÝ
NÃBˆYˆ
YÙ\Ý
ž]\ÊHOOHÜ\˜][Û‹˜™Y›Ü™Kš\Ú
HÃBˆ›ÝÈ™]È\œ›ÜŠÛÜœ\˜[œØXÝ[ÛˆÛ˜\ÚÝˆ	ÛÜ\˜][Û‹œ]X
NÃBˆCBˆ]ØZ]]ÛZXÕÜš]Pž]\ÊÜ\˜][Û‹œ]ž]\ÊNÃBˆCBˆ]ØZ]ÛX[\˜[œØXÝ[ÛŠØØ][Û‹›Ý\›˜[
NÃBˆÝ]]ËŠœ™XÛÝ™\Žˆ[\œ\Y˜[œØXÝ[Ûˆ›ÛY˜XÚÈŠNÃBŸCBƒB˜\Þ[˜È[˜Ý[Ûˆ™\\™R›Ý\›˜[
[ŠHÃBˆÛÛœÝYH˜[™ÛUURQ

NÃBˆÛÛœÝ]T›ÛÝH›Ú[Š[‹›ØØ][Û‹˜[œØXÝ[Û‘]KY
NÃBˆÛÛœÝÜ\˜][ÛœÈH×NÃBˆÛÛœÝ›Ý\›˜[HÃBˆ™\œÚ[ÛŽˆKBˆYBˆØÛÜNˆ[‹›ØØ][Û‹œØÛÜKBˆÛÛ[X[™ˆ[‹˜ÛÛ[X[™BˆÜ™X]Y]ˆ™]È]J
KÒTÓÔÝš[™Ê
KBˆÝ]\Îˆœ™\\š[™È‹Bˆ™XÛÝ™\žNˆœ›Û˜XÚÈ‹BˆÜ\˜][ÛœÃBˆNÃBˆ]ØZ]]ÛZXÕÜš]J[‹›ØØ][Û‹š›Ý\›˜[	Ò”ÓÓ‹œÝš[™ÚYžJ›Ý\›˜[[Š_W˜
NÃBˆ]ØZ]ZÙ\Š]T›ÛÝÈ™XÝ\œÚ]™NˆYHJNÃBƒBˆÛÛœÝ˜[œØXÝ[Û˜[Ü\˜][ÛœÈH[‹›Ü\˜][ÛœË™š[\Š
Ü\˜][ÛŠHOˆÜ\˜][Û‹šÚ[™OOHœ›Y\ˆŠNÂˆ›Üˆ
][™^HÈ[™^˜[œØXÝ[Û˜[Ü\˜][ÛœË›[™ÝÈ[™^
ÏHJHÂˆÛÛœÝÜ\˜][ÛˆH˜[œØXÝ[Û˜[Ü\˜][ÛœÖÚ[™^NÂˆ]ØZ]˜[Y]SÜ\˜][Û”]
[‹›ØØ][Û‹Ü\˜][Û‹œ]
NÂˆ]™Y›Ü™NÃBˆ]Û˜\ÚÝH[ÃBˆÛÛœÝÝ\œ™[H]ØZ]™XYž]\ÊÜ\˜][Û‹œ]
NÃBˆ™Y›Ü™HHÚYÛ˜]\™Qœ›ÛPž]\ÊÝ\œ™[
NÃBˆYˆ
Ý\œ™[™^\ÝÊHÃBˆÛ˜\ÚÝH	ÔÝš[™Ê[™^
KœYÝ\
ŒŠ_KœÛ˜\ÚÝÃBˆÛÛœÝÛ˜\ÚÝ]H›Ú[Š]T›ÛÝÛ˜\ÚÝ
NÃBˆ]ØZ]Üš]Qš[JÛ˜\ÚÝ]Ý\œ™[˜ž]\ËÈ[ÙNˆÍŒ›YÎˆÞˆJNÃBˆCBˆÜ\˜][ÛœËœ\Ú
ÃBˆÚ[™ˆÜ\˜][Û‹šÚ[™Bˆ]ˆÜ\˜][Û‹œ]BˆX™[ˆÜ\˜][Û‹›X™[ˆ‹Bˆ™Y›Ü™KBˆY\ŽˆÜ\˜][ÛY\”ÚYÛ˜]\™JÜ\˜][ÛŠKBˆÛ˜\ÚÝBˆÛ™Nˆ˜[ÙCBˆJNÃBˆ]ØZ]]ÛZXÕÜš]J[‹›ØØ][Û‹š›Ý\›˜[	Ò”ÓÓ‹œÝš[™ÚYžJ›Ý\›˜[[Š_W˜
NÃBˆCBˆ›Ý\›˜[œÝ]\ÈHœ™XYHŽÃBˆ]ØZ]]ÛZXÕÜš]J[‹›ØØ][Û‹š›Ý\›˜[	Ò”ÓÓ‹œÝš[™ÚYžJ›Ý\›˜[[Š_W˜
NÃBˆ™]\›ˆ›Ý\›˜[ÃBŸCBƒB˜\Þ[˜È[˜Ý[Ûˆ\SÜ\˜][ÛŠÜ\˜][ÛŠHÃBˆYˆ
Ü\˜][Û‹šÚ[™OOHÜš]HŠH]ØZ]]ÛZXÕÜš]Pž]\ÊÜ\˜][Û‹œ]Ü\˜][Û‹˜ÛÛ[
NÃBˆ[ÙHYˆ
Ü\˜][Û‹šÚ[™OOH™[]HŠH]ØZ]›JÜ\˜][Û‹œ]È›Ü˜ÙNˆYHJNÃBˆ[ÙHYˆ
Ü\˜][Û‹šÚ[™OOHœ›Y\ˆŠHÃBˆžHÃBˆ]ØZ]›Y\ŠÜ\˜][Û‹œ]
NÃBˆHØ]Ú
\œ›ÜŠHÃBˆYˆ
VÈ‘S“ÑS•‹‘S“ÕSTH‹‘QVTÕ—Kš[˜ÛY\Ê\œ›ÜË˜ÛÙJJH›ÝÈ\œ›ÜŽÃBˆCBˆH[ÙHÃBˆ›ÝÈ™]È\œ›ÜŠ[šÛ›ÝÛˆÜ\˜][ÛˆÚ[™ˆ	ÛÜ\˜][Û‹šÚ[™X
NÃBˆCBŸCBƒB˜\Þ[˜È[˜Ý[Ûˆ^XÝ]T[Š[‹[ŠHÃBˆYˆ
[‹™˜Z[Y
H™]\›ˆÈÚÎˆ˜[ÙHNÃBˆYˆ
\[‹›Ü\˜][ÛœË›[™Ý
H™]\›ˆÈÚÎˆYHNÃBˆ]›Ý\›˜[ÃBˆžHÃBˆÛÛœÝ˜[œØXÝ[Û˜[Ü\˜][ÛœÈH[‹›Ü\˜][ÛœË™š[\Š
Ü\˜][ÛŠHOˆÜ\˜][Û‹šÚ[™OOHœ›Y\ˆŠNÃBˆÛÛœÝ\™XÝÜžSÜ\˜][ÛœÈH[‹›Ü\˜][ÛœË™š[\Š
Ü\˜][ÛŠHOˆÜ\˜][Û‹šÚ[™OOHœ›Y\ˆŠNÃBˆYˆ
˜[œØXÝ[Û˜[Ü\˜][ÛœË›[™Ý
HÃBˆ›Ý\›˜[H]ØZ]™\\™R›Ý\›˜[
[ŠNÃBˆ›Ý\›˜[œÝ]\ÈH˜\Z[™ÈŽÃBˆ]ØZ]]ÛZXÕÜš]J[‹›ØØ][Û‹š›Ý\›˜[	Ò”ÓÓ‹œÝš[™ÚYžJ›Ý\›˜[[Š_W˜
NÃBˆ›Üˆ
][™^HÈ[™^˜[œØXÝ[Û˜[Ü\˜][ÛœË›[™ÝÈ[™^
ÏHJHÂˆ]ØZ]˜[Y]SØØ][Û”ØY™]J[‹›ØØ][ÛŠNÂˆ]ØZ]˜[Y]SÜ\˜][Û”]
[‹›ØØ][Û‹˜[œØXÝ[Û˜[Ü\˜][ÛœÖÚ[™^Kœ]
NÂˆ]ØZ]\SÜ\˜][ÛŠ˜[œØXÝ[Û˜[Ü\˜][ÛœÖÚ[™^JNÂˆ›Ý\›˜[›Ü\˜][ÛœÖÚ[™^K™Û™HHYNÃBˆ]ØZ]]ÛZXÕÜš]J[‹›ØØ][Û‹š›Ý\›˜[	Ò”ÓÓ‹œÝš[™ÚYžJ›Ý\›˜[[Š_W˜
NÃBˆÛÛœÝÜ˜\ÚY\ˆH[X™\‹œ\œÙR[
[Ë–ÕTÕÐÔTÒÑS•—Hˆ‹L
NÃBˆYˆ
[Ë–ÕTÕS‘×ÑS•—HOOHŒHˆ	‰ˆÜ˜\ÚY\ˆOOH[™^
ÈJH›ØÙ\ÜË™^]
LJNÃBˆCBˆ]ØZ]ÛX[\˜[œØXÝ[ÛŠ[‹›ØØ][Û‹›Ý\›˜[
NÃBˆCBˆ›Üˆ
ÛÛœÝÜ\˜][ÛˆÙˆ\™XÝÜžSÜ\˜][ÛœÊHÂˆ]ØZ]˜[Y]SØØ][Û”ØY™]J[‹›ØØ][ÛŠNÂˆ]ØZ]˜[Y]SÜ\˜][Û”]
[‹›ØØ][Û‹Ü\˜][Û‹œ]
NÂˆ]ØZ]\SÜ\˜][ÛŠÜ\˜][ÛŠNÂˆCBˆ™]\›ˆÈÚÎˆYHNÃBˆHØ]Ú
\œ›ÜŠHÃBˆžHÃBˆ]ØZ]™XÛÝ™\•˜[œØXÝ[ÛŠ[‹›ØØ][ÛŠNÃBˆHØ]Ú
™XÛÝ™\žQ\œ›ÜŠHÃBˆ™]\›ˆÈÚÎˆ˜[ÙK\œ›ÜŽˆ™]È\œ›ÜŠ	Ù\œ›Ü‹›Y\ÜØYÙ_NÈ™XÛÝ™\žH˜Z[Yˆ	Ü™XÛÝ™\žQ\œ›Ü‹›Y\ÜØYÙ_X
HNÃBˆCBˆ™]\›ˆÈÚÎˆ˜[ÙK\œ›ÜˆNÃBˆCBŸCBƒB™[˜Ý[Ûˆ›Ü›X]Y\ÜØYÙJY\ÜØYÙKžT[ŠHÃBˆÛÛœÝ™]šY]ÈHžT[ˆ	‰ˆÈ˜Ü™X]H‹\]H‹œ™[[Ý™H‹œ™[[Ý™KZY‹Y[\H—Kš[˜ÛY\ÊY\ÜØYÙKœÝ]\ÊCBˆÈÛÝ[IÛY\ÜØYÙKœÝ]\ßXBˆˆY\ÜØYÙKœÝ]\ÎÃBˆ™]\›ˆ	Ü™]šY]ßNˆ	ÛY\ÜØYÙK›X™[IÛY\ÜØYÙK™]Z[È
	ÛY\ÜØYÙK™]Z[JXˆˆŸXÃBŸCBƒB™[˜Ý[Ûˆš[[Š[‹Ý]]žT[ŠHÃBˆ›Üˆ
ÛÛœÝY\ÜØYÙHÙˆ[‹›Y\ÜØYÙ\ÊHÝ]]ËŠ›Ü›X]Y\ÜØYÙJY\ÜØYÙKžT[ŠJNÃBŸCBƒB™[˜Ý[ÛˆÙ]YÙ[˜[Y\ÊÛÛ[
HÃBˆ™]\›ˆ›ÛÝ\ÜÚYÛ›Y[ÊØØ[•Û[
ÛÛ[
JNÃBŸCBƒB™[˜Ý[ÛˆÙ]Ýš[™Ê\ÜÚYÛ›Y[ËÙ^JHÃBˆÛÛœÝ\ÜÚYÛ›Y[H\ÜÚYÛ›Y[Ë™Ù]
Ù^JNÃBˆ™]\›ˆ\ÜÚYÛ›Y[Ëœ\œÙY˜[YOËšÚ[™OOHœÝš[™ÈˆÈ\ÜÚYÛ›Y[œ\œÙY˜[YK˜[YHˆ[ÃBŸCBƒB™[˜Ý[Ûˆ˜[Y]TÚÚ[
ÛÛ[^XÝ][ÛŠHÃBˆÛÛœÝX]ÚHÛÛ[›X]Ú
×‹KKW×Š×××JÊW×‹KKW×Š×××JŠIÊNÃBˆYˆ
[X]Ú
H™]\›ˆš[˜[Yœ›ÛX]\ˆŽÃBˆÛÛœÝœ›ÛHX]ÚÌWNÃBˆÛÛœÝ›ÙHHX]ÚÌ—NÃBˆYˆ
Yœ›ÛœÜ]
××‹ÊKœÛÛYJ
[™JHOˆ[™Kš[J
HOOH˜[YNˆ	Ù^XÝ][Û‹›˜[Y_X
JH™]\›ˆš[˜ÛÜœ™XÝÚÚ[˜[YHŽÃBˆYˆ
K×™\ØÜš\[ÛŽ—Ê—ËŠÉÛK\Ý
œ›Û
JH™]\›ˆ›Z\ÜÚ[™ÈÚÚ[\ØÜš\[ÛˆŽÃBˆÛÛœÝZ\ÜÚ[™ÈH^XÝ][Û‹œ™\]Z\™Y™š[™

\›JHOˆX›ÙKÓÝÙ\Ø\ÙJ
Kš[˜ÛY\Ê\›KÓÝÙ\Ø\ÙJ
JJNÃBˆ™]\›ˆZ\ÜÚ[™ÈÈZ\ÜÚ[™È™\]Z\™Y[Nˆ	ÛZ\ÜÚ[™ßXˆ[ÃBŸCBƒB™[˜Ý[ÛˆØÝÜ”Ý]\ÊY\ÜØYÙ\ËÝ]\ËX™[]Z[
HÃBˆY\ÜØYÙ\Ëœ\Ú
ÈÝ]\ËX™[]Z[JNÃBˆ™]\›ˆÝ]\ÈOOHšX[HŽÃBŸCBƒB˜\Þ[˜È[˜Ý[ÛˆØÝÜŠØÛÜJHÃBˆÛÛœÝØØ][ÛˆH^XÝY]ÊØÛÜJNÃBˆÛÛœÝY\ÜØYÙ\ÈH×NÃBˆ]X[HHYNÃBˆžHÃBˆ]ØZ]˜[Y]SØØ][Û”ØY™]JØØ][ÛŠNÃBˆHØ]Ú
\œ›ÜŠHÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\Ë[œØY™K\Ý]H‹œ]‹\œ›Ü‹›Y\ÜØYÙJNÃBˆ™]\›ˆÈX[Nˆ˜[ÙKY\ÜØYÙ\ÈNÃBˆCBƒBˆÛÛœÝØÚÈH]ØZ][œÜXÝØÚÊØØ][ÛŠNÃBˆYˆ
ØÚËœÝ]\ÈOOH˜XÝ]™HŠHÃBˆX[HHØÝÜ”Ý]\ÊBˆY\ÜØYÙ\ËBˆ›ØÚÙY‹BˆœØÛÜH‹Bˆ	ÛØÚË›Y]Y]K˜ÛÛ[X[™›Ü\˜][ÛˆŸHY	ÛØÚË›Y]Y]KœYXBˆ
H	‰ˆX[NÃBˆH[ÙHYˆ
ØÚËœÝ]\ÈOOHœÝ[HŠHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\ËœÝ[K[ØÚÈ‹œØÛÜH‹Y	ÛØÚË›Y]Y]KœYX
H	‰ˆX[NÃBˆH[ÙHYˆ
ØÚËœÝ]\ÈOOH˜ÛÜœ\ŠHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë[œØY™K\Ý]H‹›ØÚÈ‹ØÚË™]Z[
H	‰ˆX[NÃBˆCBƒBˆÛÛœÝ˜[œØXÝ[ÛˆH]ØZ]Û\ÜÚYžR›Ý\›˜[
ØØ][ÛŠNÃBˆYˆ
˜[œØXÝ[Û‹™^\ÝÊHÃBˆÛÛœÝX\[™ÈHÃBˆ[™š[š\ÚYˆ[™š[š\ÚY‹Bˆ™XÛÝ™\˜X›Nˆœ™XÛÝ™\˜X›H‹BˆÛÛ™›XÝ[™Îˆ˜ÛÛ™›XÝ[™È‹BˆÛÜœ\ˆ˜ÛÜœ\ƒBˆNÃBˆX[HHØÝÜ”Ý]\ÊBˆY\ÜØYÙ\ËBˆX\[™ÖÝ˜[œØXÝ[Û‹˜Û\ÜÚYšXØ][Û—Hš[˜[Y‹Bˆ˜[œØXÝ[Ûˆ‹Bˆ˜[œØXÝ[Û‹™]Z[Bˆ
H	‰ˆX[NÃBˆCBƒBˆ]ØYYÃBˆžHÃBˆØYYH]ØZ]ØYÝ]JØØ][ÛŠNÃBˆHØ]Ú
\œ›ÜŠHÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\Ë[œØY™K\Ý]H‹œÝ]H‹\œ›Ü‹›Y\ÜØYÙJNÃBˆ™]\›ˆÈX[Nˆ˜[ÙKY\ÜØYÙ\ÈNÃBˆCBˆYˆ
[ØYY™^\ÝÊHÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\Ë›Z\ÜÚ[™È‹œÝ]H‹œ[ˆ[œÝ[ŠNÃBˆ™]\›ˆÈX[Nˆ˜[ÙKY\ÜØYÙ\ÈNÃBˆCBˆÛÛœÝÝ]HHØYYœÝ]NÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\ËšX[H‹œÝ]H‹ØÚ[XH‰ÜÝ]K™\œÚ[ÛŸX
NÃBƒBˆÛÛœÝÛÛ™šYÈH]ØZ]™XY^
ØØ][Û‹˜ÛÛ™šYÊNÃBˆÛÛœÝX[˜YÙYÛÛ™šYÒÙ^\ÈHØš™XÝšÙ^\ÊÝ]K˜ÛÛ™šYË˜[Y\ÈßJNÃBˆYˆ
[X[˜YÙYÛÛ™šYÒÙ^\Ë›[™Ý
HÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\ËšX[H‹˜ÛÛ™šYËÛ[‹ÛÛ™šYË™^\ÝÈÈœš[X\žH[Ù[™\Ù\™Yˆˆ™œ™YH[ÙHŠNÃBˆH[ÙHYˆ
XÛÛ™šYË™^\ÝÊHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë›Z\ÜÚ[™È‹˜ÛÛ™šYËÛ[ŠH	‰ˆX[NÃBˆH[ÙHÃBˆžHÃBˆÛÛœÝØØ[ˆHØØ[•Û[
ÛÛ™šYË^
NÃBˆ›Üˆ
ÛÛœÝÙ^HÙˆX[˜YÙYÛÛ™šYÒÙ^\ÊHÃBˆÛÛœÝ^XÝYHQUSÖÚÙ^WNÃBˆÛÛœÝ\ÜÚYÛ›Y[HØØ[‹\™Ù]Ë™Ù]
Ù^JNÃBˆYˆ
X\ÜÚYÛ›Y[
HX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë›Z\ÜÚ[™È‹Ù^JH	‰ˆX[NÃBˆ[ÙHYˆ
\ÜÚYÛ›Y[œ\œÙY˜[YKšÚ[™OOHœÝš[™ÈŠHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ëš[˜[Y‹Ù^K›]\Ý™HHÓSÝš[™ÈŠH	‰ˆX[NÃBˆH[ÙHYˆ
\ÜÚYÛ›Y[œ\œÙY˜[YK˜[YHOOH^XÝY
HÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë\Ù\‹[[ÙYšYY‹Ù^K\ÜÚYÛ›Y[œ\œÙY˜[YK˜[YHÏÈ\ÜÚYÛ›Y[œ˜]Õ˜[YJH	‰ˆX[NÃBˆH[ÙHÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\ËšX[H‹Ù^K^XÝY
NÃBˆCBˆCBˆHØ]Ú
\œ›ÜŠHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ëš[˜[Y‹˜ÛÛ™šYËÛ[‹\œ›Ü‹›Y\ÜØYÙJH	‰ˆX[NÃBˆCBˆCBƒBˆ›Üˆ
ÛÛœÝ˜[YHÙˆQÑS•ÓSQTÊHÃBˆÛÛœÝÝ\œ™[H]ØZ]™XY^
ØØ][Û–Û˜[YWJNÃBˆYˆ
XÝ\œ™[™^\ÝÊHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë›Z\ÜÚ[™È‹˜[YJH	‰ˆX[NÃBˆÛÛ[YNÃBˆCBˆžHÃBˆÛÛœÝ˜[Y\ÈHÙ]YÙ[˜[Y\ÊÝ\œ™[^
NÃBˆÛÛœÝ[˜[YHØš™XÝ™[šY\ÊQÑS•ÑVPÕUSÓ”ÖÛ˜[YWJCBˆ™š[™

ÚÙ^K˜[YWJHOˆÙ]Ýš[™Ê˜[Y\ËÙ^JHOOH˜[YJNÃBˆYˆ
Ý]K™š[\ÖÛ˜[YWH	‰ˆYÙ\Ý
Y™™\‹™œ›ÛJÝ\œ™[^]ŽŠJHOOHÝ]K™š[\ÖÛ˜[YWKš\Ú
HÃBˆÛÛœÝ]Z[H[˜[YÈ	Ú[˜[YÌ_H\È›ÈÛ™Ù\ˆ	Ú[˜[YÌW_Xˆ›X[˜YÙYš[H\ÚÚ[™ÙYŽÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë\Ù\‹[[ÙYšYY‹˜[YK]Z[
H	‰ˆX[NÃBˆH[ÙHYˆ
[˜[Y
HÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ëš[˜[Y‹˜[YK	Ú[˜[YÌ_H]\Ý™H	Ú[˜[YÌW_X
H	‰ˆX[NÃBˆH[ÙHÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\ËšX[H‹˜[YJNÃBˆCBˆHØ]Ú
\œ›ÜŠHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ëš[˜[Y‹˜[YK\œ›Ü‹›Y\ÜØYÙJH	‰ˆX[NÃBˆCBˆCBƒBˆ›Üˆ
ÛÛœÝÛ˜[YK^XÝ][Û—HÙˆØš™XÝ™[šY\ÊÒÒSÑVPÕUSÓ”ÊJHÂˆÛÛœÝÝ\œ™[]H[œÝ[YX[˜YÙY]
ØØ][Û‹˜[YKØYY›YØXÞTÚÚ[ÊNÂˆYˆ
ØYY›YØXÞTÚÚ[ÊH]ØZ]˜[Y]SÜ\˜][Û”]
ØØ][Û‹Ý\œ™[]
NÂˆÛÛœÝÝ\œ™[H]ØZ]™XY^
Ý\œ™[]
NÂˆYˆ
XÝ\œ™[™^\ÝÊHÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë›Z\ÜÚ[™È‹˜[YJH	‰ˆX[NÃBˆÛÛ[YNÃBˆCBˆÛÛœÝ[˜[YH˜[Y]TÚÚ[
Ý\œ™[^^XÝ][ÛŠNÃBˆYˆ
Ý]K™š[\ÖÛ˜[YWH	‰ˆYÙ\Ý
Y™™\‹™œ›ÛJÝ\œ™[^]ŽŠJHOOHÝ]K™š[\ÖÛ˜[YWKš\Ú
HÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë\Ù\‹[[ÙYšYY‹˜[YK[˜[Y›X[˜YÙYš[H\ÚÚ[™ÙYŠH	‰ˆX[NÃBˆH[ÙHYˆ
[˜[Y
HÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ëš[˜[Y‹˜[YK[˜[Y
H	‰ˆX[NÃBˆH[ÙHÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\ËšX[H‹˜[YJNÃBˆCBˆCBƒBˆYˆ
Ý]K˜˜XÚÝ\
HÃBˆÛÛœÝ˜XÚÝ\H]ØZ]™XY^
ØØ][Û‹˜˜XÚÝ\
NÃBˆYˆ
X˜XÚÝ\™^\ÝÊHX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë›Z\ÜÚ[™È‹˜ÛÛ™šYÈ˜XÚÝ\ŠH	‰ˆX[NÃBˆ[ÙHYˆ
YÙ\Ý
Y™™\‹™œ›ÛJ˜XÚÝ\^]ŽŠJHOOHÝ]K˜˜XÚÝ\š\Ú
HÃBˆX[HHØÝÜ”Ý]\ÊY\ÜØYÙ\Ë\Ù\‹[[ÙYšYY‹˜ÛÛ™šYÈ˜XÚÝ\ŠH	‰ˆX[NÃBˆH[ÙHÃBˆØÝÜ”Ý]\ÊY\ÜØYÙ\ËšX[H‹˜ÛÛ™šYÈ˜XÚÝ\ŠNÃBˆCBˆCBˆ™]\›ˆÈX[KY\ÜØYÙ\ÈNÃBŸCBƒB™[˜Ý[Ûˆ\ØYÙJ
HÃBˆ™]\›ˆÛÙ^[[Ù[\›Ý]\ˆ	Õ‘T”ÒSÓŸCBƒB•\ØYÙNƒBˆÛÙ^[[Ù[\›Ý]\ˆ[œÝ[ËKYÛØ˜[HËK\Ù]YY˜][HËKYžK\[—CBˆÛÙ^[[Ù[\›Ý]\ˆ[š[œÝ[ËKYÛØ˜[HËKYžK\[—CBˆÛÙ^[[Ù[\›Ý]\ˆØÝÜˆËKYÛØ˜[CBˆÛÙ^[[Ù[\›Ý]\ˆK]™\œÚ[Û˜ÃBŸCBƒB™[˜Ý[Ûˆ\œÙP\™ÜÊ\™ÝŠHÃBˆYˆ
\™Ý‹›[™ÝOOHH	‰ˆÈ‹K]™\œÚ[Ûˆ‹‹]ˆ—Kš[˜ÛY\Ê\™Ý–ÌJJH™]\›ˆÈ™\œÚ[ÛŽˆYHNÃBˆYˆ
X\™Ý‹›[™Ý\™Ý‹š[˜ÛY\Ê‹KZ[ŠH\™Ý‹š[˜ÛY\Ê‹ZŠJH™]\›ˆÈ[ˆYHNÃBˆÛÛœÝØÛÛ[X[™‹‹œ˜]Ñ›YÜ×HH\™ÝŽÃBˆYˆ
VÈš[œÝ[‹[š[œÝ[‹™ØÝÜˆ—Kš[˜ÛY\ÊÛÛ[X[™
JH™]\›ˆÈ\œ›ÜŽˆ[šÛ›ÝÛˆÛÛ[X[™ˆNÃBˆÛÛœÝ›YÜÈHÈÛØ˜[ˆ˜[ÙKžT[Žˆ˜[ÙKÙ]Y˜][ˆ˜[ÙHNÃBˆ›Üˆ
ÛÛœÝ›YÈÙˆ˜]Ñ›YÜÊHÃBˆYˆ
›YÈOOH‹KYÛØ˜[ŠH›YÜË™ÛØ˜[HYNÃBˆ[ÙHYˆ
›YÈOOH‹KYžK\[ˆˆ	‰ˆÛÛ[X[™OOH™ØÝÜˆŠH›YÜË™žT[ˆHYNÃBˆ[ÙHYˆ
›YÈOOH‹K\Ù]YY˜][ˆ	‰ˆÛÛ[X[™OOHš[œÝ[ŠH›YÜËœÙ]Y˜][HYNÃBˆ[ÙH™]\›ˆÈ\œ›ÜŽˆ[œÝ\ÜYÜ[Ûˆ›Üˆ	ØÛÛ[X[™Nˆ	Ù›YßXNÃBˆCBˆ™]\›ˆÈÛÛ[X[™›YÜÈNÃBŸCBƒB˜\Þ[˜È[˜Ý[Ûˆ™\Ü›Û“]]][™Ð›ØÚÙ\œÊØØ][Û‹Ý]]
HÃBˆÛÛœÝØÚÈH]ØZ][œÜXÝØÚÊØØ][ÛŠNÃBˆYˆ
ØÚËœÝ]\ÈOOH››Û™HŠHÃBˆÛÛœÝ]Z[HØÚË›Y]Y]CBˆÈ	ÛØÚË›Y]Y]K˜ÛÛ[X[™›Ü\˜][ÛˆŸHY	ÛØÚË›Y]Y]KœYXBˆˆØÚË™]Z[ÃBˆÛÛœÝÝ]\ÈHØÚËœÝ]\ÈOOHœÝ[HƒBˆÈœÝ[K[ØÚÈƒBˆˆØÚËœÝ]\ÈOOH˜ÛÜœ\ˆÈ[œØY™K\Ý]Hˆˆ›ØÚÙYŽÃBˆÝ]]
	ÜÝ]\ßNˆØÛÜH
	Ù]Z[JX
NÃBˆ™]\›ˆ˜[ÙNÃBˆCBˆÛÛœÝ˜[œØXÝ[ÛˆH]ØZ]Û\ÜÚYžR›Ý\›˜[
ØØ][ÛŠNÃBˆYˆ
˜[œØXÝ[Û‹™^\ÝÊHÃBˆÝ]]
	Ý˜[œØXÝ[Û‹˜Û\ÜÚYšXØ][ÛŸNˆ˜[œØXÝ[Ûˆ
	Ý˜[œØXÝ[Û‹™]Z[JX
NÃBˆ™]\›ˆ˜[ÙNÃBˆCBˆ™]\›ˆYNÃBŸCBƒB™^Ü\Þ[˜È[˜Ý[Ûˆ[Š\™Ý‹Ü[ÛœÈHßJHÃBˆÛÛœÝÝ]]HÜ[ÛœË›Ý]]ÏÈÛÛœÛÛK›ÙÎÃBˆÛÛœÝ\œÙYH\œÙP\™ÜÊ\™ÝŠNÃBˆYˆ
\œÙY™\œÚ[ÛŠHÃBˆÝ]]
‘T”ÒSÓŠNÃBˆ™]\›ˆÃBˆCBˆYˆ
\œÙYš[
HÃBˆÝ]]
\ØYÙJ
JNÃBˆ™]\›ˆÃBˆCBˆYˆ
\œÙY™\œ›ÜŠHÃBˆÝ]]
	Ü\œÙY™\œ›ÜŸW—‰Ý\ØYÙJ
_X
NÃBˆ™]\›ˆNÃBˆCBƒBžHÃBˆÛÛœÝØÛÜHH]ØZ]Ø[›ÛšXØ[^™TØÛÜJÃBˆÝÙˆÜ[ÛœË˜ÝÙÏÈ›ØÙ\ÜË˜ÝÙ

KBˆÛYNˆÜ[ÛœËšÛYKBˆ[ŽˆÜ[ÛœË™[ˆÏÈ›ØÙ\ÜË™[‹BˆÛØ˜[ˆ\œÙY™›YÜË™ÛØ˜[BˆJNÃBˆÛÛœÝØØ][ÛˆH^XÝY]ÊØÛÜJNÃBˆ]ØZ]˜[Y]SØØ][Û”ØY™]JØØ][ÛŠNÃBˆYˆ
\œÙY˜ÛÛ[X[™OOH™ØÝÜˆŠHÃBˆÛÛœÝ™\Ý[H]ØZ]ØÝÜŠØÛÜJNÃBˆ›Üˆ
ÛÛœÝY\ÜØYÙHÙˆ™\Ý[›Y\ÜØYÙ\ÊHÝ]]
›Ü›X]Y\ÜØYÙJY\ÜØYÙK˜[ÙJJNÃBˆ™]\›ˆ™\Ý[šX[HÈˆNÃBˆCBƒBˆYˆ
\œÙY™›YÜË™žT[ŠHÃBˆYˆ
J]ØZ]™\Ü›Û“]]][™Ð›ØÚÙ\œÊØØ][Û‹Ý]]
JJH™]\›ˆNÃBˆÛÛœÝ[ˆH\œÙY˜ÛÛ[X[™OOHš[œÝ[ƒBˆÈ]ØZ][’[œÝ[
ØÛÜK\œÙY™›YÜÊCBˆˆ]ØZ][•[š[œÝ[
ØÛÜJNÃBˆš[[Š[‹Ý]]YJNÃBˆ™]\›ˆ[‹™˜Z[YÈHˆÃBˆCBƒBˆ]ØÚÎÃBˆžHÃBˆØÚÈH]ØZ]XÜ]Z\™SØÚÊØØ][Û‹\œÙY˜ÛÛ[X[™Ý]]ØÛÜK™[ŠNÃBˆ]ØZ]˜[Y]SØØ][Û”ØY™]JØØ][ÛŠNÃBˆ]ØZ]™XÛÝ™\•˜[œØXÝ[ÛŠØØ][Û‹Ý]]
NÃBˆÛÛœÝ[ˆH\œÙY˜ÛÛ[X[™OOHš[œÝ[ƒBˆÈ]ØZ][’[œÝ[
ØÛÜK\œÙY™›YÜÊCBˆˆ]ØZ][•[š[œÝ[
ØÛÜJNÃBˆš[[Š[‹Ý]]˜[ÙJNÃBˆYˆ
[‹™˜Z[Y
H™]\›ˆNÃBˆÛÛœÝ™\Ý[H]ØZ]^XÝ]T[Š[‹ØÛÜK™[ŠNÃBˆYˆ
\™\Ý[›ÚÊHÃBˆÝ]]
˜Z[ˆ^XÝ][Ûˆ
	Ü™\Ý[™\œ›ÜË›Y\ÜØYÙH[šÛ›ÝÛˆ\œ›ÜˆŸJX
NÃBˆ™]\›ˆNÃBˆCBˆ™]\›ˆÃBˆHš[˜[HÃBˆ]ØZ]™[X\ÙSØÚÊØØ][Û‹ØÚÊNÃBˆCBˆHØ]Ú
\œ›ÜŠHÃBˆÝ]]
˜Z[ˆ	Ù\œ›Ü‹›Y\ÜØYÙ_X
NÃBˆ™]\›ˆNÃBˆCBŸCB