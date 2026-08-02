import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const VERSION = packageJson.version;

export const DEFAULTS = Object.freeze({
  model: "gpt-5.6-terra",
  model_reasoning_effort: "high"
});

const previousTerra = `name = "terra"
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

const previousLuna = `name = "luna"
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

const previousSol = `name = "sol"
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

const previousSkill = `---
name: model-router
description: Adaptively route code planning and implementation while preserving the selected primary model and existing agents.
---

Preserve repository rules and existing specialized agents. Explicit user instructions win.
The selected primary model handles conversation, clarification, follow-ups, final replies, and trivial work.
Inline a matching primary role instead of spawning a redundant same-model subagent: a Terra primary investigates, plans, debugs, replans, and verifies in the primary thread; a Luna primary implements directly unless isolation or independent parallel work is materially useful; a Sol primary handles the last-resort advisory step in the primary thread. Never infer the primary identity when Codex does not expose it; use the standard Terra -> Luna -> Terra flow instead.
For code changes with a nonmatching or unknown primary: ask the user when expected behavior is unclear; use Terra to investigate, plan, verify, debug, and replan; use Luna for clear bounded implementation; use Sol only when Terra still cannot resolve core logic after focused investigation and one materially revised plan, or when the user explicitly requests Sol.
Use the implementation-planning skill for nontrivial or uncertain changes.
Luna may choose equivalent local details only; approved behavior, contracts, scope, parameter flow, control flow, and invariants remain fixed.
Terra verifies both plan conformance and requirement correctness. Preserve verified work and revise only affected parts.
Stop after three cycles without new evidence or a changed decision. Use the fewest agents needed.
Within one agent thread append concise deltas; a new thread receives the latest self-contained snapshot.
`;

const previousPlanning = `---
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

const terra = `name = "terra"
description = "Writes evidence-grounded plans and independently verifies implementation results."
model = "gpt-5.6-terra"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
Work only from the primary requirement and Luna's latest self-contained requirement evidence package.
For planning, write or update the compact implementation-ready PLAN.md without rereading material Luna already confirmed unless evidence is missing or contradictory.
Mark facts as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility.
For verification, independently compare the primary requirement, evidence package, complete PLAN.md, implementation report, changed code, and verification evidence.
Return exactly one verdict: PASS, FAIL_IMPLEMENTATION, FAIL_PLAN, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION.
On PASS, provide the final verification result for the primary model. On any failure, provide concrete evidence for Sol escalation.
Never edit implementation files. Preserve valid work and revise only affected plan sections.
Return only the artifact required by the current stage.
"""
`;

const luna = `name = "luna"
description = "Reads task evidence and implements clear bounded work from the complete approved plan."
model = "gpt-5.6-luna"
model_reasoning_effort = "xhigh"
sandbox_mode = "workspace-write"
developer_instructions = """
Use one persistent Luna role for the complete workflow; do not create a second Luna agent for implementation after requirement reading.
Requirement-reading stage: read all task-relevant user requirement files, repository rules, existing plans, specified code, direct callers, direct dependencies, configuration, and verification instructions. Expand only when required for correctness.
Produce a self-contained REQUIREMENT_EVIDENCE package containing the primary requirement, constraints, confirmed files and symbols, current behavior, required behavior, direct flow, invariants, unknowns, and evidence locations.
Do not choose architecture, invent facts, resolve correctness decisions, or edit files during requirement reading.
Implementation stage: reread the complete latest PLAN.md, then implement the smallest coherent change. Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, invariants, encoding, and line endings.
Use local choice only for equivalent implementation details. Stop and return to Terra when the plan conflicts with code, is stale, omits a required target or caller, or requires a new correctness-affecting decision.
Report the plan version, changed files and symbols, completed steps, deviations, checks, and remaining uncertainty. Do not self-approve.
"""
`;

const sol = `name = "sol"
description = "Escalation reviewer that diagnoses failed verification and rewrites the affected plan."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"
developer_instructions = """
Enter only after Terra returns a non-PASS verification verdict, or when the user explicitly requests Sol escalation.
Independently analyze the primary requirement, Luna evidence package, prior PLAN.md, implementation report, changed code, and Terra verification evidence.
Identify whether the root cause is an implementation defect, plan defect, evidence gap, or requirement gap.
Preserve verified work. Rewrite only affected PLAN.md sections, clearly identify superseded decisions, and provide a complete revised plan for Luna to reread.
Do not edit implementation files, run routine implementation, replace Terra verification, or create another Sol agent when Sol is already the primary model.
Return the revised plan and unresolved uncertainty to the same Luna role.
"""
`;

const skill = `---
name: model-router
description: Route a primary request through Luna evidence collection, Terra planning, Luna implementation, Terra verification, and bounded Sol escalation without duplicate same-model agents.
---

Preserve repository rules and existing specialized agents. Explicit user instructions win.
The selected primary model owns conversation, requirement clarification, workflow coordination, final synthesis, and the final user reply.
Do not start the full workflow for ordinary questions, explanations, read-only analysis, or a requirement that is still unclear.

For nontrivial code changes use this canonical flow:
1. The primary model confirms the requirement and preserves all user constraints.
2. Luna reads all task-relevant requirement files, rules, code, direct callers, dependencies, configuration, and verification instructions, then returns one self-contained REQUIREMENT_EVIDENCE package.
3. Terra writes or updates the complete PLAN.md from the primary requirement plus Luna evidence.
4. The same Luna role rereads the complete PLAN.md and implements it.
5. Terra independently verifies requirement satisfaction and plan conformance.
6. PASS returns the final verification result to the primary model.
7. Any non-PASS verdict escalates to Sol, which diagnoses the failure and rewrites only affected PLAN.md sections.
8. The same Luna role rereads the complete revised plan and reimplements the affected scope.
9. Terra performs full final verification and returns PASS or a blocked result to the primary model.

Never launch duplicate same-model agents in one workflow. Reuse one stable role identity and number per model. If the primary is Luna, perform all Luna stages in the primary thread. If the primary is Terra, perform all Terra stages in the primary thread. If the primary is Sol, perform Sol escalation in the primary thread. Never spawn a redundant matching-model subagent. When primary identity is unavailable, do not guess; use one Luna agent, one Terra agent, and only on failure one Sol agent.
Luna is the only workspace-write role. Terra and Sol remain read-only. Luna must not make architecture or correctness decisions; Terra must not implement; Sol must not implement or replace final Terra verification.
Use the implementation-planning skill for nontrivial or uncertain changes. Preserve verified work and revise only affected parts.
Use one correction loop by default and never exceed three total implementation-verification cycles without new evidence or a changed user decision.
Within one role thread append concise deltas; a new thread receives the latest self-contained artifact instead of the full prior conversation.
`;

const planning = `---
name: implementation-planning
description: Convert Luna requirement evidence into a compact implementation-ready plan and verify the resulting implementation.
---

Input must include the primary requirement and Luna's latest REQUIREMENT_EVIDENCE package. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility.

Produce one compact current PLAN.md snapshot using only applicable fields:

- TASK, REQUIREMENT_VERSION, EVIDENCE_VERSION, PLAN_VERSION
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
- FORBIDDEN: out-of-scope edits, refactors, or dependencies
- RETURN_REQUIRED: conditions requiring Terra
- VERIFICATION: exact checks and evidence required
- DONE_WHEN: acceptance conditions

Omit irrelevant fields and vague instructions. Preserve verified work, revise only affected sections, and identify superseded decisions.

Verification compares the primary requirement, REQUIREMENT_EVIDENCE, complete PLAN.md, implementation report, changed code, and check evidence. Return exactly one of PASS, FAIL_IMPLEMENTATION, FAIL_PLAN, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION. Any non-PASS result includes concrete evidence for Sol escalation.
`;

export const REASONING_EFFORTS = Object.freeze(["none", "low", "medium", "high", "xhigh", "max"]);

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
  terra: [previousTerra],
  luna: [previousLuna, withReasoning(previousLuna, "max")],
  sol: [previousSol],
  skill: [previousSkill],
  planning: [previousPlanning]
};

export const AGENT_EXPECTATIONS = {
  terra: { name: "terra", model: "gpt-5.6-terra", model_reasoning_effort: "high", sandbox_mode: "read-only" },
  luna: { name: "luna", model: "gpt-5.6-luna", model_reasoning_effort: "xhigh", sandbox_mode: "workspace-write" },
  sol: { name: "sol", model: "gpt-5.6-sol", model_reasoning_effort: "medium", sandbox_mode: "read-only" }
};

export function configureAgentReasoning(overrides = {}, migrateFrom = {}) {
  const selected = { ...DEFAULT_AGENT_REASONING, ...overrides };
  for (const [name, reasoning] of Object.entries(selected)) {
    if (!AGENT_NAMES.includes(name)) throw new Error(`unknown agent: ${name}`);
    if (!REASONING_EFFORTS.includes(reasoning)) throw new Error(`unsupported reasoning effort for ${name}: ${reasoning}`);
  }
  for (const name of AGENT_NAMES) {
    const previous = migrateFrom[name];
    if (typeof previous === "string" && !LEGACY_TEMPLATES[name].includes(previous)) LEGACY_TEMPLATES[name].push(previous);
    TEMPLATES[name].content = withReasoning(AGENT_BASE_TEMPLATES[name], selected[name]);
    AGENT_EXPECTATIONS[name].model_reasoning_effort = selected[name];
  }
  return Object.freeze({ ...selected });
}

configureAgentReasoning();

export const SKILL_EXPECTATIONS = Object.freeze({
  skill: Object.freeze({
    name: "model-router",
    required: Object.freeze(["primary model", "REQUIREMENT_EVIDENCE", "same Luna role", "Terra", "Sol", "non-PASS", "three total"])
  }),
  planning: Object.freeze({
    name: "implementation-planning",
    required: Object.freeze(["CONFIRMED", "PROPOSED", "UNKNOWN", "EVIDENCE_VERSION", "FIXED", "LOCAL_CHOICE", "FAIL_PLAN"])
  })
});
