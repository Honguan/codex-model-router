import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const VERSION = packageJson.version;

// Explicit opt-in only. A normal install leaves the user's primary model unchanged.
export const DEFAULTS = Object.freeze({
  model: "gpt-5.6-terra",
  model_reasoning_effort: "high"
});

const legacyLunaV12 = `name = "luna"
description = "Low-risk helper for repeated edits, searches, formatting, extraction, counting, and summaries."
model = "gpt-5.6-luna"
model_reasoning_effort = "high"
developer_instructions = """
Handle only deterministic, low-risk work delegated by Terra.
Follow the assigned pattern exactly and return a concise result.
Escalate ambiguous, security-sensitive, or logic-heavy decisions to Terra.
"""
`;

const legacySolWorkspaceWrite = `name = "sol"
description = "High-capability specialist for security-sensitive or high-regression-risk work."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "workspace-write"
developer_instructions = """
Review or implement only when explicitly delegated by Terra.
For review-only tasks, report concrete findings without changing files.
For implementation tasks, make focused changes, run relevant checks, and report the result to Terra.
Focus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.
Do not expand the scope beyond the delegated task.
"""
`;

const legacySolReadOnly = `name = "sol"
description = "Read-only reviewer for security-sensitive or high-regression-risk logic."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"
developer_instructions = """
Review only. Focus on security, authentication, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.
Report concrete findings to Terra; do not apply fixes.
"""
`;

const legacySkillWorkspaceWrite = `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol with the fewest required agents.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.
Use Sol for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Prefer review-only delegation first; when implementation or a confirmed fix is explicitly required, Sol may edit files in workspace-write mode and run relevant checks.
Do not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.
`;

const legacySkillReadOnly = `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol with the fewest required agents.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.
Use Sol only as a read-only reviewer for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Terra applies fixes.
Do not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.
`;

const terra = `name = "terra"
description = "Investigates, plans, verifies, debugs, and replans nontrivial code changes."
model = "gpt-5.6-terra"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
Own focused investigation, compact implementation-ready planning, verification, debugging, and replanning.
Use the implementation-planning skill only for nontrivial or uncertain changes.
Never invent repository facts; preserve valid work and revise only affected parts.
Verify both plan conformance and whether the plan plus implementation satisfy the user's requirement.
Use Sol only when focused investigation and one materially revised plan still leave the core logic unresolved.
Return only the artifact required by the current stage.
"""
`;

const luna = `name = "luna"
description = "Implements clear, bounded work from an approved plan."
model = "gpt-5.6-luna"
model_reasoning_effort = "xhigh"
sandbox_mode = "workspace-write"
developer_instructions = """
Implement the current approved plan with the smallest coherent change.
Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, and invariants.
Use local choice only for equivalent implementation details.
Return to Terra when the plan conflicts with current code, is stale, omits a required target or caller, or needs a new correctness-affecting decision.
Report the plan version, changed files and symbols, deviations, logical checks, and remaining uncertainty.
Do not self-approve.
"""
`;

const sol = `name = "sol"
description = "Last-resort advisor for core logic Terra cannot resolve."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"
developer_instructions = """
Analyze only the unresolved logical conflict.
Identify unsupported assumptions, the likely root cause, required invariants, viable correction directions, and remaining uncertainty.
Do not perform routine planning, implementation, verification, or final review.
Return findings to Terra; do not manage Luna.
"""
`;

const skill = `---
name: model-router
description: Adaptively route code planning and implementation while preserving the selected primary model and existing agents.
---

Preserve repository rules and existing specialized agents. Explicit user instructions win.
The selected primary model handles conversation, clarification, follow-ups, final replies, and trivial work.
For code changes: ask the user when expected behavior is unclear; use Terra to investigate, plan, verify, debug, and replan; use Luna for clear bounded implementation; use Sol only when Terra still cannot resolve core logic after focused investigation and one materially revised plan, or when the user explicitly requests Sol.
Use the implementation-planning skill for nontrivial or uncertain changes.
Luna may choose equivalent local details only; approved behavior, contracts, scope, parameter flow, control flow, and invariants remain fixed.
Terra verifies both plan conformance and requirement correctness. Preserve verified work and revise only affected parts.
Stop after three cycles without new evidence or a changed decision. Use the fewest agents needed.
Within one agent thread append concise deltas; a new thread receives the latest self-contained snapshot.
`;

const planning = `---
name: implementation-planning
description: Create or revise a compact implementation-ready plan for nontrivial code changes involving multiple symbols, contracts, parameters, callers, control flow, or uncertain targets.
---

Inspect only enough code to confirm correctness-critical facts. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not implement while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, or compatibility.

Produce one compact current snapshot using only applicable fields:

- TASK, REQUIREMENT_VERSION, PLAN_VERSION
- OBJECTIVE: observable result
- TARGETS: exact files, symbols, and change type
- SYMBOLS: exact new names and naming basis
- CONTRACTS: current and proposed signatures, parameters, defaults, returns, and failure behavior
- FLOW: source -> caller -> parameter -> transformation -> use -> destination
- LOGIC: ordered steps and branches
- CALLERS: affected callers and argument changes
- INVARIANTS: behavior that must remain true
- FIXED: decisions Luna cannot change
- LOCAL_CHOICE: safe implementation freedom
- RETURN_REQUIRED: conditions requiring Terra
- DONE_WHEN: acceptance conditions

Omit irrelevant fields and vague instructions. Preserve verified work, revise only affected sections, and identify superseded decisions. Create a new snapshot after three deltas or any material contract or logic change.

Verification answers separately: did implementation match the plan, and did the plan plus implementation satisfy the request? Use PASS, IMPLEMENTATION_FIX, PLAN_REVISION, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION.
`;

export const REASONING_EFFORTS = Object.freeze([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);

export const DEFAULT_AGENT_REASONING = Object.freeze({
  terra: "high",
  luna: "xhigh",
  sol: "medium"
});

export const AGENT_NAMES = Object.freeze(["terra", "luna", "sol"]);

const AGENT_BASE_TEMPLATES = Object.freeze({ terra, luna, sol });

function withReasoning(content, reasoning) {
  const pattern = /^model_reasoning_effort = "[^"]+"$/m;
  if (!pattern.test(content)) throw new Error("agent template is missing model_reasoning_effort");
  return content.replace(pattern, `model_reasoning_effort = "${reasoning}"`);
}

export const TEMPLATES = {
  terra: { relative: Object.freeze(["agents", "terra.toml"]), content: terra },
  luna: { relative: Object.freeze(["agents", "luna.toml"]), content: luna },
  sol: { relative: Object.freeze(["agents", "sol.toml"]), content: sol },
  skill: { relative: Object.freeze(["model-router", "SKILL.md"]), content: skill },
  planning: { relative: Object.freeze(["implementation-planning", "SKILL.md"]), content: planning }
};

export const MANAGED_FILE_NAMES = Object.freeze(["terra", "luna", "sol", "skill", "planning"]);

export const LEGACY_TEMPLATES = {
  terra: [],
  luna: [legacyLunaV12, withReasoning(luna, "max")],
  sol: [legacySolWorkspaceWrite, legacySolReadOnly],
  skill: [legacySkillWorkspaceWrite, legacySkillReadOnly],
  planning: []
};

export const AGENT_EXPECTATIONS = {
  terra: {
    name: "terra",
    model: "gpt-5.6-terra",
    model_reasoning_effort: "high",
    sandbox_mode: "read-only"
  },
  luna: {
    name: "luna",
    model: "gpt-5.6-luna",
    model_reasoning_effort: "xhigh",
    sandbox_mode: "workspace-write"
  },
  sol: {
    name: "sol",
    model: "gpt-5.6-sol",
    model_reasoning_effort: "medium",
    sandbox_mode: "read-only"
  }
};

export function configureAgentReasoning(overrides = {}, migrateFrom = {}) {
  const selected = { ...DEFAULT_AGENT_REASONING, ...overrides };
  for (const [name, reasoning] of Object.entries(selected)) {
    if (!AGENT_NAMES.includes(name)) throw new Error(`unknown agent: ${name}`);
    if (!REASONING_EFFORTS.includes(reasoning)) {
      throw new Error(`unsupported reasoning effort for ${name}: ${reasoning}`);
    }
  }

  for (const name of AGENT_NAMES) {
    const previous = migrateFrom[name];
    if (typeof previous === "string" && !LEGACY_TEMPLATES[name].includes(previous)) {
      LEGACY_TEMPLATES[name].push(previous);
    }
    TEMPLATES[name].content = withReasoning(AGENT_BASE_TEMPLATES[name], selected[name]);
    AGENT_EXPECTATIONS[name].model_reasoning_effort = selected[name];
  }
  return Object.freeze({ ...selected });
}

configureAgentReasoning();

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
