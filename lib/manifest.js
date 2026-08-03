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
  retainedRoleRules: Object.freeze([
    Object.freeze({
      role: "luna",
      identity: "luna_role_id",
      description: "A valid same-workflow Luna ID remains reusable after demotion to INTERACTION_ONLY; mode changes do not remove identity"
    }),
    Object.freeze({
      scope: "same-root-workflow",
      description: "Do not bind a saved Luna identity to a new workflow, root session, or cross-workspace task"
    })
  ]),
  decisions: Object.freeze([
    Object.freeze({
      match: "stale-root-workflow",
      result: "stale-workflow",
      action: "none",
      description: "stale workflow -> stale-workflow"
    }),
    Object.freeze({
      match: "saved-role-outside-ordered-policy-set",
      result: "removed-by-policy",
      action: "none",
      description: "role outside the supplied policy -> removed-by-policy"
    }),
    Object.freeze({
      match: "invalid-or-malformed-agent-id",
      result: "invalid-agent-id",
      action: "none",
      description: "malformed agent ID -> invalid-agent-id"
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
      description: "host-confirmed unusable instance with allowed replacement -> replaced and handoff preserved"
    }),
    Object.freeze({
      match: "resume-failed-without-allowed-replacement",
      result: "resume-failed",
      action: "none",
      description: "resume failure without replacement -> resume-failed"
    }),
    Object.freeze({
      match: "unknown-or-unsupported",
      result: "not-supported",
      action: "none",
      description: "unknown or ambiguous identity -> not-supported"
    })
  ])
});

export const WORKFLOW_LUNA_INTERACTION_CONTRACT = Object.freeze({
  modes: Object.freeze(["ACTIVE_EXECUTOR", "INTERACTION_ONLY", "DETACHED"]),
  modeByStage: Object.freeze({
    INITIAL: "ACTIVE_EXECUTOR",
    SOL_REPLAN_WITH_LUNA: "ACTIVE_EXECUTOR",
    SOL_PLAN_REVIEW_WITH_TERRA: "INTERACTION_ONLY",
    SOL_FULL_TAKEOVER: "INTERACTION_ONLY"
  }),
  actionPolicy: Object.freeze({
    safeInspection: Object.freeze([
      "filesystem-inspect",
      "file-metadata",
      "encoding-inspect",
      "hash-compare",
      "text-search",
      "code-search",
      "dependency-inspect",
      "syntax-check",
      "type-check",
      "lint-check",
      "format-check-only",
      "git-inspect",
      "cvs-inspect",
      "github-inspect",
      "ci-inspect",
      "artifact-inspect",
      "archive-inspect",
      "process-inspect",
      "port-inspect",
      "http-read",
      "database-read",
      "docker-inspect",
      "kubernetes-inspect",
      "cloud-inspect",
      "log-collect",
      "log-summarize",
      "checksum"
    ]),
    stageAuthorized: Object.freeze([
      "test-run",
      "coverage-run",
      "benchmark-run",
      "build-run",
      "package-script-run",
      "package-dry-run",
      "container-test",
      "browser-test",
      "api-test",
      "isolated-dependency-install",
      "test-database-create",
      "test-fixture-write",
      "temporary-write",
      "temporary-cleanup",
      "artifact-download",
      "artifact-package",
      "report-write",
      "dev-server-start",
      "dev-server-stop",
      "rollback-evidence-capture",
      "rollback-selective"
    ]),
    userApproval: Object.freeze([
      "dependency-change",
      "lockfile-change",
      "git-fetch",
      "git-stage",
      "git-commit",
      "git-push",
      "git-branch-write",
      "git-history-write",
      "cvs-update",
      "github-write",
      "package-publish",
      "artifact-upload",
      "deployment",
      "database-write",
      "cache-write",
      "service-restart",
      "cloud-resource-write",
      "configuration-write",
      "permission-change"
    ]),
    forbiddenInInteractionOnly: Object.freeze([
      "source-write",
      "plan-write",
      "architecture-decision",
      "requirement-decision",
      "self-approval",
      "secret-output",
      "permission-escalation",
      "destructive-git",
      "unscoped-delete",
      "production-delete",
      "production-data-reset",
      "unapproved-publish",
      "unapproved-deploy"
    ])
  }),
  resultFields: Object.freeze([
    "action",
    "command",
    "cwd",
    "exit_code",
    "duration_ms",
    "summary",
    "evidence",
    "artifact_refs",
    "redactions"
  ])
});

export const WORKFLOW_ROLLBACK_CONTRACT = Object.freeze({
  stateVersion: 1,
  failureClasses: Object.freeze([
    "CORRECTABLE",
    "SCOPE_VIOLATION",
    "WORKSPACE_POLLUTION",
    "WORKSPACE_CORRUPTION",
    "DEPENDENCY_CORRUPTION",
    "EXTERNAL_SIDE_EFFECT",
    "SECURITY_RISK",
    "UNKNOWN_STATE"
  ]),
  policies: Object.freeze([
    "NONE",
    "SELECTIVE",
    "FULL_WORKSPACE",
    "EXTERNAL_SYSTEM",
    "ISOLATE_AND_ROLLBACK",
    "BLOCK_AND_ESCALATE"
  ]),
  statuses: Object.freeze([
    "NOT_REQUIRED",
    "CLASSIFICATION_REQUIRED",
    "CLASSIFIED",
    "EVIDENCE_CAPTURED",
    "PENDING_AUTHORIZATION",
    "READY",
    "EXECUTING",
    "COMPLETED",
    "PARTIAL",
    "FAILED",
    "BLOCKED",
    "WAIVED",
    "STALE_TARGET"
  ]),
  defaultPolicies: Object.freeze({
    CORRECTABLE: "NONE",
    SCOPE_VIOLATION: "SELECTIVE",
    WORKSPACE_POLLUTION: "SELECTIVE",
    WORKSPACE_CORRUPTION: "BLOCK_AND_ESCALATE",
    DEPENDENCY_CORRUPTION: "BLOCK_AND_ESCALATE",
    EXTERNAL_SIDE_EFFECT: "EXTERNAL_SYSTEM",
    SECURITY_RISK: "ISOLATE_AND_ROLLBACK",
    UNKNOWN_STATE: "BLOCK_AND_ESCALATE"
  }),
  classificationRules: Object.freeze([
    Object.freeze({ failureClass: "CORRECTABLE", policy: "NONE", safeToContinue: true, description: "preserve valid work and evidence, then continue with an incremental correction" }),
    Object.freeze({ failureClass: "SCOPE_VIOLATION", policy: "SELECTIVE", safeToContinue: true, description: "revert only exact unauthorized or unrelated targets after evidence capture" }),
    Object.freeze({ failureClass: "WORKSPACE_POLLUTION", policy: "SELECTIVE", safeToContinue: true, description: "remove only known generated artifacts; unknown untracked files are never deleted automatically" }),
    Object.freeze({ failureClass: "WORKSPACE_CORRUPTION", policy: "FULL_WORKSPACE", safeToContinue: false, description: "full workspace rollback requires an exact trusted checkpoint and proof that unrelated work is preserved; otherwise BLOCK_AND_ESCALATE" }),
    Object.freeze({ failureClass: "DEPENDENCY_CORRUPTION", policy: "BLOCK_AND_ESCALATE", safeToContinue: false, description: "lockfile, package metadata, and toolchain evidence determine selective or full recovery; reinstall is not rollback by default" }),
    Object.freeze({ failureClass: "EXTERNAL_SIDE_EFFECT", policy: "EXTERNAL_SYSTEM", safeToContinue: false, description: "use an explicit system-specific compensating action; local source restoration does not undo an external mutation" }),
    Object.freeze({ failureClass: "SECURITY_RISK", policy: "ISOLATE_AND_ROLLBACK", safeToContinue: false, description: "stop normal writes, preserve redacted evidence, isolate the unsafe state, and require Sol or user authorization" }),
    Object.freeze({ failureClass: "UNKNOWN_STATE", policy: "BLOCK_AND_ESCALATE", safeToContinue: false, description: "block when changed scope, workspace safety, external completion, unrelated work, or a trusted checkpoint cannot be proven" })
  ]),
  targetRules: Object.freeze([
    Object.freeze({ target: "selective", description: "each target requires an exact identity and pre-rollback hash; a changed target becomes STALE_TARGET and receives no action" }),
    Object.freeze({ target: "generated-artifact", description: "only known generated logs, caches, coverage, archives, build output, temporary fixtures, or test files may be removed" }),
    Object.freeze({ target: "unknown-untracked", description: "unknown untracked files are preserved and never deleted automatically" }),
    Object.freeze({ target: "full-workspace", description: "FULL_WORKSPACE requires a trusted checkpoint and proof that unrelated user work is preserved" }),
    Object.freeze({ target: "external", description: "EXTERNAL_SYSTEM requires a system-specific compensating action and cannot be satisfied by restoring local files" })
  ]),
  sequencingRules: Object.freeze([
    "capture failure evidence and the pre-rollback state before any rollback action",
    "classify every FAIL_PLAN or FAIL_IMPLEMENTATION before the next mutable action",
    "rollback completion never converts a failed verification into PASS",
    "mandatory rollback blocks normal stage advancement until completed, explicitly waived, or escalated",
    "rollback failure or partial completion blocks advancement and never produces PASS",
    "rollback state, evidence references, target identity, and result are persisted atomically"
  ]),
  verdictRules: Object.freeze([
    "PASS normally requires no rollback classification",
    "FAIL_PLAN and FAIL_IMPLEMENTATION require classification before the next mutable action",
    "EVIDENCE_GAP and REQUIREMENT_CLARIFICATION remain blocking and do not automatically trigger rollback",
    "an immediate safety risk may suspend the normal escalation transition and enter rollback handling"
  ]),
  transitionRules: Object.freeze([
    Object.freeze({
      match: "FAIL_VERDICT",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      to: "CLASSIFICATION_REQUIRED",
      action: "capture-evidence-before-mutation",
      description: "a failed verification enters classification before the next mutable action"
    }),
    Object.freeze({
      match: "CORRECTABLE",
      policy: "NONE",
      to: "EXISTING_ESCALATION",
      action: "incremental-correction",
      description: "CORRECTABLE preserves the current diff and follows the existing escalation path"
    }),
    Object.freeze({
      match: "SELECTIVE_REQUIRED",
      policy: "SELECTIVE",
      to: "ROLLBACK_REQUIRED",
      action: "exact-target-after-evidence",
      description: "SELECTIVE rollback requires exact targets, pre-state evidence, and an approved action"
    }),
    Object.freeze({
      match: "MANDATORY_ROLLBACK",
      policies: Object.freeze(["FULL_WORKSPACE", "EXTERNAL_SYSTEM", "ISOLATE_AND_ROLLBACK"]),
      to: "ROLLBACK_REQUIRED",
      action: "block-normal-advancement",
      description: "mandatory rollback blocks normal stage advancement until completed, waived, or escalated"
    }),
    Object.freeze({
      match: "ROLLBACK_COMPLETED",
      to: "REVERIFY_SAME_FAILURE",
      action: "reverify",
      description: "rollback completion requires re-verification and never changes a failed verdict into PASS"
    }),
    Object.freeze({
      match: "ROLLBACK_FAILED_OR_PARTIAL",
      statuses: Object.freeze(["FAILED", "PARTIAL", "STALE_TARGET"]),
      to: "BLOCK_AND_ESCALATE",
      action: "stop-no-pass",
      description: "failed, partial, or stale rollback blocks advancement and cannot produce PASS"
    })
  ]),
  authorityRules: Object.freeze([
    Object.freeze({ role: "primary", action: "coordinate-classify-persist", description: "the primary coordinates classification, evidence capture, atomic state, and final routing but does not self-approve its own destructive rollback" }),
    Object.freeze({ role: "luna", action: "execute-approved-selective", description: "Luna may execute an already approved exact SELECTIVE rollback or evidence capture; Luna cannot choose policy, target unknown files, or self-approve" }),
    Object.freeze({ role: "terra", action: "verify-selective", description: "Terra independently verifies the post-rollback state and selective target scope" }),
    Object.freeze({ role: "sol", action: "handle-high-risk", description: "Sol handles ambiguous, high-risk, external, FULL_WORKSPACE, security, and failed rollback cases" }),
    Object.freeze({ role: "user-or-host", action: "approve-destructive-or-external", description: "destructive, full-workspace, external, deployment, production, or security isolation actions require explicit approval and system-specific authority" })
  ]),
  stateFields: Object.freeze([
    "rollback_class",
    "rollback_policy",
    "rollback_status",
    "rollback_target_hash",
    "rollback_checkpoint_id",
    "rollback_authority",
    "rollback_evidence_refs",
    "rollback_result",
    "rollback_attempts"
  ]),
  classificationResultFields: Object.freeze([
    "failure_class",
    "rollback_policy",
    "rationale",
    "safe_to_continue",
    "external_side_effect",
    "target_scope",
    "pre_state_hash",
    "evidence_refs"
  ]),
  resultFields: Object.freeze([
    "policy",
    "status",
    "target_refs",
    "pre_state_hash",
    "post_state_hash",
    "checkpoint_id",
    "evidence_refs",
    "compensating_action",
    "partial",
    "summary",
    "redactions"
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
    "luna_mode",
    "luna_role_id",
    "luna_context_version",
    "luna_workspace",
    "luna_allowed_actions",
    "luna_stage_authorized_actions",
    "luna_user_approval_actions",
    "luna_forbidden_actions",
    "terra_execution_enabled",
    "sol_full_takeover",
    "active_role_ids",
    "role_ownership",
    "blocked_reason",
    "rollback_class",
    "rollback_policy",
    "rollback_status",
    "rollback_target_hash",
    "rollback_checkpoint_id",
    "rollback_authority",
    "rollback_evidence_refs",
    "rollback_result",
    "rollback_attempts"
  ]),
  lunaModes: WORKFLOW_LUNA_INTERACTION_CONTRACT.modes,
  lunaModeByStage: WORKFLOW_LUNA_INTERACTION_CONTRACT.modeByStage,
  lunaActionPolicy: WORKFLOW_LUNA_INTERACTION_CONTRACT.actionPolicy,
  lunaInteractionResultFields: WORKFLOW_LUNA_INTERACTION_CONTRACT.resultFields,
  rollbackStateFields: WORKFLOW_ROLLBACK_CONTRACT.stateFields,
  rollbackPolicies: WORKFLOW_ROLLBACK_CONTRACT.policies,
  rollbackStatuses: WORKFLOW_ROLLBACK_CONTRACT.statuses,
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
      match: "initial-universal-flow",
      value: true,
      description: "INITIAL uses Terra planning/review and enabled Luna reading/execution; matching primary work stays inline"
    }),
    Object.freeze({
      match: "sol-replan-with-luna",
      value: true,
      description: "SOL_REPLAN_WITH_LUNA uses enabled Luna for correction"
    }),
    Object.freeze({
      match: "sol-plan-review-with-terra",
      value: true,
      description: "SOL_PLAN_REVIEW_WITH_TERRA uses Terra for execution attempts and retains Luna as INTERACTION_ONLY"
    }),
    Object.freeze({
      match: "sol-full-takeover",
      value: true,
      description: "SOL_FULL_TAKEOVER gives Sol write authority while retaining the same Luna role as an INTERACTION_ONLY child when topology permits"
    }),
    Object.freeze({
      match: "luna-mode-by-stage",
      value: true,
      description: "Luna is ACTIVE_EXECUTOR in INITIAL and SOL_REPLAN_WITH_LUNA, then demotes monotonically to INTERACTION_ONLY in SOL_PLAN_REVIEW_WITH_TERRA and SOL_FULL_TAKEOVER"
    }),
    Object.freeze({
      match: "full-takeover-no-terra-executor",
      value: true,
      description: "SOL_FULL_TAKEOVER never restores Terra as an executor; Terra may remain primary coordination-only while Sol owns implementation"
    })
  ]),
  authorityRules: Object.freeze([
    Object.freeze({
      role: "primary",
      stage: "*",
      action: "coordinate-and-persist",
      description: "the primary thread coordinates state, persistence, and the final reply"
    }),
    Object.freeze({
      role: "disabled-primary-executor",
      stage: "*",
      action: "coord-only",
      description: "a disabled primary executor remains coordination-only"
    }),
    Object.freeze({
      role: "luna",
      stage: "allowed-luna-execution",
      action: "write-when-enabled",
      description: "Luna in ACTIVE_EXECUTOR writes only in an allowed stage; luna_mode, not the migration flag, is the runtime authority"
    }),
    Object.freeze({
      role: "luna",
      stage: "INTERACTION_ONLY",
      action: "bounded-interaction-only",
      description: "Luna in INTERACTION_ONLY cannot write source or PLAN, decide architecture or requirements, self-approve, or repair independently; it may run only host-authorized action IDs"
    }),
    Object.freeze({
      role: "terra",
      stage: "allowed-terra-execution",
      action: "write-when-enabled",
      description: "Terra writes only in an allowed executor stage while enabled"
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
      description: "Sol writes only in SOL_FULL_TAKEOVER"
    })
  ]),
  transitionRules: Object.freeze([
    Object.freeze({
      match: "PASS",
      from: "*",
      to: "TERMINAL",
      counter: "none",
      action: "terminate",
      description: "PASS ends the workflow in any stage"
    }),
    Object.freeze({
      match: "BLOCK",
      verdicts: Object.freeze(["EVIDENCE_GAP", "REQUIREMENT_CLARIFICATION"]),
      from: "*",
      to: "same-stage",
      counter: "none",
      action: "block-no-attempt",
      description: "Blocking verdicts keep the stage and do not consume an attempt"
    }),
    Object.freeze({
      match: "INITIAL_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "INITIAL",
      to: "SOL_REPLAN_WITH_LUNA",
      counter: "sol_review_failures:0",
      action: "sol-replan-luna-correction",
      lunaMode: "ACTIVE_EXECUTOR",
      description: "An INITIAL failure moves to Sol replan with Luna correction"
    }),
    Object.freeze({
      match: "SOL_REPLAN_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "SOL_REPLAN_WITH_LUNA",
      to: "SOL_PLAN_REVIEW_WITH_TERRA",
      counter: "sol_review_failures:+1;disable-luna",
      action: "terra-attempt-1",
      lunaMode: "INTERACTION_ONLY",
      description: "A failed Sol review demotes Luna to INTERACTION_ONLY and moves to Terra execution without removing Luna identity"
    }),
    Object.freeze({
      match: "TERRA_ATTEMPT_1_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "SOL_PLAN_REVIEW_WITH_TERRA",
      to: "SOL_PLAN_REVIEW_WITH_TERRA",
      counter: "terra_execution_attempts:+1;sol_review_failures:+1",
      action: "terra-attempt-2",
      description: "A failed first Terra attempt permits the second attempt"
    }),
    Object.freeze({
      match: "TERRA_ATTEMPT_2_FAIL",
      verdicts: Object.freeze(["FAIL_PLAN", "FAIL_IMPLEMENTATION"]),
      from: "SOL_PLAN_REVIEW_WITH_TERRA",
      to: "SOL_FULL_TAKEOVER",
      counter: "terra_execution_attempts:+1;sol_review_failures:+1;disable-terra;enable-sol-full",
      action: "sol-full-takeover",
      lunaMode: "INTERACTION_ONLY",
      description: "A failed second Terra attempt disables Terra, starts Sol takeover, and retains Luna as an interaction worker"
    }),
    Object.freeze({
      match: "PRIMARY_SWITCH",
      from: "*",
      to: "same-stage",
      counter: "preserve",
      action: "detach-rebind-atomic-persist",
      description: "A same-task primary switch preserves state and rebinds valid roles"
    }),
    Object.freeze({
      match: "NEW_WORKFLOW",
      from: "*",
      to: "INITIAL",
      counter: "reset",
      action: "fresh-state",
      lunaMode: "ACTIVE_EXECUTOR",
      description: "A new workflow starts with fresh task state"
    })
  ]),
  switchRules: Object.freeze([
    Object.freeze({
      from: "luna",
      to: "terra",
      description: "A primary switch preserves state and rebinds valid roles"
    }),
    Object.freeze({
      from: "luna",
      to: "sol",
      description: "A primary switch preserves state and rebinds valid roles"
    }),
    Object.freeze({
      from: "terra",
      to: "luna",
      description: "A primary switch preserves state and rebinds valid roles"
    }),
    Object.freeze({
      from: "terra",
      to: "sol",
      description: "A primary switch preserves state and rebinds valid roles"
    }),
    Object.freeze({
      from: "sol",
      to: "luna",
      description: "A primary switch preserves state and rebinds valid roles"
    }),
    Object.freeze({
      from: "sol",
      to: "terra",
      description: "A primary switch preserves state and rebinds valid roles"
    })
  ]),
  stateShapeDescriptions: Object.freeze([
    "active_role_ids maps each role to a stable child ID or null",
    "role_ownership records primary, child, interaction-only, coordination-only, disabled, or takeover ownership",
    "luna_role_id, luna_workspace, mode, context version, and action policy are persisted with workflow state",
    "luna_mode demotion is monotonic; ACTIVE_EXECUTOR may become INTERACTION_ONLY but does not regain source authority implicitly",
    "NEW_WORKFLOW clears the prior Luna ID, workspace, context, and action policy before a fresh host binding",
    "rollback classification and rollback result are task-scoped state; recovery identity/topology remains separate",
    "blocked_reason is set only for a blocked stage",
    "workflow state is task-scoped; recovery stores only committed identity and topology"
  ]),
  atomicSteps: Object.freeze(["flush", "close", "rename"]),
  atomicDescriptions: Object.freeze([
    "write to a sibling temporary file",
    "flush and close before publish",
    "rename atomically; on failure retain prior state and take no dependent action"
  ])
});

const escalationFieldText = WORKFLOW_ESCALATION_CONTRACT.requiredStateFields.join(", ");
const escalationTopologyText = WORKFLOW_ESCALATION_CONTRACT.topologyRules.map(({ description }) => description).join("; ");
const escalationAuthorityText = WORKFLOW_ESCALATION_CONTRACT.authorityRules.map(({ description }) => description).join("; ");
const escalationTransitionText = WORKFLOW_ESCALATION_CONTRACT.transitionRules.map(({ description }) => description).join("; ");
const escalationSwitchText = "A primary switch preserves state and rebinds valid roles; preserve versions, counters, stage, verdict, disabled flags, and ownership; detach a matching child and rebind valid roles atomically";
const escalationStateShapeText = WORKFLOW_ESCALATION_CONTRACT.stateShapeDescriptions.join("; ");
const escalationAtomicText = WORKFLOW_ESCALATION_CONTRACT.atomicDescriptions.join("; ");
const lunaActionPolicyText = Object.entries(WORKFLOW_LUNA_INTERACTION_CONTRACT.actionPolicy)
  .map(([category, actions]) => `${category}: ${actions.join(", ")}`)
  .join("; ");
const lunaModeByStageText = Object.entries(WORKFLOW_LUNA_INTERACTION_CONTRACT.modeByStage)
  .map(([stage, mode]) => `${stage}=${mode}`)
  .join(", ");
const lunaResultFieldText = WORKFLOW_LUNA_INTERACTION_CONTRACT.resultFields.join(", ");
const rollbackFailureClassText = WORKFLOW_ROLLBACK_CONTRACT.failureClasses.join(" | ");
const rollbackPolicyText = WORKFLOW_ROLLBACK_CONTRACT.policies.join(" | ");
const rollbackStatusText = WORKFLOW_ROLLBACK_CONTRACT.statuses.join(" | ");
const rollbackClassificationText = WORKFLOW_ROLLBACK_CONTRACT.classificationRules.map(({ failureClass, policy, description }) => `${failureClass}=${policy}: ${description}`).join("; ");
const rollbackTargetText = WORKFLOW_ROLLBACK_CONTRACT.targetRules.map(({ description }) => description).join("; ");
const rollbackSequencingText = WORKFLOW_ROLLBACK_CONTRACT.sequencingRules.join("; ");
const rollbackVerdictText = WORKFLOW_ROLLBACK_CONTRACT.verdictRules.join("; ");
const rollbackTransitionText = WORKFLOW_ROLLBACK_CONTRACT.transitionRules.map(({ description }) => description).join("; ");
const rollbackAuthorityText = WORKFLOW_ROLLBACK_CONTRACT.authorityRules.map(({ description }) => description).join("; ");
const rollbackStateFieldText = WORKFLOW_ROLLBACK_CONTRACT.stateFields.join(", ");
const rollbackClassificationFieldText = WORKFLOW_ROLLBACK_CONTRACT.classificationResultFields.join(", ");
const rollbackResultFieldText = WORKFLOW_ROLLBACK_CONTRACT.resultFields.join(", ");

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
    Object.freeze({ stage: "INITIAL", author: "terra", owner: "active-writable-executor", description: "INITIAL: Terra supplies the plan; the current writable executor stores it and owns cleanup" }),
    Object.freeze({ stage: "SOL_REPLAN_WITH_LUNA", author: "sol", owner: "luna", description: "SOL_REPLAN_WITH_LUNA: Sol supplies the revision; ACTIVE_EXECUTOR Luna stores it and owns cleanup" }),
    Object.freeze({ stage: "SOL_PLAN_REVIEW_WITH_TERRA", author: "sol", owner: "terra", description: "SOL_PLAN_REVIEW_WITH_TERRA: Sol supplies the revision; active Terra executor stores it and owns cleanup" }),
    Object.freeze({ stage: "SOL_FULL_TAKEOVER", author: "sol", owner: "sol", description: "SOL_FULL_TAKEOVER: Sol stores and cleans the plan" }),
    Object.freeze({ stage: "no-writable-role", author: "reviewer", owner: "none", description: "No writable role: keep an in-memory artifact and make no file-write claim" })
  ]),
  lifecycle: Object.freeze([
    "Use one plan_path under CODEX_ROOT/model-router/workflows/<workflow_id>; never use the source tree or another workflow",
    "Only the active writable executor atomically writes or replaces PLAN.md; reviewers return content",
    "PASS marks pending-cleanup and the same owner removes the exact workflow directory",
    "Blocked work, resume, replacement, and primary switch preserve path, version, and owner",
    "Cleanup failure becomes cleanup-failed; retained is used only when required"
  ])
});

const planArtifactFieldText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.stateFields.join(", ");
const planArtifactStatusText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.statuses.join(" | ");
const planArtifactOwnershipText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.ownershipRules.map(({ description }) => description).join("; ");
const planArtifactLifecycleText = WORKFLOW_PLAN_ARTIFACT_CONTRACT.lifecycle.join("; ");

const workflowPlanArtifactContract = `
Plan artifact (declarative host contract; no runtime file API):
Persist ${planArtifactFieldText}. Use PLAN_ARTIFACT_PATH=${WORKFLOW_PLAN_ARTIFACT_CONTRACT.path}; statuses are ${planArtifactStatusText}.
Ownership: ${planArtifactOwnershipText}.
Lifecycle: ${planArtifactLifecycleText}.
`;

const workflowEscalationContract = `
Workflow escalation (declarative host contract; no runtime API):
Use WORKFLOW_STATE_PATH=<ARTIFACT_DIR>/workflow-state.v1.json, separate from RECOVERY_STATE_PATH. Persist: ${escalationFieldText}. ${escalationStateShapeText}.
Roles: ${WORKFLOW_ESCALATION_CONTRACT.roles.join(", ")}. Stages: ${WORKFLOW_ESCALATION_CONTRACT.stages.join(" -> ")}. Verdicts: ${WORKFLOW_ESCALATION_CONTRACT.verdicts.join(", ")}.
Topology: ${escalationTopologyText}.
Authority: ${escalationAuthorityText}.
Transitions: ${escalationTransitionText}.
Primary switch: ${escalationSwitchText}.
Atomic state write: ${escalationAtomicText}. This package adds no runtime I/O, child-agent API, CLI, dependency, or process-persistence claim.
`;

const recoveryResultText = WORKFLOW_RECOVERY_CONTRACT.canonicalResultCodes.join(" | ");
const recoveryDecisionText = WORKFLOW_RECOVERY_CONTRACT.decisions.map(({ description }) => description).join("; ");
const recoveryAtomicStepsText = WORKFLOW_RECOVERY_CONTRACT.atomicSteps.join(", ");
const recoveryRetainedRoleText = WORKFLOW_RECOVERY_CONTRACT.retainedRoleRules.map(({ description }) => description).join("; ");

const workflowRecoveryContract = `
Workflow recovery (declarative host contract; no runtime process persistence):
Use the exact state path supplied by the host:
RECOVERY_STATE_PATH=<ARTIFACT_DIR>/recovery-state.v1.json
The root registry is {"version":1,"root_session_id":"...","workflow_id":"...","agents":{"role":{"agent_id":"...","status":"...","handoff":"..."}},"diagnostics":[]}. Version and diagnostics are optional. Agents must be an object, never an array. Never claim process persistence.
The host supplies the current primary, executor, and ordered valid child roles (maximum ${WORKFLOW_RECOVERY_CONTRACT.maxChildren}). If the set is too large, return EVIDENCE_GAP with no mutation or runtime action. Inspect only supplied roles; an out-of-policy, disabled, same-primary, or excess saved role is removed-by-policy.
Reuse exact resumable IDs. ${recoveryRetainedRoleText}. Replace only when the host confirms the instance is unusable, replacement is allowed, and the host can create it; preserve handoff. Unknown or ambiguous identity is not replaceable.
The primary thread, regardless of selected model, owns RECOVERY_STATE_PATH loading, atomic persistence, and runtime coordination. The active writable executor owns plan-artifact persistence and cleanup. Terra and Sol planning remain registry read-only.
Write with ${recoveryAtomicStepsText}. If any step fails, retain the prior registry, publish no partial state, and perform no dependent action.
Each saved instance emits one result: ${recoveryResultText}. Decisions: ${recoveryDecisionText}.
`;

const workflowLunaInteractionContract = `
Luna lifecycle and interaction contract (one structured source of truth):
Modes are ${WORKFLOW_LUNA_INTERACTION_CONTRACT.modes.join(" | ")}; stage mapping is ${lunaModeByStageText}. Persist luna_mode, luna_role_id, luna_context_version, luna_workspace, luna_allowed_actions, luna_stage_authorized_actions, luna_user_approval_actions, and luna_forbidden_actions atomically with workflow state. ACTIVE_EXECUTOR permits only stage-gated source/PLAN work; INTERACTION_ONLY removes source/PLAN and decision authority but retains the same role identity; DETACHED permits nothing. Demotion is monotonic and never restores source authority implicitly.
Canonical action IDs are host policy, not a command allowlist. ${lunaActionPolicyText}. Terra and Sol delegate only applicable action IDs; Luna must not infer broader permission. No formatter or linter may run in write/fix mode under INTERACTION_ONLY. Do not turn failed test evidence into an implementation change, access production or external mutable state without approval, or mix CVS rules with Git/GitHub rules.
Every interaction returns a structured result with ${lunaResultFieldText}; large output belongs in artifact_refs, repeated errors are deduplicated, and secrets are redacted before summaries or evidence. Never claim success when the action did not run or evidence is incomplete.
`;

const workflowRollbackContract = `
Verification-failure rollback contract (declarative host contract; classification is separate from the verdict):
Failure classes: ${rollbackFailureClassText}. Policies: ${rollbackPolicyText}. Statuses: ${rollbackStatusText}. Persist ${rollbackStateFieldText} atomically with workflow state.
Classification: ${rollbackClassificationText}.
Targets: ${rollbackTargetText}.
Sequence: ${rollbackSequencingText}. Verdict rules: ${rollbackVerdictText}.
Transitions: ${rollbackTransitionText}.
Authority: ${rollbackAuthorityText}.
Return classification fields ${rollbackClassificationFieldText}; return rollback result fields ${rollbackResultFieldText}. Capture evidence and the pre-rollback state before any rollback action. A stale target hash is rejected; partial or failed rollback blocks advancement and never produces PASS. External effects require compensating actions, not local file restoration.
`;

const workflowRoleActionGate = `
Role action gate: the primary supplies the current stage, Luna mode, workspace, and applicable canonical action IDs; it also supplies rollback status. Obey only that snapshot. After FAIL_PLAN or FAIL_IMPLEMENTATION, preserve valid work until rollback classification and pre-rollback evidence exist. Luna may execute only an already approved exact SELECTIVE rollback; it cannot choose destructive policy, target unknown files, or self-approve. Terra independently verifies selective rollback; Sol handles ambiguous, high-risk, external, full-workspace, security, and failed rollback cases. The full recovery, escalation, PLAN, Luna interaction, and rollback catalogs are owned by the model-router skill; do not duplicate them in role output. No role may make architecture or requirement decisions outside its role, expose secrets, or broaden a delegated action.
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
${workflowFastContract}
${workflowRoleActionGate}
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
The primary must provide the same workflow_id and exact derived PLAN_ARTIFACT_PATH on every stage. Verify it stays under the selected CODEX_ROOT workflow directory; stop on a missing, relative, changed, or cross-workflow path. When Luna is ACTIVE_EXECUTOR and Terra or Sol returns plan content, persist it only to that exact path, then reread it before implementation or reimplementation. When Luna is INTERACTION_ONLY, never write source or PLAN; return only host-authorized interaction evidence. Otherwise return the in-memory artifact to the primary without claiming a write.
Implementation stage: reread the complete latest plan from the exact PLAN_PATH, then implement the smallest coherent change. Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, invariants, encoding, and line endings.
ACTIVE_EXECUTOR may write only in the stage-gated executor role. INTERACTION_ONLY may perform only the applicable canonical action IDs supplied by the host; it cannot write source or PLAN, make architecture or requirement decisions, self-approve, or independently repair. DETACHED performs no action. \`luna_execution_enabled\` is retained only for migration; runtime authority derives from \`luna_mode\` and the current stage.
Use local choice only for equivalent implementation details. Stop and return to Terra when the plan conflicts with code, is stale, omits a required target or caller, or requires a new correctness-affecting decision.
Report the plan version, changed files and symbols, completed steps, deviations, checks, and remaining uncertainty. Do not self-approve.
${workflowFastContract}
${workflowRoleActionGate}
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
Sol remains read-only for planning and review before full takeover; the primary thread still coordinates state and returns the final response. In SOL_PLAN_REVIEW_WITH_TERRA and SOL_FULL_TAKEOVER, retain the same Luna identity as INTERACTION_ONLY and delegate only applicable canonical action IDs with structured results.
Return the revised plan and unresolved uncertainty to the current active writable executor with the unchanged PLAN_ARTIFACT_PATH.
${workflowRoleActionGate}
${workflowFastContract}
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

For nontrivial code changes, the primary loads or initializes task-scoped workflow state, performs only stage-required actions, persists each transition atomically, and returns on PASS or a blocked verdict. INITIAL and SOL_REPLAN_WITH_LUNA use Luna as ACTIVE_EXECUTOR. After a failed Sol replan, SOL_PLAN_REVIEW_WITH_TERRA and SOL_FULL_TAKEOVER demote the same Luna role to INTERACTION_ONLY instead of removing it; Terra or Sol owns planning/implementation while Luna runs only delegated bounded actions. Non-PASS verdicts follow the monotonic Sol replan, Terra-attempt, and full-takeover stages; blocked verdicts never attempt execution or advance counters.
Produce a self-contained REQUIREMENT_EVIDENCE package, reuse the same Luna role, and keep three total role identities (primary plus at most two children).

Never launch duplicate same-model agents in one workflow. Reuse one stable role identity and number per model. If the primary is Luna, perform all Luna stages in the primary thread. If the primary is Terra, perform all Terra stages in the primary thread. If the primary is Sol, perform Sol escalation in the primary thread. Never spawn a redundant matching-model child. When primary identity is unavailable, do not guess; use one Luna agent, one Terra agent, and only on failure one Sol agent.
Luna, Terra, and Sol have workspace-write capability in their TOML, but the contract gates authority by current stage and mode: Luna source/PLAN writes only as ACTIVE_EXECUTOR, Luna INTERACTION_ONLY performs only host-authorized action IDs, Terra writes only in its executor stage, and Sol writes only in \`SOL_FULL_TAKEOVER\`. A disabled primary executor remains coord-only. No same-model child is spawned, child IDs remain stable, the retained Luna interaction child is allowed in Stage 3/4, and at most two children exist.
Use the implementation-planning skill for nontrivial or uncertain changes. Preserve verified work and revise only affected parts.
Use the contract counters and monotonic stages; \`terra_execution_attempts\` never exceeds two and \`sol_review_failures\` increments only for failed Sol reviews. EVIDENCE_GAP and REQUIREMENT_CLARIFICATION block the same stage without an attempt or counter increment.
Within one role thread append concise deltas; a new thread receives the latest self-contained artifact instead of the full prior conversation.
${workflowRecoveryContract}
${workflowEscalationContract}
${workflowLunaInteractionContract}
${workflowRollbackContract}
${workflowRoleActionGate}
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
${workflowRoleActionGate}
`;

export const REASONING_EFFORTS = Object.freeze(["none", "low", "medium", "high", "xhigh", "max"]);

export const DEFAULT_AGENT_REASONING = Object.freeze({
  terra: "medium",
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
    "The primary must provide the same workflow_id and exact derived PLAN_ARTIFACT_PATH on every stage. Verify it stays under the selected CODEX_ROOT workflow directory; stop on a missing, relative, changed, or cross-workflow path. When Luna is ACTIVE_EXECUTOR and Terra or Sol returns plan content, persist it only to that exact path, then reread it before implementation or reimplementation. When Luna is INTERACTION_ONLY, never write source or PLAN; return only host-authorized interaction evidence. Otherwise return the in-memory artifact to the primary without claiming a write.\nImplementation stage: reread the complete latest plan from the exact PLAN_PATH, then implement the smallest coherent change. Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, invariants, encoding, and line endings.",
    "Implementation stage: reread the complete latest PLAN.md, then implement the smallest coherent change. Preserve fixed behavior, contracts, scope, parameter flow, control flow, callers, invariants, encoding, and line endings."
  ]
]);

const legacyCurrentSol = restoreCurrentTemplate(withoutRecoveryContract(legacyPrePlanArtifactSol), [
  [
    "Require the primary to provide the same absolute ARTIFACT_DIR and exact absolute PLAN_PATH used by the workflow. Verify that both are unique OS-temporary paths outside the workspace; reject a missing, relative, changed, different, workspace, or non-temporary path and return that correction request to the primary.\nIndependently analyze the primary requirement, Luna evidence package, the complete plan at the exact PLAN_PATH, implementation report, changed code, and Terra verification evidence.",
    "Independently analyze the primary requirement, Luna evidence package, prior PLAN.md, implementation report, changed code, and Terra verification evidence."
  ],
  [
    "Do not edit implementation files before `SOL_FULL_TAKEOVER`; write only when the host contract permits full takeover and `sol_full_takeover` is true. Do not create another Sol agent when Sol is already the primary model.\nSol remains read-only for planning and review before full takeover; the primary thread still coordinates state and returns the final response. In SOL_PLAN_REVIEW_WITH_TERRA and SOL_FULL_TAKEOVER, retain the same Luna identity as INTERACTION_ONLY and delegate only applicable canonical action IDs with structured results.",
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
  terra: { name: "terra", model: "gpt-5.6-terra", model_reasoning_effort: "medium", sandbox_mode: "workspace-write" },
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
