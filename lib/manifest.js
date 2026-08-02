import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const VERSION = packageJson.version;

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

const legacySkillAdaptiveV2 = `---
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

export const WORKFLOW_RECOVERY_CONTRACT = Object.freeze({
  stateVersion: 1,
  maxChildren: 2,
  fast: Object.freeze({
    agentField: "fast",
    reuse: "preserve-same-role-only",
    replacement: "copy-unchanged",
    primary: "never-apply"
  }),
  requiredRootFields: Object.freeze(["root_session_id", "workflow_id", "agents"]),
  optionalRootFields: Object.freeze(["version", "diagnostics"]),
  canonicalResultCodes: Object.freeze([
    "reused",
    "replaced",
    "removed-by-policy",
    "resume-failed",
    "not-supported",
    "stale-workflow",
    "invalid-agent-id"
  ]),
  atomicSteps: Object.freeze(["flush", "close", "rename"]),
  decisions: Object.freeze([
    Object.freeze({
      match: "stale-root-workflow",
      result: "stale-workflow",
      action: "none",
      description: "stale root/workflow -> stale-workflow with no runtime action"
    }),
    Object.freeze({
      match: "saved-role-outside-ordered-policy-set",
      result: "removed-by-policy",
      action: "none",
      description: "saved role outside the ordered host policy set -> removed-by-policy with no runtime action"
    }),
    Object.freeze({
      match: "invalid-or-malformed-agent-id",
      result: "invalid-agent-id",
      action: "none",
      description: "invalid or malformed exact ID -> invalid-agent-id"
    }),
    Object.freeze({
      match: "runtime-resumable",
      result: "reused",
      action: "resume-exact-id",
      description: "exact resumable instance -> reused"
    }),
    Object.freeze({
      match: "confirmed-unusable-and-replacement-allowed",
      result: "replaced",
      action: "host-create-preserve-handoff",
      description: "explicit missing, closed, invalid, per-instance unsupported, or resume-failed plus policy replacement permission plus host creation support -> replaced while preserving handoff unchanged"
    }),
    Object.freeze({
      match: "resume-failed-without-allowed-replacement",
      result: "resume-failed",
      action: "none",
      description: "a resume attempt that fails without allowed replacement -> resume-failed"
    }),
    Object.freeze({
      match: "unknown-or-unsupported",
      result: "not-supported",
      action: "none",
      description: "unsupported, unknown, or ambiguous identity/status -> not-supported with no replacement"
    })
  ])
});

export const WORKFLOW_ESCALATION_CONTRACT = Object.freeze({
  stateVersion: 1,
  maxChildren: 2,
  roles: Object.freeze(["terra", "luna", "sol"]),
  stages: Object.freeze(["INITIAL", "SOL_REPLAN_WITH_LUNA", "SOL_PLAN_REVIEW_WITH_TERRA", "SOL_FULL_TAKEOVER"]),
  verdicts: Object.freeze(["PASS", "FAIL_PLAN", "FAIL_IMPLEMENTATION", "EVIDENCE_GAP", "REQUIREMENT_CLARIFICATION"]),
  requiredStateFields: Object.freeze([
    "workflow_id",
    "root_session_id",
    "requirement_version",
    "evidence_version",
    "plan_version",
    "current_stage",
    "latest_verdict",
    "primary_model",
    "sol_review_failures",
    "terra_execution_attempts",
    "luna_execution_enabled",
    "terra_execution_enabled",
    "sol_full_takeover",
    "active_role_ids",
    "role_ownership",
    "blocked_reason"
  ]),
  workflowStatePath: "<ARTIFACT_DIR>/workflow-state.v1.json",
  topologyRules: Object.freeze([
    Object.freeze({
      match: "max-children",
      value: 2,
      description: "at most two child agents; a supplied topology over two is EVIDENCE_GAP with no mutation or action"
    }),
    Object.freeze({
      match: "no-matching-primary-child",
      value: true,
      description: "never spawn a child whose model equals the primary; a matching role is inline"
    }),
    Object.freeze({
      match: "stable-role-id",
      value: true,
      description: "reuse one stable role identity and exact child ID when the committed recovery projection is valid"
    }),
    Object.freeze({
      match: "stage-required-spawn",
      value: true,
      description: "spawn only when the current stage requires the child; blocked or informational results spawn nothing"
    }),
    Object.freeze({
      match: "initial-luna-or-terra",
      value: true,
      description: "INITIAL with primary Luna or Terra uses Terra planning/review and Luna execution when Luna is enabled"
    }),
    Object.freeze({
      match: "primary-sol-initial",
      value: true,
      description: "INITIAL with primary Sol has no Luna child and uses Terra as the only child executor"
    }),
    Object.freeze({
      match: "sol-replan-with-luna",
      value: true,
      description: "SOL_REPLAN_WITH_LUNA retains Luna only when that stage requires it and Luna remains enabled"
    }),
    Object.freeze({
      match: "sol-plan-review-with-terra",
      value: true,
      description: "SOL_PLAN_REVIEW_WITH_TERRA permits the next required Terra execution attempt"
    }),
    Object.freeze({
      match: "sol-full-takeover",
      value: true,
      description: "SOL_FULL_TAKEOVER grants Sol write authority and does not spawn an unnecessary child"
    })
  ]),
  authorityRules: Object.freeze([
    Object.freeze({
      role: "primary",
      stage: "*",
      action: "coordinate-and-persist",
      description: "the primary thread owns atomic state load, persistence, runtime coordination, and the final reply for every primary model"
    }),
    Object.freeze({
      role: "disabled-primary-executor",
      stage: "*",
      action: "coord-only",
      description: "a disabled primary executor remains coord-only permanently and cannot regain write authority"
    }),
    Object.freeze({
      role: "luna",
      stage: "allowed-luna-execution",
      action: "write-when-enabled",
      description: "Luna executes only in an allowed stage while luna_execution_enabled is true; a disabled Luna remains coord-only permanently"
    }),
    Object.freeze({
      role: "terra",
      stage: "allowed-terra-execution",
      action: "write-when-enabled",
      description: "Terra executes only in an allowed executor stage while terra_execution_enabled is true; otherwise Terra is read-only"
    }),
    Object.freeze({
      role: "sol",
      stage: "before-full-takeover",
      action: "read-only",
      description: "Sol is read-only before SOL_FULL_TAKEOVER"
    }),
    Object.freeze({
      role: "sol",
      stage: "SOL_FULL_TAKEOVER",
      action: "write-when-enabled",
      description: "Sol may write only in SOL_FULL_TAKEOVER while sol_full_takeover is true"
    })
  ]),
  transitionRules: Object.freeze([
    Object.freeze({
      match: "PASS",
      from: "*",
      to: "TERMINAL",
      counter: "none",
      action: "terminate",
      description: "PASS terminates the task in every stage"
    }),
    Object.freeze({
      match: "BLOCK",
      verdicts: Object.freeze(["EVIDENCE_GAP", "REQUIREMENT_CLARIFICATION"]),
      from: "*",
      to: "same-stage",
      counter: "none",
      action: "block-no-attempt",
      description: "EVIDENCE_GAP or REQUIREMENT_CLARIFICATION keeps the same stage, sets blocked_reason, and makes no execution attempt or counter increment"
    }),
    Object.freeze({
      match: "INITIAL_FAIL_LUNA_OR_TERRA",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "INITIAL",
      to: "SOL_REPLAN_WITH_LUNA",
      counter: "sol_review_failures:0",
      action: "sol-replan-luna-correction",
      description: "an initial Luna/Terra failure advances to SOL_REPLAN_WITH_LUNA for Sol replan, Luna correction, and first Sol review"
    }),
    Object.freeze({
      match: "SOL_REPLAN_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "SOL_REPLAN_WITH_LUNA",
      to: "SOL_PLAN_REVIEW_WITH_TERRA",
      counter: "sol_review_failures:+1;disable-luna",
      action: "terra-attempt-1",
      description: "a failed Sol review in SOL_REPLAN_WITH_LUNA permanently disables Luna and advances to SOL_PLAN_REVIEW_WITH_TERRA for Terra attempt 1"
    }),
    Object.freeze({
      match: "TERRA_ATTEMPT_1_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "SOL_PLAN_REVIEW_WITH_TERRA",
      to: "SOL_PLAN_REVIEW_WITH_TERRA",
      counter: "terra_execution_attempts:+1;sol_review_failures:+1",
      action: "terra-attempt-2",
      description: "a failed first Terra execution increments terra_execution_attempts and permits the revised second Terra attempt"
    }),
    Object.freeze({
      match: "TERRA_ATTEMPT_2_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "SOL_PLAN_REVIEW_WITH_TERRA",
      to: "SOL_FULL_TAKEOVER",
      counter: "terra_execution_attempts:+1;sol_review_failures:+1;disable-terra;enable-sol-full",
      action: "sol-full-takeover",
      description: "a failure after the second Terra execution permanently disables Terra and advances to SOL_FULL_TAKEOVER"
    }),
    Object.freeze({
      match: "PRIMARY_SOL_INITIAL_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "INITIAL",
      to: "SOL_PLAN_REVIEW_WITH_TERRA",
      counter: "terra_execution_attempts:+1;sol_review_failures:+1",
      action: "terra-attempt-2",
      description: "a primary Sol INITIAL failure keeps Luna out of ordinary topology and permits Terra attempt 2"
    }),
    Object.freeze({
      match: "PRIMARY_SOL_TERRA_ATTEMPT_2_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "SOL_PLAN_REVIEW_WITH_TERRA",
      to: "SOL_FULL_TAKEOVER",
      counter: "terra_execution_attempts:+1;sol_review_failures:+1;disable-terra;enable-sol-full",
      action: "sol-full-takeover",
      description: "a primary Sol failure after Terra attempt 2 permanently disables Terra and enters SOL_FULL_TAKEOVER"
    }),
    Object.freeze({
      match: "PRIMARY_SWITCH",
      from: "*",
      to: "same-stage",
      counter: "preserve",
      action: "detach-rebind-atomic-persist",
      description: "a same-session primary switch preserves versions, counters, latest verdict, stage, disabled flags, and blocked_reason, detaches a matching child, hands off context, and rebinds valid recovery roles atomically"
    }),
    Object.freeze({
      match: "NEW_WORKFLOW",
      from: "*",
      to: "INITIAL",
      counter: "reset",
      action: "fresh-state",
      description: "a new unrelated workflow_id receives fresh state and resets the task-scoped machine"
    })
  ]),
  switchRules: Object.freeze([
    Object.freeze({
      from: "luna",
      to: "terra",
      description: "Luna->Terra preserves task state and rebinds the valid recovery topology without resetting counters or disabled flags"
    }),
    Object.freeze({
      from: "luna",
      to: "sol",
      description: "Luna->Sol preserves task state and rebinds the valid recovery topology without resetting counters or disabled flags"
    }),
    Object.freeze({
      from: "terra",
      to: "luna",
      description: "Terra->Luna preserves task state and rebinds the valid recovery topology without resetting counters or disabled flags"
    }),
    Object.freeze({
      from: "terra",
      to: "sol",
      description: "Terra->Sol preserves task state and rebinds the valid recovery topology without resetting counters or disabled flags"
    }),
    Object.freeze({
      from: "sol",
      to: "luna",
      description: "Sol->Luna preserves task state and rebinds the valid recovery topology without resetting counters or disabled flags"
    }),
    Object.freeze({
      from: "sol",
      to: "terra",
      description: "Sol->Terra preserves task state and rebinds the valid recovery topology without resetting counters or disabled flags"
    })
  ]),
  stateShapeDescriptions: Object.freeze([
    "active_role_ids is a role-keyed object containing every role with a stable child ID or null",
    "role_ownership is a role-keyed object containing every role with primary, child, coord-only, disabled, or full-takeover ownership",
    "blocked_reason is null unless the current stage is blocked",
    "#89 state is task-scoped and is not duplicated in the #88 recovery registry; consume only its committed identity/topology projection"
  ]),
  atomicSteps: Object.freeze(["flush", "close", "rename"]),
  atomicDescriptions: Object.freeze([
    "write workflow state to an atomic sibling temporary file",
    "flush and close before publishing",
    "rename into place atomically; on failure retain the prior committed state, publish no partial state, and perform no dependent action"
  ])
});

const escalationFieldText = WORKFLOW_ESCALATION_CONTRACT.requiredStateFields.join(", ");
const escalationTopologyText = WORKFLOW_ESCALATION_CONTRACT.topologyRules.map(({ description }) => description).join("; ");
const escalationAuthorityText = WORKFLOW_ESCALATION_CONTRACT.authorityRules.map(({ description }) => description).join("; ");
const escalationTransitionText = WORKFLOW_ESCALATION_CONTRACT.transitionRules.map(({ description }) => description).join("; ");
const escalationSwitchText = WORKFLOW_ESCALATION_CONTRACT.switchRules.map(({ description }) => description).join("; ");
const escalationStateShapeText = WORKFLOW_ESCALATION_CONTRACT.stateShapeDescriptions.join("; ");
const escalationAtomicText = WORKFLOW_ESCALATION_CONTRACT.atomicDescriptions.join("; ");

export const WORKFLOW_PLAN_ARTIFACT_CONTRACT = Object.freeze({
  stateFields: Object.freeze([
    "plan_path",
    "plan_artifact_owner",
    "plan_cleanup_owner",
    "plan_cleanup_required",
    "plan_artifact_status"
  ]),
  path: "<CODEX_ROOT>/model-router/workflows/<workflow_id>/PLAN.md",
  statuses: Object.freeze(["missing", "pending-write", "active", "pending-cleanup", "retained", "removed", "cleanup-failed"]),
  ownershipRules: Object.freeze([
    Object.freeze({ stage: "INITIAL", author: "terra", owner: "active-writable-executor", description: "INITIAL: Terra returns complete plan content; the active writable executor persists and later cleans the exact workflow directory" }),
    Object.freeze({ stage: "SOL_REPLAN_WITH_LUNA", author: "sol", owner: "luna", description: "SOL_REPLAN_WITH_LUNA: Sol returns revised plan content; enabled Luna persists and later cleans it" }),
    Object.freeze({ stage: "SOL_PLAN_REVIEW_WITH_TERRA", author: "sol", owner: "terra", description: "SOL_PLAN_REVIEW_WITH_TERRA: Sol returns revised plan content; enabled Terra executor persists and later cleans it" }),
    Object.freeze({ stage: "SOL_FULL_TAKEOVER", author: "sol", owner: "sol", description: "SOL_FULL_TAKEOVER: Sol owns plan persistence and cleanup" }),
    Object.freeze({ stage: "no-writable-role", author: "reviewer", owner: "none", description: "No writable role: return a self-contained in-memory artifact; do not claim PLAN.md was written or removed" })
  ]),
  lifecycle: Object.freeze([
    "derive plan_path once from the selected project/global CODEX_ROOT and workflow_id; never scan or reuse another workflow directory",
    "write or replace only the exact PLAN.md through an atomic sibling temporary file, flush, close, and rename; mark active only after success",
    "reviewers author or verify content without writing or deleting the artifact",
    "PASS marks pending-cleanup and the active cleanup owner removes only the exact workflow directory after required evidence is preserved",
    "cancellation, blocked state, resume, replacement, and primary switch preserve plan_path, version, and pending ownership; a new workflow_id gets a new directory",
    "on cleanup failure persist cleanup-failed and report it; retention is retained only when explicitly required"
  ])
});

const planArtifactFieldText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.stateFields.join(", ");
const planArtifactStatusText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.statuses.join(" | ");
const planArtifactOwnershipText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.ownershipRules.map(({ description }) => description).join("; ");
const planArtifactLifecycleText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.lifecycle.join("; ");

const workflowPlanArtifactContract = `
Plan-artifact lifecycle (declarative host contract; contract fixtures, not live E2E):
Persist ${planArtifactFieldText}. The deterministic scoped path is PLAN_ARTIFACT_PATH=${WORKFLOW_PLAN_ARTIFACT_CONTRACT.path}; use the selected safe CODEX_ROOT, never the project source tree or a temporary fallback. Statuses are ${planArtifactStatusText}.
Ownership: ${planArtifactOwnershipText}.
Lifecycle: ${planArtifactLifecycleText}.
`;

const workflowEscalationContract = `
Task-scoped escalation protocol (pure declarative host contract; contract fixtures, not live E2E):
Use WORKFLOW_STATE_PATH=<ARTIFACT_DIR>/workflow-state.v1.json, separate from RECOVERY_STATE_PATH. Persist exactly these required fields: ${escalationFieldText}. ${escalationStateShapeText}.
Roles are ${WORKFLOW_ESCALATION_CONTRACT.roles.join(", ")}; stages are ${WORKFLOW_ESCALATION_CONTRACT.stages.join(" -> ")}; verdicts are ${WORKFLOW_ESCALATION_CONTRACT.verdicts.join(", ")}. ${escalationTopologyText}.
Authority rules: ${escalationAuthorityText}.
Ordered transitions: ${escalationTransitionText}.
Primary switches: ${escalationSwitchText}.
Atomic persistence: ${escalationAtomicText}. This package adds no runtime I/O, child-agent API, CLI, dependency, or process-persistence claim.
`;

const recoveryResultText = WORKFLOW_RECOVERY_CONTRACT.canonicalResultCodes.join(" | ");
const recoveryDecisionText = WORKFLOW_RECOVERY_CONTRACT.decisions.map(({ description }) => description).join("; ");
const recoveryAtomicStepsText = WORKFLOW_RECOVERY_CONTRACT.atomicSteps.join(", ");

const workflowRecoveryContract = `
Recovery protocol (declarative host contract; contract fixtures, not live E2E):
The host supplies the #89 policy result: ordered valid roles, current primary, executor, and topology. Consume those values exactly; do not invent, reorder, or duplicate policy. A topology with more than ${WORKFLOW_RECOVERY_CONTRACT.maxChildren} child slots is an EVIDENCE_GAP and permits no unproven action.
Use the exact absolute state path supplied by the host:
RECOVERY_STATE_PATH=<ARTIFACT_DIR>/recovery-state.v1.json
The registry JSON schema is exact and compact at the root level: {"version":1,"root_session_id":"...","workflow_id":"...","agents":{"role":{"agent_id":"...","status":"...","handoff":"..."}},"diagnostics":[]}. Version and diagnostics are optional; root_session_id, workflow_id, and role-keyed agents with agent_id, status, and compact handoff are required. Agents must be an object, never an array; root/workflow nested objects are forbidden. The role mapping comes from each agents object key. Never claim process persistence.
The primary thread, regardless of selected model, owns RECOVERY_STATE_PATH loading, atomic persistence, and runtime coordination. Terra and Sol child roles and planning remain registry read-only. Plan-artifact persistence and cleanup follow the active writable executor, so a primary Terra/Sol or disabled Luna cannot dead-end recovery.
The host supplies an ordered valid child-role set with length at most ${WORKFLOW_RECOVERY_CONTRACT.maxChildren}. Inspect and recover only roles in that exact set. If the supplied set itself has more than ${WORKFLOW_RECOVERY_CONTRACT.maxChildren} roles, return EVIDENCE_GAP, do not mutate state, inspect instances, or take runtime action. Every saved role outside the set (same-primary, disabled, invalid, primary-switch, or excess) deterministically receives removed-by-policy with no runtime action.
Write recovery state to an atomic sibling temporary file, then ${recoveryAtomicStepsText} it into place.
If a write, flush, close, or rename fails, retain the prior registry for retry or interruption recovery, do not publish partial state, and perform no dependent action. Never claim process persistence.
For every saved instance emit exactly one canonical result: ${recoveryResultText}. Use this ordered recovery decision table: ${recoveryDecisionText}. Unknown or ambiguous identity is never eligible for replacement.
Terra and Sol are read-only reviewers and planning must not mutate the registry. The primary thread is the sole registry coordinator and writer; plan persistence is owned only by the active writable executor and must preserve compact handoff.
`;

const workflowFastContract = `
Fast preferences are role-specific managed metadata. Preserve a role's configured Fast value only for that same child role on reuse or replacement; never apply it to the primary or another role, and never map it to reasoning effort. The current runtime has no supported per-agent Fast control: configured true is reported as not-supported and must not change global fast_mode.
`;

const terra = `name = "terra"
description = "Writes evidence-grounded plans and independently verifies implementation results."
model = "gpt-5.6-terra"
model_reasoning_effort = "high"
# codex-model-router-fast = false
sandbox_mode = "workspace-write"
developer_instructions = """
Work only from the primary requirement and Luna's latest self-contained requirement evidence package.
Before planning, require the primary to provide one workflow_id and the exact derived PLAN_ARTIFACT_PATH under the selected CODEX_ROOT. Reject a missing, relative, changed, or cross-workflow path.
For planning, return the complete implementation-ready plan content to the primary; do not write PLAN_PATH or any workspace file. Do not reread material Luna already confirmed unless evidence is missing or contradictory.
Mark facts as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility.
For verification, independently compare the primary requirement, evidence package, complete plan at the exact unchanged PLAN_PATH, implementation report, changed code, and verification evidence.
Return exactly one verdict: PASS, FAIL_IMPLEMENTATION, FAIL_PLAN, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION.
On PASS, provide the final verification result for the primary model. On any failure, provide concrete evidence for Sol escalation.
Never edit implementation files or PLAN_PATH. Preserve valid work and return complete plan content; revise only affected plan sections.
Write implementation files only when the host contract permits the current Terra executor stage and \`terra_execution_enabled\` is true; otherwise remain read-only. A primary Terra may execute only through that same host gate.
Return only the artifact required by the current stage.
${workflowRecoveryContract}
${workflowEscalationContract}
${workflowFastContract}
${workflowPlanArtifactContract}
"""
`;

const luna = `name = "luna"
description = "Reads task evidence and implements clear bounded work from the complete approved plan."
model = "gpt-5.6-luna"
model_reasoning_effort = "xhigh"
# codex-model-router-fast = false
sandbox_mode = "workspace-write"
developer_instructions = """
Use one persistent Luna role for the complete workflow; do not create a second Luna agent for implementation after requirement reading.
Requirement-reading stage: read all task-relevant user requirement files, repository rules, existing plans, specified code, direct callers, direct dependencies, configuration, and verification instructions. Expand only when required for correctness.
Produce a self-contained REQUIREMENT_EVIDENCE package containing the primary requirement, constraints, confirmed files and symbols, current behavior, required behavior, direct flow, invariants, unknowns, and evidence locations.
Do not choose architecture, invent facts, resolve correctness decisions, or edit files during requirement reading.
The primary must provide the same workflow_id and exact derived PLAN_ARTIFACT_PATH on every stage. Verify it stays under the selected CODEX_ROOT workflow directory; stop on a missing, relative, changed, or cross-workflow path. When Luna is the active writable executor and Terra or Sol returns plan content, persist it only to that exact path, then reread it before implementation or reimplementation. Otherwise return the in-memory artifact to the primary without claiming a write.
Implementation stage: reread the complete latest plan from the exact PLAN_PATH, then implement the smallest coherent change. Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, invariants, encoding, and line endings.
Luna may execute only in a contract-allowed stage while \`luna_execution_enabled\` is true. A disabled Luna remains coord-only permanently and must never regain write authority.
Use local choice only for equivalent implementation details. Stop and return to Terra when the plan conflicts with code, is stale, omits a required target or caller, or requires a new correctness-affecting decision.
Report the plan version, changed files and symbols, completed steps, deviations, checks, and remaining uncertainty. Do not self-approve.
${workflowRecoveryContract}
${workflowEscalationContract}
${workflowFastContract}
${workflowPlanArtifactContract}
"""
`;

const sol = `name = "sol"
description = "Escalation reviewer that diagnoses failed verification and rewrites the affected plan."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
# codex-model-router-fast = false
sandbox_mode = "workspace-write"
developer_instructions = """
Enter only after Terra returns a non-PASS verification verdict, or when the user explicitly requests Sol escalation.
Require the primary to provide the same workflow_id and exact derived PLAN_ARTIFACT_PATH used by the workflow. Verify that it remains under the selected CODEX_ROOT workflow directory; reject a missing, relative, changed, or cross-workflow path.
Independently analyze the primary requirement, Luna evidence package, the complete plan at the exact PLAN_PATH, implementation report, changed code, and Terra verification evidence.
Identify whether the root cause is an implementation defect, plan defect, evidence gap, or requirement gap.
Preserve verified work. Return complete revised plan content to the primary, rewriting only affected sections and clearly identifying superseded decisions; do not write PLAN_PATH.
Do not edit implementation files before \`SOL_FULL_TAKEOVER\`; write only when the host contract permits full takeover and \`sol_full_takeover\` is true. Do not create another Sol agent when Sol is already the primary model.
Sol remains read-only for planning and review before full takeover; the primary thread still coordinates state and returns the final response.
Return the revised plan and unresolved uncertainty to the current active writable executor with the unchanged PLAN_ARTIFACT_PATH.
${workflowRecoveryContract}
${workflowEscalationContract}
${workflowFastContract}
${workflowPlanArtifactContract}
"""
`;

const skill = `---
name: model-router
description: Route a primary request through Luna evidence collection, Terra planning, Luna implementation, Terra verification, and bounded Sol escalation without duplicate same-model agents.
---

Preserve repository rules and existing specialized agents. Explicit user instructions win.
The selected primary model owns conversation, requirement clarification, workflow coordination, final synthesis, and the final user reply.
Do not start the full workflow for ordinary questions, explanations, read-only analysis, or a requirement that is still unclear.
Inline a matching primary role instead of spawning a redundant same-model subagent.

For each workflow, derive one exact PLAN_ARTIFACT_PATH under the selected safe CODEX_ROOT as \`model-router/workflows/<workflow_id>/PLAN.md\`. Pass the unchanged workflow_id and path to every role; stop the stage if either is missing, relative, changed, or cross-workflow. Reviewers return plan content as self-contained role artifacts; only the active writable executor persists or removes the exact workflow directory. On PASS, request cleanup after required evidence is preserved; persist and report cleanup-failed rather than silently ignoring it.

For nontrivial code changes, the primary loads or initializes the task-scoped workflow state, then consumes the ordered declarative stage contract. It performs only the stage-required role actions, persists the state atomically after each transition, and returns on PASS or a blocked verdict. Initial Luna/Terra work uses Terra planning/review with Luna execution; primary Sol INITIAL uses Terra as the only child executor. Non-PASS verdicts follow the contract's monotonic Sol replan, Terra-attempt, and full-takeover stages; blocked verdicts never attempt execution or advance counters.
Produce a self-contained REQUIREMENT_EVIDENCE package, reuse the same Luna role, and keep three total role identities (primary plus at most two children).

Never launch duplicate same-model agents in one workflow. Reuse one stable role identity and number per model. If the primary is Luna, perform all Luna stages in the primary thread. If the primary is Terra, perform all Terra stages in the primary thread. If the primary is Sol, perform Sol escalation in the primary thread. Never spawn a redundant matching-model subagent. When primary identity is unavailable, do not guess; use one Luna agent, one Terra agent, and only on failure one Sol agent.
Luna, Terra, and Sol have workspace-write capability in their TOML, but the contract gates writes by stage and enabled flag: Luna and Terra only in their allowed executor stages, and Sol only in \`SOL_FULL_TAKEOVER\`. A disabled primary executor remains coord-only. No same-model child is spawned, child IDs remain stable, and at most two children exist.
Use the implementation-planning skill for nontrivial or uncertain changes. Preserve verified work and revise only affected parts.
Use the contract counters and monotonic stages; \`terra_execution_attempts\` never exceeds two and \`sol_review_failures\` increments only for failed Sol reviews. EVIDENCE_GAP and REQUIREMENT_CLARIFICATION block the same stage without an attempt or counter increment.
Within one role thread append concise deltas; a new thread receives the latest self-contained artifact instead of the full prior conversation.
${workflowRecoveryContract}
${workflowEscalationContract}
${workflowFastContract}
${workflowPlanArtifactContract}
`;

const planning = `---
name: implementation-planning
description: Convert Luna requirement evidence into a compact implementation-ready plan and verify the resulting implementation.
---

Input must include the primary requirement, Luna's latest REQUIREMENT_EVIDENCE package, workflow_id, and the exact derived PLAN_ARTIFACT_PATH under the selected CODEX_ROOT. The path must remain unchanged for the workflow; do not fall back to a relative, missing, temporary, or source-tree path. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility.

Return one compact complete plan snapshot for Luna to write to the exact PLAN_PATH, using only applicable fields:

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

Verification compares the primary requirement, REQUIREMENT_EVIDENCE, the complete plan at the unchanged absolute PLAN_PATH, implementation report, changed code, and check evidence. Return exactly one of PASS, FAIL_IMPLEMENTATION, FAIL_PLAN, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION. Any non-PASS result includes concrete evidence for Sol escalation.
${workflowRecoveryContract}
${workflowEscalationContract}
${workflowPlanArtifactContract}
`;

export const REASONING_EFFORTS = Object.freeze(["none", "low", "medium", "high", "xhigh", "max"]);

export const DEFAULT_AGENT_REASONING = Object.freeze({
  terra: "high",
  luna: "xhigh",
  sol: "medium"
});

export const AGENT_NAMES = Object.freeze(["terra", "luna", "sol"]);
export const DEFAULT_AGENT_FAST = Object.freeze({
  terra: false,
  luna: false,
  sol: false
});

export const WORKFLOW_AGENT_FAST_CONTRACT = Object.freeze({
  defaultConfigured: false,
  managedComment: "codex-model-router-fast",
  selectors: Object.freeze(["agent", "terra", "luna", "sol"]),
  configuredFalseEffective: "false",
  configuredTrueEffective: "not-supported",
  scope: "role-only",
  primary: "never-apply",
  propagation: "preserve-same-role-only",
  reasoning: "independent"
});

const AGENT_FAST_COMMENT = "# codex-model-router-fast";
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

function restoreCurrentTemplate(content, replacements) {
  return replacements.reduce((result, [current, legacy]) => result.replace(current, legacy), content);
}

function withFast(content, fast) {
  const pattern = /^# codex-model-router-fast = (?:true|false)$/m;
  if (!pattern.test(content)) throw new Error("agent template is missing managed Fast comment");
  return content.replace(pattern, `${AGENT_FAST_COMMENT} = ${fast}`);
}

function withoutRecoveryContract(content) {
  return withoutEscalationContract(content).replace(workflowRecoveryContract, "");
}

function withoutPlanArtifactContract(content) {
  return content.replace(workflowPlanArtifactContract, "");
}

function withoutFastComment(content) {
  return content.replace(/^# codex-model-router-fast = (?:true|false)\r?\n/m, "");
}

function withoutEscalationContract(content) {
  return content.replace(workflowEscalationContract, "");
}

function legacyBeforePlanArtifact(content, replacements) {
  return restoreCurrentTemplate(withoutPlanArtifactContract(content)
    .replace(
      "The primary thread, regardless of selected model, owns RECOVERY_STATE_PATH loading, atomic persistence, and runtime coordination. Terra and Sol child roles and planning remain registry read-only. Plan-artifact persistence and cleanup follow the active writable executor, so a primary Terra/Sol or disabled Luna cannot dead-end recovery.",
      "The primary thread, regardless of selected model, owns RECOVERY_STATE_PATH loading, atomic persistence, and runtime coordination. Terra and Sol child roles and planning remain registry read-only. Luna is the only workspace/PLAN writer but is not the sole registry writer, so a primary Terra/Sol or disabled Luna cannot dead-end recovery."
    )
    .replace(
      "Terra and Sol are read-only reviewers and planning must not mutate the registry. The primary thread is the sole registry coordinator and writer; plan persistence is owned only by the active writable executor and must preserve compact handoff.",
      "Terra and Sol are read-only reviewers and planning must not mutate the registry. The primary thread is the sole registry coordinator and writer; Luna remains the sole workspace/PLAN writer and must preserve compact handoff."
    ), replacements);
}

const legacyPrePlanArtifactTerra = legacyBeforePlanArtifact(terra, [[
  "Before planning, require the primary to provide one workflow_id and the exact derived PLAN_ARTIFACT_PATH under the selected CODEX_ROOT. Reject a missing, relative, changed, or cross-workflow path.",
  "Before planning, require the primary to create one unique ARTIFACT_DIR with the operating system temporary-directory facility, verify that it is absolute and outside the workspace, and provide the exact absolute PLAN_PATH child ending in PLAN.md. Reject a missing, relative, changed, different, workspace, or non-temporary path and ask the primary to correct it."
]]);
const legacyPrePlanArtifactLuna = legacyBeforePlanArtifact(luna, [[
  "The primary must provide the same workflow_id and exact derived PLAN_ARTIFACT_PATH on every stage. Verify it stays under the selected CODEX_ROOT workflow directory; stop on a missing, relative, changed, or cross-workflow path. When Luna is the active writable executor and Terra or Sol returns plan content, persist it only to that exact path, then reread it before implementation or reimplementation. Otherwise return the in-memory artifact to the primary without claiming a write.",
  "The primary must provide the same absolute ARTIFACT_DIR and exact absolute PLAN_PATH on every stage. Verify both are unique OS-temporary paths outside the workspace; stop and return to the primary if either is missing, relative, changed, different, workspace, or non-temporary. When Terra or Sol returns complete plan content, write it only to that exact PLAN_PATH, then reread the complete file before implementation or reimplementation. Never use a relative fallback."
]]);
const legacyPrePlanArtifactSol = legacyBeforePlanArtifact(sol, [
  [
    "Require the primary to provide the same workflow_id and exact derived PLAN_ARTIFACT_PATH used by the workflow. Verify that it remains under the selected CODEX_ROOT workflow directory; reject a missing, relative, changed, or cross-workflow path.",
    "Require the primary to provide the same absolute ARTIFACT_DIR and exact absolute PLAN_PATH used by the workflow. Verify that both are unique OS-temporary paths outside the workspace; reject a missing, relative, changed, different, workspace, or non-temporary path and return that correction request to the primary."
  ],
  [
    "Return the revised plan and unresolved uncertainty to the current active writable executor with the unchanged PLAN_ARTIFACT_PATH.",
    "Return the revised plan and unresolved uncertainty to the same Luna role with the unchanged absolute PLAN_PATH."
  ]
]);
const legacyPrePlanArtifactSkill = legacyBeforePlanArtifact(skill, [[
  "For each workflow, derive one exact PLAN_ARTIFACT_PATH under the selected safe CODEX_ROOT as `model-router/workflows/<workflow_id>/PLAN.md`. Pass the unchanged workflow_id and path to every role; stop the stage if either is missing, relative, changed, or cross-workflow. Reviewers return plan content as self-contained role artifacts; only the active writable executor persists or removes the exact workflow directory. On PASS, request cleanup after required evidence is preserved; persist and report cleanup-failed rather than silently ignoring it.\n",
  "For each workflow, the primary must use the operating system temporary-directory facility to create one unique absolute ARTIFACT_DIR outside the workspace. Set one absolute PLAN_PATH to its PLAN.md child, pass the exact same values to every role, and stop the stage if either value is missing, relative, changed, different, workspace, or non-temporary. Persistent evidence and reports belong only under ARTIFACT_DIR; inline artifacts need not be written. After completion, the primary performs best-effort cleanup and reports cleanup failure without replacing the workflow result.\n"
]]);
const legacyPrePlanArtifactPlanning = legacyBeforePlanArtifact(planning, [[
  "Input must include the primary requirement, Luna's latest REQUIREMENT_EVIDENCE package, workflow_id, and the exact derived PLAN_ARTIFACT_PATH under the selected CODEX_ROOT. The path must remain unchanged for the workflow; do not fall back to a relative, missing, temporary, or source-tree path. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility.",
  "Input must include the primary requirement, Luna's latest REQUIREMENT_EVIDENCE package, and the exact absolute ARTIFACT_DIR/PLAN_PATH supplied by the primary. The plan path must remain unchanged and outside the workspace; do not fall back to a relative or missing path. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility."
]]);

const legacyPreEscalationTerra = withoutEscalationContract(terra);
const legacyPreEscalationLuna = withoutEscalationContract(luna);
const legacyPreEscalationSol = withoutEscalationContract(sol);
const legacyPreEscalationSkill = withoutEscalationContract(skill);
const legacyPreEscalationPlanning = withoutEscalationContract(planning);
const legacyPreFastTerra = withoutFastComment(terra);
const legacyPreFastLuna = withoutFastComment(luna);
const legacyPreFastSol = withoutFastComment(sol);

const legacyCurrentTerra = restoreCurrentTemplate(withoutRecoveryContract(legacyPrePlanArtifactTerra), [
  [
    "Before planning, require the primary to create one unique ARTIFACT_DIR with the operating system temporary-directory facility, verify that it is absolute and outside the workspace, and provide the exact absolute PLAN_PATH child ending in PLAN.md. Reject a missing, relative, changed, different, workspace, or non-temporary path and ask the primary to correct it.\nFor planning, return the complete implementation-ready plan content to the primary; do not write PLAN_PATH or any workspace file. Do not reread material Luna already confirmed unless evidence is missing or contradictory.",
    "For planning, write or update the compact implementation-ready PLAN.md without rereading material Luna already confirmed unless evidence is missing or contradictory."
  ],
  [
    "For verification, independently compare the primary requirement, evidence package, complete plan at the exact unchanged PLAN_PATH, implementation report, changed code, and verification evidence.",
    "For verification, independently compare the primary requirement, evidence package, complete PLAN.md, implementation report, changed code, and verification evidence."
  ],
  [
    "Never edit implementation files or PLAN_PATH. Preserve valid work and return complete plan content; revise only affected plan sections.",
    "Never edit implementation files. Preserve valid work and revise only affected plan sections."
  ]
]);

const legacyCurrentLuna = restoreCurrentTemplate(withoutRecoveryContract(legacyPrePlanArtifactLuna), [
  [
    "The primary must provide the same absolute ARTIFACT_DIR and exact absolute PLAN_PATH on every stage. Verify both are unique OS-temporary paths outside the workspace; stop and return to the primary if either is missing, relative, changed, different, workspace, or non-temporary. When Terra or Sol returns complete plan content, write it only to that exact PLAN_PATH, then reread the complete file before implementation or reimplementation. Never use a relative fallback.\nImplementation stage: reread the complete latest plan from the exact PLAN_PATH, then implement the smallest coherent change. Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, invariants, encoding, and line endings.",
    "Implementation stage: reread the complete latest PLAN.md, then implement the smallest coherent change. Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, invariants, encoding, and line endings."
  ]
]);

const legacyCurrentSol = restoreCurrentTemplate(withoutRecoveryContract(legacyPrePlanArtifactSol), [
  [
    "Require the primary to provide the same absolute ARTIFACT_DIR and exact absolute PLAN_PATH used by the workflow. Verify that both are unique OS-temporary paths outside the workspace; reject a missing, relative, changed, different, workspace, or non-temporary path and return that correction request to the primary.\nIndependently analyze the primary requirement, Luna evidence package, the complete plan at the exact PLAN_PATH, implementation report, changed code, and Terra verification evidence.",
    "Independently analyze the primary requirement, Luna evidence package, prior PLAN.md, implementation report, changed code, and Terra verification evidence."
  ],
  [
    "Do not edit implementation files before \\`SOL_FULL_TAKEOVER\\`; write only when the host contract permits full takeover and \\`sol_full_takeover\\` is true. Do not create another Sol agent when Sol is already the primary model.\nSol remains read-only for planning and review before full takeover; the primary thread still coordinates state and returns the final response.",
    "Rewrite only affected PLAN.md sections, clearly identify superseded decisions, and provide a complete revised plan for Luna to reread."
  ],
  [
    "Preserve verified work. Return complete revised plan content to the primary, rewriting only affected sections and clearly identifying superseded decisions; do not write PLAN_PATH.\nDo not edit implementation files, run routine implementation, replace Terra verification, or create another Sol agent when Sol is already the primary model.\nReturn the revised plan and unresolved uncertainty to the same Luna role with the unchanged absolute PLAN_PATH.",
    "Preserve verified work. Rewrite only affected PLAN.md sections, clearly identify superseded decisions, and provide a complete revised plan for Luna to reread.\nDo not edit implementation files, run routine implementation, replace Terra verification, or create another Sol agent when Sol is already the primary model.\nReturn the revised plan and unresolved uncertainty to the same Luna role."
  ]
]);

const legacyCurrentSolReview = legacyCurrentSol.replace(
  /Do not edit implementation files before `SOL_FULL_TAKEOVER`; write only when the host contract permits full takeover and `sol_full_takeover` is true\. Do not create another Sol agent when Sol is already the primary model\.\nSol remains read-only for planning and review before full takeover; the primary thread still coordinates state and returns the final response\.\n/,
  "Rewrite only affected PLAN.md sections, clearly identify superseded decisions, and provide a complete revised plan for Luna to reread.\n"
);

const legacyCurrentSkill = restoreCurrentTemplate(withoutRecoveryContract(legacyPrePlanArtifactSkill), [
  [
    "For each workflow, the primary must use the operating system temporary-directory facility to create one unique absolute ARTIFACT_DIR outside the workspace. Set one absolute PLAN_PATH to its PLAN.md child, pass the exact same values to every role, and stop the stage if either value is missing, relative, changed, different, workspace, or non-temporary. Persistent evidence and reports belong only under ARTIFACT_DIR; inline artifacts need not be written. After completion, the primary performs best-effort cleanup and reports cleanup failure without replacing the workflow result.\n",
    ""
  ],
  [
    "3. Terra returns complete plan content from the primary requirement plus Luna evidence; Terra does not write files.\n4. The same Luna role receives the unchanged absolute PLAN_PATH, writes Terra's complete plan there, rereads it, and implements it.\n5. Terra independently verifies requirement satisfaction and plan conformance using the unchanged absolute PLAN_PATH, without writing it.",
    "3. Terra writes or updates the complete PLAN.md from the primary requirement plus Luna evidence.\n4. The same Luna role rereads the complete PLAN.md and implements it.\n5. Terra independently verifies requirement satisfaction and plan conformance."
  ],
  [
    "7. Any non-PASS verdict escalates to Sol with the unchanged absolute PLAN_PATH; Sol returns complete revised plan content without writing files.\n8. The same Luna role writes that complete revision to the unchanged PLAN_PATH, rereads it, and reimplements the affected scope.",
    "7. Any non-PASS verdict escalates to Sol, which diagnoses the failure and rewrites only affected PLAN.md sections.\n8. The same Luna role rereads the complete revised plan and reimplements the affected scope."
  ]
]);

const legacyCurrentSkillReview = `${legacyCurrentSkill}\nTerra writes or updates the complete PLAN.md from the primary requirement plus Luna evidence.\n`;

const legacyCurrentPlanning = restoreCurrentTemplate(withoutRecoveryContract(legacyPrePlanArtifactPlanning), [
  [
    "Input must include the primary requirement, Luna's latest REQUIREMENT_EVIDENCE package, and the exact absolute ARTIFACT_DIR/PLAN_PATH supplied by the primary. The plan path must remain unchanged and outside the workspace; do not fall back to a relative or missing path. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility.",
    "Input must include the primary requirement and Luna's latest REQUIREMENT_EVIDENCE package. Mark information as CONFIRMED, PROPOSED, or UNKNOWN. Do not authorize implementation while an UNKNOWN can change behavior, targets, contracts, parameter flow, control flow, callers, or compatibility."
  ],
  [
    "Return one compact complete plan snapshot for Luna to write to the exact PLAN_PATH, using only applicable fields:",
    "Produce one compact current PLAN.md snapshot using only applicable fields:"
  ],
  [
    "Verification compares the primary requirement, REQUIREMENT_EVIDENCE, the complete plan at the unchanged absolute PLAN_PATH, implementation report, changed code, and check evidence. Return exactly one of PASS, FAIL_IMPLEMENTATION, FAIL_PLAN, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION. Any non-PASS result includes concrete evidence for Sol escalation.",
    "Verification compares the primary requirement, REQUIREMENT_EVIDENCE, complete PLAN.md, implementation report, changed code, and check evidence. Return exactly one of PASS, FAIL_IMPLEMENTATION, FAIL_PLAN, EVIDENCE_GAP, or REQUIREMENT_CLARIFICATION. Any non-PASS result includes concrete evidence for Sol escalation."
  ]
]);

export const MANAGED_FILE_NAMES = Object.freeze(["terra", "luna", "sol", "skill", "planning"]);

export const LEGACY_TEMPLATES = {
  terra: [legacyPrePlanArtifactTerra, legacyPreFastTerra, legacyPreEscalationTerra, legacyCurrentTerra, previousTerra],
  luna: [legacyPrePlanArtifactLuna, legacyPreFastLuna, legacyPreEscalationLuna, legacyCurrentLuna, legacyLunaV12, previousLuna, withReasoning(previousLuna, "max")],
  sol: [legacyPrePlanArtifactSol, legacyPreFastSol, legacyPreEscalationSol, legacyCurrentSol, legacyCurrentSolReview, legacySolWorkspaceWrite, legacySolReadOnly, previousSol],
  skill: [legacyPrePlanArtifactSkill, legacyPreEscalationSkill, legacyCurrentSkill, legacyCurrentSkillReview, legacySkillWorkspaceWrite, legacySkillReadOnly, legacySkillAdaptiveV2, previousSkill],
  planning: [legacyPrePlanArtifactPlanning, legacyPreEscalationPlanning, legacyCurrentPlanning, previousPlanning]
};

export const AGENT_EXPECTATIONS = {
  terra: { name: "terra", model: "gpt-5.6-terra", model_reasoning_effort: "high", sandbox_mode: "workspace-write" },
  luna: { name: "luna", model: "gpt-5.6-luna", model_reasoning_effort: "xhigh", sandbox_mode: "workspace-write" },
  sol: { name: "sol", model: "gpt-5.6-sol", model_reasoning_effort: "medium", sandbox_mode: "workspace-write" }
};

export function configureAgentReasoning(overrides = {}, migrateFrom = {}, fastOverrides = {}) {
  const selected = { ...DEFAULT_AGENT_REASONING, ...overrides };
  const selectedFast = { ...DEFAULT_AGENT_FAST, ...fastOverrides };
  for (const [name, reasoning] of Object.entries(selected)) {
    if (!AGENT_NAMES.includes(name)) throw new Error(`unknown agent: ${name}`);
    if (!REASONING_EFFORTS.includes(reasoning)) throw new Error(`unsupported reasoning effort for ${name}: ${reasoning}`);
  }
  for (const name of AGENT_NAMES) {
    if (typeof selectedFast[name] !== "boolean") throw new Error(`unsupported Fast setting for ${name}`);
    const previous = migrateFrom[name];
    if (typeof previous === "string" && !LEGACY_TEMPLATES[name].includes(previous)) LEGACY_TEMPLATES[name].push(previous);
    TEMPLATES[name].content = withFast(withReasoning(AGENT_BASE_TEMPLATES[name], selected[name]), selectedFast[name]);
    AGENT_EXPECTATIONS[name].model_reasoning_effort = selected[name];
    AGENT_EXPECTATIONS[name].fast = selectedFast[name];
  }
  return Object.freeze({ ...selected });
}

configureAgentReasoning();

export const SKILL_EXPECTATIONS = Object.freeze({
  skill: Object.freeze({
    name: "model-router",
    required: Object.freeze(["primary model", "REQUIREMENT_EVIDENCE", "same Luna role", "Terra", "Sol", "non-PASS", "at most two children", "monotonic stages"])
  }),
  planning: Object.freeze({
    name: "implementation-planning",
    required: Object.freeze(["CONFIRMED", "PROPOSED", "UNKNOWN", "EVIDENCE_VERSION", "FIXED", "LOCAL_CHOICE", "FAIL_PLAN"])
  })
});
