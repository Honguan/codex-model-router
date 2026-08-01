import { readFile, writeFile, rm } from "node:fs/promises";

async function read(path) {
  return readFile(path, "utf8");
}

async function write(path, content) {
  await writeFile(path, content, "utf8");
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`missing replacement target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`replacement target is not unique: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceRange(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`missing range start: ${label}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`missing range end: ${label}`);
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
}

const manifest = `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const VERSION = packageJson.version;

// Explicit opt-in only. A normal install leaves the user's primary model unchanged.
export const DEFAULTS = Object.freeze({
  model: "gpt-5.6-terra",
  model_reasoning_effort: "high"
});

const legacyLunaV12 = \`name = "luna"\ndescription = "Low-risk helper for repeated edits, searches, formatting, extraction, counting, and summaries."\nmodel = "gpt-5.6-luna"\nmodel_reasoning_effort = "high"\ndeveloper_instructions = """\nHandle only deterministic, low-risk work delegated by Terra.\nFollow the assigned pattern exactly and return a concise result.\nEscalate ambiguous, security-sensitive, or logic-heavy decisions to Terra.\n"""\n\`;

const legacySolWorkspaceWrite = \`name = "sol"\ndescription = "High-capability specialist for security-sensitive or high-regression-risk work."\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "workspace-write"\ndeveloper_instructions = """\nReview or implement only when explicitly delegated by Terra.\nFor review-only tasks, report concrete findings without changing files.\nFor implementation tasks, make focused changes, run relevant checks, and report the result to Terra.\nFocus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.\nDo not expand the scope beyond the delegated task.\n"""\n\`;

const legacySolReadOnly = \`name = "sol"\ndescription = "Read-only reviewer for security-sensitive or high-regression-risk logic."\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nReview only. Focus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.\nReport concrete findings to Terra; do not apply fixes.\n"""\n\`;

const legacySkillWorkspaceWrite = \`---\nname: model-router\ndescription: Route Codex work between Terra, Luna, and Sol with the fewest required agents.\n---\n\nTerra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.\nUse Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.\nUse Sol for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Prefer review-only delegation first; when implementation or a confirmed fix is explicitly required, Sol may edit files in workspace-write mode and run relevant checks.\nDo not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.\n\`;

const legacySkillReadOnly = \`---\nname: model-router\ndescription: Route Codex work between Terra, Luna, and Sol with the fewest required agents.\n---\n\nTerra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.\nUse Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.\nUse Sol only as a read-only reviewer for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Terra applies fixes.\nDo not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.\n\`;

const terra = \`name = "terra"\ndescription = "Investigates, plans, verifies, debugs, and replans nontrivial code changes."\nmodel = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nOwn focused investigation, compact implementation-ready planning, verification, debugging, and replanning.\nUse the implementation-planning skill only for nontrivial or uncertain changes.\nNever invent repository facts; preserve valid work and revise only affected parts.\nVerify both plan conformance and whether the plan plus implementation satisfy the user's requirement.\nUse Sol only when focused investigation and one materially revised plan still leave the core logic unresolved.\nReturn only the artifact required by the current stage.\n"""\n\`;

const luna = \`name = "luna"\ndescription = "Implements clear, bounded work from an approved plan."\nmodel = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"\nsandbox_mode = "workspace-write"\ndeveloper_instructions = """\nImplement the current approved plan with the smallest coherent change.\nPreserve fixed behavior, contracts, scope, parameter flow, control flow, callers, and invariants.\nUse local choice only for equivalent implementation details.\nReturn to Terra when the plan conflicts with current code, is stale, omits a required target or caller, or needs a new correctness-affecting decision.\nReport the plan version, changed files and symbols, deviations, logical checks, and remaining uncertainty.\nDo not self-approve.\n"""\n\`;

const sol = \`name = "sol"\ndescription = "Last-resort advisor for core logic Terra cannot resolve."\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "read-only"\ndeveloper_instructions = """\nAnalyze only the unresolved logical conflict.\nIdentify unsupported assumptions, the likely root cause, required invariants, viable correction directions, and remaining uncertainty.\nDo not perform routine planning, implementation, verification, or final review.\nReturn findings to Terra; do not manage Luna.\n"""\n\`;

const skill = \`---\nname: model-router\ndescription: Adaptively route code planning and implementation while preserving the selected primary model and existing agents.\n---\n\nPreserve repository rules and existing specialized agents. Explicit user instructions win.\nThe selected primary model handles conversation, clarification, follow-ups, final replies, and trivial work.\nFor code changes: ask the user when expected behavior is unclear; use Terra to investigate, plan, verify, debug, and replan; use Luna for clear bounded implementation; use Sol only when Terra still cannot resolve core logic after focused investigation and one materially revised plan, or when the user explicitly requests Sol.\nUse the implementation-planning skill for nontrivial or uncertain changes.\nLuna may choose equivalent local details only; approved behavior, contracts, scope, parameter flow, control flow, and invariants remain fixed.\nTerra verifies both plan conformance and requirement correctness. Preserve verified work and revise only affected parts.\nStop after three cycles without new evidence or a changed decision. Use the fewest agents needed.\nWithin one agent thread append concise deltas; a new thread receives the latest self-contained snapshot.\n\`;

const planning = \`---\nname: implementation-planning\ndescription: Create or revise a compact implementation-ready plan for nontrivial code changes involving multiple symbols, contracts, parameters, callers, control flow, or uncertain targets.\n---\n\nInspect only enough code to confirm correctness-critical facts. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not implement while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, or compatibility.\n\nProduce one compact current snapshot using only applicable fields:\n\n- TASK, REQUIREMENT_VERSION, PLAN_VERSION\n- OBJECTIVE: observable result\n- TARGETS: exact files, symbols, and change type\n- SYMBOLS: exact new names and naming basis\n- CONTRACTS: current and proposed signatures, parameters, defaults, returns, and failure behavior\n- FLOW: source -> caller -> parameter -> transformation -> use -> destination\n- LOGIC: ordered steps and branches\n- CALLERS: affected callers and argument changes\n- INVARIANTS: behavior that must remain true\n- FIXED: decisions Luna cannot change\n- LOCAL_CHOICE: safe implementation freedom\n- RETURN_REQUIRED: conditions requiring Terra\n- DONE_WHEN: acceptance conditions\n\nOmit irrelevant fields and vague instructions. Preserve verified work, revise only affected sections, and identify superseded decisions. Create a new snapshot after three deltas or any material contract or logic change.\n\nVerification answers separately: did implementation match the plan, and did the plan plus implementation satisfy the request? Use PASS, IMPLEMENTATION_FIX, PLAN_REVISION, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION.\n\`;

export const TEMPLATES = Object.freeze({
  terra: Object.freeze({ relative: ["agents", "terra.toml"], content: terra }),
  luna: Object.freeze({ relative: ["agents", "luna.toml"], content: luna }),
  sol: Object.freeze({ relative: ["agents", "sol.toml"], content: sol }),
  skill: Object.freeze({ relative: ["model-router", "SKILL.md"], content: skill }),
  planning: Object.freeze({ relative: ["implementation-planning", "SKILL.md"], content: planning })
});

export const MANAGED_FILE_NAMES = Object.freeze(["terra", "luna", "sol", "skill", "planning"]);
export const AGENT_NAMES = Object.freeze(["terra", "luna", "sol"]);

export const LEGACY_TEMPLATES = Object.freeze({
  terra: Object.freeze([]),
  luna: Object.freeze([legacyLunaV12]),
  sol: Object.freeze([legacySolWorkspaceWrite, legacySolReadOnly]),
  skill: Object.freeze([legacySkillWorkspaceWrite, legacySkillReadOnly]),
  planning: Object.freeze([])
});

export const AGENT_EXPECTATIONS = Object.freeze({
  terra: Object.freeze({
    name: "terra",
    model: "gpt-5.6-terra",
    model_reasoning_effort: "high",
    sandbox_mode: "read-only"
  }),
  luna: Object.freeze({
    name: "luna",
    model: "gpt-5.6-luna",
    model_reasoning_effort: "max",
    sandbox_mode: "workspace-write"
  }),
  sol: Object.freeze({
    name: "sol",
    model: "gpt-5.6-sol",
    model_reasoning_effort: "medium",
    sandbox_mode: "read-only"
  })
});

export const SKILL_EXPECTATIONS = Object.freeze({
  skill: Object.freeze({
    name: "model-router",
    required: Object.freeze(["primary model", "Terra", "Luna", "Sol", "three cycles"])
  }),
  planning: Object.freeze({
    name: "implementation-planning",
    required: Object.freeze(["CONFIRMED", "PROPOSED", "UNKNOWN", "FIXED", "LOCAL_CHOICE", "RETURN_REQUIRED", "PLAN_REVISION"])
  })
});
`;

await write("lib/manifest.js", manifest);

let core = await read("lib/router-core.js");
core = replaceOnce(core,
`  AGENT_EXPECTATIONS,\n  DEFAULTS,\n  LEGACY_TEMPLATES,\n  TEMPLATES,\n  VERSION\n`,
`  AGENT_EXPECTATIONS,\n  AGENT_NAMES,\n  DEFAULTS,\n  LEGACY_TEMPLATES,\n  MANAGED_FILE_NAMES,\n  SKILL_EXPECTATIONS,\n  TEMPLATES,\n  VERSION\n`,
"manifest imports");
core = replaceOnce(core, "const STATE_VERSION = 3;", "const STATE_VERSION = 4;", "state version");
core = replaceOnce(core,
`    luna: join(codexHome, ...TEMPLATES.luna.relative),\n    sol: join(codexHome, ...TEMPLATES.sol.relative),\n    skill: join(skillsHome, "model-router", "SKILL.md"),\n`,
`    terra: join(codexHome, ...TEMPLATES.terra.relative),\n    luna: join(codexHome, ...TEMPLATES.luna.relative),\n    sol: join(codexHome, ...TEMPLATES.sol.relative),\n    skill: join(skillsHome, ...TEMPLATES.skill.relative),\n    planning: join(skillsHome, ...TEMPLATES.planning.relative),\n`,
"managed paths");
core = replaceOnce(core,
`    location.backup,\n    location.luna,\n    location.sol,\n`,
`    location.backup,\n    location.terra,\n    location.luna,\n    location.sol,\n`,
"agent safety paths");
core = replaceOnce(core,
`  const skillsTargets = [location.skillsRoot, location.skillsHome, location.skill];`,
`  const skillsTargets = [location.skillsRoot, location.skillsHome, location.skill, location.planning];`,
"skill safety paths");
core = core.replaceAll('for (const name of ["luna", "sol", "skill"])', "for (const name of MANAGED_FILE_NAMES)");
core = replaceOnce(core,
`  else if (raw.version === 2 || raw.version === STATE_VERSION) state = structuredClone(raw);`,
`  else if ([2, 3, STATE_VERSION].includes(raw.version)) state = structuredClone(raw);`,
"state migration versions");
core = replaceOnce(core,
`    location.codexHome,\n    dirname(location.luna),\n    location.skillsRoot,\n    location.skillsHome,\n    dirname(location.skill)\n`,
`    location.codexHome,\n    dirname(location.terra),\n    dirname(location.luna),\n    location.skillsRoot,\n    location.skillsHome,\n    dirname(location.skill),\n    dirname(location.planning)\n`,
"missing directories");

const patchInstallConfig = `function patchInstallConfig(original, state, setDefault) {
  const scan = scanToml(original);
  const edits = [];
  const additions = [];
  const nextValues = structuredClone(state.config.values || {});

  if (!setDefault) {
    for (const [key, item] of Object.entries(nextValues)) {
      const assignment = scan.targets.get(key);
      if (!assignment) {
        delete nextValues[key];
        continue;
      }
      if (assignment.parsedValue.kind !== "string") {
        throw new Error(\`${key} must be a TOML string\`);
      }
      if (semanticValue(assignment) === item.installed) {
        if (item.previousRaw === null) edits.push(removalEdit(assignment));
        else edits.push({ start: assignment.valueStart, end: assignment.valueEnd, text: item.previousRaw });
      }
      delete nextValues[key];
    }
    return {
      content: edits.length ? applyEdits(original, edits) : original,
      values: nextValues,
      changed: edits.length > 0
    };
  }

  for (const [key, installed] of Object.entries(DEFAULTS)) {
    const assignment = scan.targets.get(key);
    const tracked = nextValues[key];
    if (assignment && assignment.parsedValue.kind !== "string") {
      throw new Error(\`${key} must be a TOML string\`);
    }
    const current = semanticValue(assignment);
    if (!assignment) {
      additions.push(\`${key} = ${quoteToml(installed)}\`);
      nextValues[key] = tracked || { installed, previousRaw: null, source: "inserted" };
      continue;
    }
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

`;
core = replaceRange(core, "function patchInstallConfig(original, state, setDefault) {", "function patchUninstallConfig", `${patchInstallConfig}function patchUninstallConfig`, "install config patcher");

core = replaceOnce(core,
`  if (patched.changed) {\n    if (!state.backup && config.exists) {\n      const backup = await readText(location.backup);\n      if (backup.exists) {\n        failPlan(plan, \`untracked backup already exists: ${location.backup}\`);\n        return plan;\n      }\n      state.backup = { path: location.backup, hash: digest(Buffer.from(original, "utf8")) };\n      addWrite(plan, location.backup, original, "create", "config backup");\n    }\n    addWrite(plan, location.config, patched.content, config.exists ? "update" : "create", "config.toml");\n  } else {\n    addMessage(\n      plan,\n      "preserve",\n      "config.toml",\n      flags.setDefault ? "already matches or contains protected values" : "existing defaults preserved"\n    );\n  }\n`,
`  if (patched.changed) {\n    const empty = patched.content.replace(/^\\uFEFF/, "").trim() === "";\n    if (!flags.setDefault && state.config.createdFile && empty) {\n      addDelete(plan, location.config, "config.toml");\n      state.config.createdFile = false;\n    } else {\n      if (flags.setDefault && !state.backup && config.exists) {\n        const backup = await readText(location.backup);\n        if (backup.exists) {\n          failPlan(plan, \`untracked backup already exists: ${location.backup}\`);\n          return plan;\n        }\n        state.backup = { path: location.backup, hash: digest(Buffer.from(original, "utf8")) };\n        addWrite(plan, location.backup, original, "create", "config backup");\n      }\n      addWrite(plan, location.config, patched.content, config.exists ? "update" : "create", "config.toml");\n    }\n  } else {\n    addMessage(\n      plan,\n      "preserve",\n      "config.toml",\n      flags.setDefault ? "already matches or contains protected values" : "primary model preserved"\n    );\n  }\n\n  if (!flags.setDefault && Object.keys(state.config.values).length === 0 && state.backup) {\n    const backup = await readText(location.backup);\n    if (!backup.exists) addMessage(plan, "skip", "config backup", "already missing");\n    else if (digest(Buffer.from(backup.text, "utf8")) === state.backup.hash) {\n      addDelete(plan, location.backup, "config backup");\n    } else {\n      addMessage(plan, "preserve", "config backup", "user-modified");\n    }\n    state.backup = null;\n  }\n`,
"free mode config behavior");

core = replaceRange(core,
"function validateSkill(content) {",
"function doctorStatus",
`function validateSkill(content, expectation) {
  const match = content.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n([\\s\\S]*)$/);
  if (!match) return "invalid front matter";
  const front = match[1];
  const body = match[2];
  const escapedName = expectation.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  if (!new RegExp(\`^name:\\s*${escapedName}\\s*$\`, "m").test(front)) return "incorrect skill name";
  if (!/^description:\\s*\\S.+$/m.test(front)) return "missing skill description";
  const missing = expectation.required.find((term) => !body.toLowerCase().includes(term.toLowerCase()));
  return missing ? \`missing required rule: ${missing}\` : null;
}

function doctorStatus`,
"skill validator");

const doctorConfig = `  const config = await readText(location.config);
  const managedConfigKeys = Object.keys(state.config.values || {});
  if (!managedConfigKeys.length) {
    doctorStatus(messages, "healthy", "config.toml", config.exists ? "primary model preserved" : "free mode");
  } else if (!config.exists) {
    healthy = doctorStatus(messages, "missing", "config.toml") && healthy;
  } else {
    try {
      const scan = scanToml(config.text);
      for (const key of managedConfigKeys) {
        const expected = DEFAULTS[key];
        const assignment = scan.targets.get(key);
        if (!assignment) healthy = doctorStatus(messages, "missing", key) && healthy;
        else if (assignment.parsedValue.kind !== "string") {
          healthy = doctorStatus(messages, "invalid", key, "must be a TOML string") && healthy;
        } else if (assignment.parsedValue.value !== expected) {
          healthy = doctorStatus(messages, "user-modified", key, assignment.parsedValue.value ?? assignment.rawValue) && healthy;
        } else {
          doctorStatus(messages, "healthy", key, expected);
        }
      }
    } catch (error) {
      healthy = doctorStatus(messages, "invalid", "config.toml", error.message) && healthy;
    }
  }

`;
core = replaceRange(core, "  const config = await readText(location.config);", "  for (const name of [\"luna\", \"sol\"])", `${doctorConfig}  for (const name of AGENT_NAMES)`, "doctor config and agents");

const doctorSkills = `  for (const [name, expectation] of Object.entries(SKILL_EXPECTATIONS)) {
    const current = await readText(location[name]);
    if (!current.exists) {
      healthy = doctorStatus(messages, "missing", name) && healthy;
      continue;
    }
    const invalid = validateSkill(current.text, expectation);
    if (state.files[name] && digest(Buffer.from(current.text, "utf8")) !== state.files[name].hash) {
      healthy = doctorStatus(messages, "user-modified", name, invalid || "managed file hash changed") && healthy;
    } else if (invalid) {
      healthy = doctorStatus(messages, "invalid", name, invalid) && healthy;
    } else {
      doctorStatus(messages, "healthy", name);
    }
  }

`;
core = replaceRange(core, "  const skill = await readText(location.skill);", "  if (state.backup) {", `${doctorSkills}  if (state.backup) {`, "doctor skills");
await write("lib/router-core.js", core);

let tests = await read("test/router.test.js");
tests = replaceOnce(tests,
`    luna: join(dir.project, ".codex", "agents", "luna.toml"),\n    sol: join(dir.project, ".codex", "agents", "sol.toml"),\n    skill: join(dir.project, ".agents", "skills", "model-router", "SKILL.md"),\n`,
`    terra: join(dir.project, ".codex", "agents", "terra.toml"),\n    luna: join(dir.project, ".codex", "agents", "luna.toml"),\n    sol: join(dir.project, ".codex", "agents", "sol.toml"),\n    skill: join(dir.project, ".agents", "skills", "model-router", "SKILL.md"),\n    planning: join(dir.project, ".agents", "skills", "implementation-planning", "SKILL.md"),\n`,
"test managed paths");

const freshTest = `test("fresh install preserves the primary model and writes adaptive templates", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await exists(paths.config), false);
    assert.equal(await text(paths.terra), TEMPLATES.terra.content);
    assert.equal(await text(paths.luna), TEMPLATES.luna.content);
    assert.equal(await text(paths.sol), TEMPLATES.sol.content);
    assert.equal(await text(paths.skill), TEMPLATES.skill.content);
    assert.equal(await text(paths.planning), TEMPLATES.planning.content);
    assert.match(await text(paths.terra), /sandbox_mode = "read-only"/);
    assert.match(await text(paths.luna), /model_reasoning_effort = "max"/);
    assert.match(await text(paths.luna), /sandbox_mode = "workspace-write"/);
    assert.match(await text(paths.sol), /sandbox_mode = "read-only"/);
    const state = JSON.parse(await text(paths.state));
    assert.equal(state.version, 4);
    assert.equal(state.packageVersion, VERSION);
    assert.deepEqual(state.config.values, {});
    assert.equal(await exists(paths.journal), false);
    assert.equal(await exists(paths.transactionData), false);
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});

`;
tests = replaceRange(tests,
`test("fresh install writes the current workspace-write Sol template in one operation phase", async () => {`,
`test("legacy managed Sol and skill templates migrate without replacing user changes", async () => {`,
`${freshTest}test("legacy managed Sol and skill templates migrate without replacing user changes", async () => {`,
"fresh install test");

tests = tests.replaceAll("assert.equal(state.version, 3);", "assert.equal(state.version, 4);");

const appendedTests = `

test("managed v1.2 routing templates migrate to adaptive roles", async () => {
  const dir = await fixture();
  const oldLuna = \`name = "luna"\ndescription = "Low-risk helper for repeated edits, searches, formatting, extraction, counting, and summaries."\nmodel = "gpt-5.6-luna"\nmodel_reasoning_effort = "high"\ndeveloper_instructions = """\nHandle only deterministic, low-risk work delegated by Terra.\nFollow the assigned pattern exactly and return a concise result.\nEscalate ambiguous, security-sensitive, or logic-heavy decisions to Terra.\n"""\n\`;
  const oldSol = \`name = "sol"\ndescription = "High-capability specialist for security-sensitive or high-regression-risk work."\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\nsandbox_mode = "workspace-write"\ndeveloper_instructions = """\nReview or implement only when explicitly delegated by Terra.\nFor review-only tasks, report concrete findings without changing files.\nFor implementation tasks, make focused changes, run relevant checks, and report the result to Terra.\nFocus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.\nDo not expand the scope beyond the delegated task.\n"""\n\`;
  const oldSkill = \`---\nname: model-router\ndescription: Route Codex work between Terra, Luna, and Sol with the fewest required agents.\n---\n\nTerra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.\nUse Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.\nUse Sol for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Prefer review-only delegation first; when implementation or a confirmed fix is explicitly required, Sol may edit files in workspace-write mode and run relevant checks.\nDo not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.\n\`;
  try {
    const paths = managed(dir);
    await run(["install"], { cwd: dir.project, home: dir.home, output: quiet });
    await writeFile(paths.luna, oldLuna);
    await writeFile(paths.sol, oldSol);
    await writeFile(paths.skill, oldSkill);
    const state = JSON.parse(await text(paths.state));
    state.version = 3;
    state.packageVersion = "1.2.0";
    state.files.luna.hash = hash(oldLuna);
    state.files.sol.hash = hash(oldSol);
    state.files.skill.hash = hash(oldSkill);
    delete state.files.terra;
    delete state.files.planning;
    await writeFile(paths.state, \`${JSON.stringify(state, null, 2)}\\n\`);
    await unlink(paths.terra);
    await unlink(paths.planning);

    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await text(paths.terra), TEMPLATES.terra.content);
    assert.equal(await text(paths.luna), TEMPLATES.luna.content);
    assert.equal(await text(paths.sol), TEMPLATES.sol.content);
    assert.equal(await text(paths.skill), TEMPLATES.skill.content);
    assert.equal(await text(paths.planning), TEMPLATES.planning.content);
  } finally { await dir.cleanup(); }
});

test("plain install releases package-managed defaults back to free mode", async () => {
  const dir = await fixture();
  try {
    const paths = managed(dir);
    assert.equal(await run(["install", "--set-default"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.match(await text(paths.config), /gpt-5\\.6-terra/);
    assert.equal(await run(["install"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
    assert.equal(await exists(paths.config), false);
    const state = JSON.parse(await text(paths.state));
    assert.deepEqual(state.config.values, {});
    assert.equal(state.backup, null);
    assert.equal(await run(["doctor"], { cwd: dir.project, home: dir.home, output: quiet }), 0);
  } finally { await dir.cleanup(); }
});
`;
tests += appendedTests;
await write("test/router.test.js", tests);

const packageSmoke = `import assert from "node:assert/strict";
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
  await exec(process.execPath, [binary, "install"], { cwd: project });
  await exec(process.execPath, [binary, "doctor"], { cwd: project });
  await assert.rejects(access(join(project, ".codex", "config.toml")));
  assert.match(await readFile(join(project, ".codex", "agents", "terra.toml"), "utf8"), /gpt-5\\.6-terra/);
  assert.match(await readFile(join(project, ".codex", "agents", "luna.toml"), "utf8"), /model_reasoning_effort = "max"/);
  assert.match(await readFile(join(project, ".codex", "agents", "sol.toml"), "utf8"), /sandbox_mode = "read-only"/);
  assert.match(await readFile(join(project, ".agents", "skills", "implementation-planning", "SKILL.md"), "utf8"), /LOCAL_CHOICE/);
  await exec(process.execPath, [binary, "uninstall"], { cwd: project });
  await rm(tarball, { force: true });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
`;
await write("scripts/package-smoke.js", packageSmoke);

const packageJson = JSON.parse(await read("package.json"));
packageJson.version = "2.0.0";
packageJson.description = "Safely install adaptive free-mode Codex routing for Terra, Luna, and Sol.";
await write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

const changelog = await read("CHANGELOG.md");
await write("CHANGELOG.md", replaceOnce(changelog, "# Changelog\n\n", `# Changelog\n\n## 2.0.0 - 2026-08-01\n\n- Keep the user-selected primary model unchanged by default; Terra/high is now explicit through --set-default only.\n- Add a fixed Terra/high planning and verification agent while preserving existing specialized agents.\n- Promote Luna to max reasoning for most clear, bounded implementation work.\n- Restrict Sol/medium to read-only last-resort logic rescue after Terra investigation and replanning fail.\n- Split compact routing guidance from the progressively loaded implementation-planning skill.\n- Add plan conformance versus requirement correctness checks, local correction versus replanning, and bounded iteration rules.\n- Add cache-friendly same-thread deltas and self-contained snapshots for new agent threads.\n- Migrate recognized 1.x managed templates without overwriting user-modified files.\n\n`, "changelog header"));

const readme = `# codex-model-router

A small Node.js CLI that safely installs adaptive Codex subagent routing for Terra, Luna, and Sol without replacing unrelated user configuration or the user's selected primary model.

> Routing is advisory. Codex reads the installed skills and decides when to delegate. This package does not intercept prompts, guarantee a hard model switch, or modify AGENTS.md.

## Routing model

The normal installation uses free mode:

- The user-selected primary model handles conversation, clarification, follow-ups, final replies, and trivial work.
- Terra/high investigates, produces implementation-ready plans, verifies results, debugs, and replans.
- Luna/max performs most clear, bounded, repetitive, or independently verifiable implementation work.
- Sol/medium is read-only and used only when Terra still cannot resolve core logic after focused investigation and one materially revised plan, or when the user explicitly requests Sol.
- Existing built-in and custom agents remain available and take precedence when they are a better match.

A normal workflow is Terra -> Luna -> Terra. Implementation errors return to Luna as focused corrections. Plan or logic errors return to Terra for a revised plan before Luna continues. Sol is not a routine reviewer.

## Quick start

Preview without changing files:

\`\`\`sh
npx codex-model-router install --dry-run
\`\`\`

Install free-mode routing and verify it:

\`\`\`sh
npx codex-model-router install
npx codex-model-router doctor
\`\`\`

Remove only unchanged package-managed files and settings:

\`\`\`sh
npx codex-model-router uninstall
\`\`\`

## Optional Terra default

A normal install does not add or change top-level model settings. Users remain free to select any primary model through Codex.

To explicitly set and track Terra/high as the selected scope's default:

\`\`\`sh
codex-model-router install --set-default
\`\`\`

Running a later plain \`install\` returns package-managed default settings to free mode. User-modified model settings are preserved.

## Install

Run from npm:

\`\`\`sh
npx codex-model-router install
\`\`\`

Install the command globally:

\`\`\`sh
npm install -g codex-model-router
codex-model-router install
\`\`\`

Installing the CLI globally only makes the command available system-wide. Use \`install --global\` to install routing for the current user's Codex configuration.

Install a specific GitHub release:

\`\`\`sh
npm install -g https://github.com/Honguan/codex-model-router/archive/refs/tags/v2.0.0.tar.gz
codex-model-router install
\`\`\`

## Managed files

Project scope is the default and manages only:

\`\`\`text
.codex/config.toml                              # only with --set-default or a managed migration
.codex/agents/terra.toml
.codex/agents/luna.toml
.codex/agents/sol.toml
.codex/model-router-state.json
.codex/config.toml.codex-model-router.bak       # only when needed
.agents/skills/model-router/SKILL.md
.agents/skills/implementation-planning/SKILL.md
\`\`\`

Use global scope with:

\`\`\`sh
codex-model-router install --global
codex-model-router doctor --global
\`\`\`

Global scope stores agents under \`$CODEX_HOME/agents\` and skills under \`~/.agents/skills\`. When \`CODEX_HOME\` is unset, it defaults to \`~/.codex\`.

Existing files at managed paths are never overwritten. Later manual edits are preserved and reported by \`doctor\`.

## Prompt and cache efficiency

The installed model-router skill is intentionally short. Detailed planning rules live in the separate implementation-planning skill and are loaded only for nontrivial or uncertain changes.

Within the same agent thread, accepted state is kept and concise deltas are appended. A new agent thread receives the latest self-contained snapshot. After three deltas or a material contract or logic change, Terra produces a new snapshot.

Prompt-cache reuse is best effort: genuinely new information cannot be a cache hit on first use. Stable wording and ordering improve repeated-prefix reuse, but correctness takes priority over cache behavior.

## Planning rules

For nontrivial changes, Terra identifies only applicable correctness-critical details, including exact files and symbols, names, contracts, parameter flow, callers, ordered logic, invariants, fixed decisions, safe local choices, return conditions, and acceptance criteria.

Information is marked as CONFIRMED, PROPOSED, or UNKNOWN. Luna does not begin implementation while an UNKNOWN can materially change behavior, targets, contracts, parameter flow, control flow, or compatibility.

Terra verifies separately whether implementation matches the plan and whether the plan plus implementation satisfy the original requirement. After three cycles without new evidence or a changed decision, the workflow stops instead of repeating the same approach.

## Commands

\`\`\`text
codex-model-router install [--global] [--set-default] [--dry-run]
codex-model-router uninstall [--global] [--dry-run]
codex-model-router doctor [--global]
codex-model-router --version
\`\`\`

\`doctor\` is read-only. Exit code 0 means healthy; exit code 1 means action is required.

## Safety behavior

- Preserves unrelated TOML settings, comments, BOM, ordering, and LF/CRLF line endings.
- Rejects malformed, non-UTF-8, duplicate, or unsafe configuration before writing.
- Rejects symlinks and Windows junctions in managed paths.
- Uses scope-level locking, atomic transactions, rollback, and conflict-safe recovery.
- Never overwrites post-interruption user changes.
- Dry-run creates no files, directories, backups, locks, journals, or state.
- Never modifies AGENTS.md, shell profiles, editor settings, hooks, MCP servers, telemetry, accounts, or environment variables.

## Compatibility

Compatibility is tested on Node.js 18, 20, 22, and 24 across Windows, Linux, and macOS runners. The selected Codex account must have access to gpt-5.6-terra, gpt-5.6-luna, and gpt-5.6-sol.

Restart Codex after installation so new agents and skills are discovered. Use \`doctor\` for missing, user-modified, unsafe-state, lock, or interrupted-transaction reports.

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md). Maintainer setup and release steps are documented in [MAINTAINERS.md](MAINTAINERS.md).
`;
await write("README.md", readme);

await rm(".github/workflows/apply-adaptive-routing.yml", { force: true });
await rm("scripts/apply-adaptive-routing.mjs", { force: true });
