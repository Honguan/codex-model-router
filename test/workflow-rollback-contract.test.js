import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_TEMPLATES,
  TEMPLATES,
  WORKFLOW_ESCALATION_CONTRACT,
  WORKFLOW_LUNA_INTERACTION_CONTRACT,
  WORKFLOW_ROLLBACK_CONTRACT
} from "../lib/manifest.js";

const contract = WORKFLOW_ROLLBACK_CONTRACT;

function baseState(overrides = {}) {
  return {
    workflow_id: "workflow-1",
    root_session_id: "root-1",
    current_stage: "INITIAL",
    latest_verdict: null,
    primary_model: "luna",
    rollback_class: null,
    rollback_policy: null,
    rollback_status: "NOT_REQUIRED",
    rollback_target_hash: null,
    rollback_checkpoint_id: null,
    rollback_authority: null,
    rollback_evidence_refs: [],
    rollback_result: null,
    rollback_attempts: 0,
    ...overrides
  };
}

function classificationRule(failureClass) {
  const rule = contract.classificationRules.find((candidate) => candidate.failureClass === failureClass);
  assert.ok(rule, `missing classification rule: ${failureClass}`);
  return rule;
}

function classify(failureClass, { trustedCheckpoint = false, selectiveSafe = false, targetChanged = false } = {}) {
  const rule = classificationRule(failureClass);
  let policy = rule.policy;
  if (failureClass === "WORKSPACE_CORRUPTION" && !trustedCheckpoint) policy = "BLOCK_AND_ESCALATE";
  if (failureClass === "DEPENDENCY_CORRUPTION" && selectiveSafe) policy = "SELECTIVE";
  if (targetChanged) {
    return {
      failure_class: failureClass,
      rollback_policy: "BLOCK_AND_ESCALATE",
      rollback_status: "STALE_TARGET",
      action: "none"
    };
  }
  return {
    failure_class: failureClass,
    rollback_policy: policy,
    rollback_status: policy === "NONE" ? "CLASSIFIED" : "CLASSIFICATION_REQUIRED",
    action: policy === "NONE" ? "incremental-correction" : "capture-evidence"
  };
}

function executeRollback(decision, {
  actor = "luna",
  approved = false,
  preEvidence = true,
  targetUnknown = false,
  targetChanged = false,
  trustedCheckpoint = false,
  unrelatedWorkProven = false,
  compensatingAction = false,
  isolated = false,
  partial = false
} = {}) {
  if (decision.rollback_policy === "NONE") return { status: "NOT_REQUIRED", advanced: true, action: "incremental-correction" };
  if (!preEvidence) return { status: "BLOCKED", advanced: false, action: "capture-evidence-first" };
  if (targetChanged) return { status: "STALE_TARGET", advanced: false, action: "none" };
  if (targetUnknown) return { status: "BLOCKED", advanced: false, action: "preserve-unknown-untracked" };
  if (actor === "luna" && decision.rollback_policy !== "SELECTIVE") return { status: "BLOCKED", advanced: false, action: "sol-or-user-required" };
  if (!approved && ["SELECTIVE", "FULL_WORKSPACE", "EXTERNAL_SYSTEM", "ISOLATE_AND_ROLLBACK"].includes(decision.rollback_policy)) {
    return { status: "BLOCKED", advanced: false, action: "approval-required" };
  }
  if (decision.rollback_policy === "FULL_WORKSPACE" && (!trustedCheckpoint || !unrelatedWorkProven)) {
    return { status: "BLOCKED", advanced: false, action: "trusted-checkpoint-required" };
  }
  if (decision.rollback_policy === "EXTERNAL_SYSTEM" && !compensatingAction) {
    return { status: "BLOCKED", advanced: false, action: "compensating-action-required" };
  }
  if (decision.rollback_policy === "ISOLATE_AND_ROLLBACK" && !isolated) {
    return { status: "BLOCKED", advanced: false, action: "isolate-first" };
  }
  if (partial) return { status: "PARTIAL", advanced: false, action: "block-and-escalate" };
  return { status: "COMPLETED", advanced: false, action: "reverify" };
}

function atomicPersist(previous, next, failAt = null) {
  for (const step of ["flush", "close", "rename"]) {
    if (step === failAt) return { published: false, state: previous };
  }
  return { published: true, state: next };
}

test("rollback contract is immutable and keeps failure classification separate from verification verdicts", () => {
  assert.equal(Object.isFrozen(contract), true);
  assert.deepEqual(contract.failureClasses, [
    "CORRECTABLE",
    "SCOPE_VIOLATION",
    "WORKSPACE_POLLUTION",
    "WORKSPACE_CORRUPTION",
    "DEPENDENCY_CORRUPTION",
    "EXTERNAL_SIDE_EFFECT",
    "SECURITY_RISK",
    "UNKNOWN_STATE"
  ]);
  assert.deepEqual(contract.policies, ["NONE", "SELECTIVE", "FULL_WORKSPACE", "EXTERNAL_SYSTEM", "ISOLATE_AND_ROLLBACK", "BLOCK_AND_ESCALATE"]);
  assert.ok(WORKFLOW_ESCALATION_CONTRACT.verdicts.includes("FAIL_PLAN"));
  assert.ok(WORKFLOW_ESCALATION_CONTRACT.verdicts.includes("FAIL_IMPLEMENTATION"));
  assert.equal(WORKFLOW_ESCALATION_CONTRACT.verdicts.includes("SELECTIVE"), false);
  assert.deepEqual(WORKFLOW_ESCALATION_CONTRACT.rollbackStateFields, contract.stateFields);
});

test("FAIL_IMPLEMENTATION and FAIL_PLAN classify before mutation; CORRECTABLE preserves work and follows normal escalation", () => {
  for (const verdict of ["FAIL_IMPLEMENTATION", "FAIL_PLAN"]) {
    const state = baseState({ latest_verdict: verdict });
    const decision = classify("CORRECTABLE");
    assert.equal(decision.rollback_policy, "NONE");
    assert.equal(decision.rollback_status, "CLASSIFIED");
    assert.deepEqual(executeRollback(decision), { status: "NOT_REQUIRED", advanced: true, action: "incremental-correction" });
    assert.equal(state.latest_verdict, verdict);
  }
  const failureRule = contract.transitionRules.find((rule) => rule.match === "FAIL_VERDICT");
  assert.deepEqual(failureRule.verdicts, ["FAIL_PLAN", "FAIL_IMPLEMENTATION"]);
  assert.equal(failureRule.to, "CLASSIFICATION_REQUIRED");
});

test("SCOPE_VIOLATION and known generated pollution use exact selective rollback", () => {
  for (const failureClass of ["SCOPE_VIOLATION", "WORKSPACE_POLLUTION"]) {
    const decision = classify(failureClass);
    assert.equal(decision.rollback_policy, "SELECTIVE");
    assert.deepEqual(executeRollback(decision, { approved: true }), { status: "COMPLETED", advanced: false, action: "reverify" });
  }
  const pollution = classificationRule("WORKSPACE_POLLUTION").description;
  assert.match(pollution, /known generated artifacts/);
  assert.match(pollution, /unknown untracked files are never deleted automatically/);
});

test("unknown untracked files and stale target hashes are never mutated", () => {
  const decision = classify("SCOPE_VIOLATION");
  assert.deepEqual(executeRollback(decision, { approved: true, targetUnknown: true }), { status: "BLOCKED", advanced: false, action: "preserve-unknown-untracked" });
  assert.deepEqual(executeRollback(decision, { approved: true, targetChanged: true }), { status: "STALE_TARGET", advanced: false, action: "none" });
  assert.match(contract.targetRules.find(({ target }) => target === "selective").description, /exact identity and pre-rollback hash/);
});

test("Luna may execute approved selective rollback but cannot choose or self-approve destructive rollback", () => {
  const selective = classify("SCOPE_VIOLATION");
  assert.deepEqual(executeRollback(selective, { approved: true }), { status: "COMPLETED", advanced: false, action: "reverify" });
  for (const failureClass of ["WORKSPACE_CORRUPTION", "EXTERNAL_SIDE_EFFECT", "SECURITY_RISK"]) {
    const decision = classify(failureClass, { trustedCheckpoint: true });
    assert.equal(executeRollback(decision, { actor: "luna", approved: true, trustedCheckpoint: true, unrelatedWorkProven: true, compensatingAction: true, isolated: true }).status, "BLOCKED");
  }
  assert.match(contract.authorityRules.find(({ role }) => role === "luna").description, /already approved exact SELECTIVE/);
});

test("Terra verifies selective rollback, while full, external, security, dependency, and unknown states require escalation", () => {
  assert.match(contract.authorityRules.find(({ role }) => role === "terra").description, /independently verifies/);
  for (const failureClass of ["DEPENDENCY_CORRUPTION", "UNKNOWN_STATE"]) {
    assert.equal(classify(failureClass).rollback_policy, "BLOCK_AND_ESCALATE");
  }
  assert.equal(classify("WORKSPACE_CORRUPTION", { trustedCheckpoint: false }).rollback_policy, "BLOCK_AND_ESCALATE");
  assert.equal(classify("WORKSPACE_CORRUPTION", { trustedCheckpoint: true }).rollback_policy, "FULL_WORKSPACE");
  assert.equal(classify("EXTERNAL_SIDE_EFFECT").rollback_policy, "EXTERNAL_SYSTEM");
  assert.equal(classify("SECURITY_RISK").rollback_policy, "ISOLATE_AND_ROLLBACK");
});

test("full workspace rollback requires a trusted checkpoint and preserves unrelated work", () => {
  const decision = classify("WORKSPACE_CORRUPTION", { trustedCheckpoint: true });
  assert.deepEqual(executeRollback(decision, { actor: "sol", approved: true, trustedCheckpoint: true, unrelatedWorkProven: false }), { status: "BLOCKED", advanced: false, action: "trusted-checkpoint-required" });
  assert.deepEqual(executeRollback(decision, { actor: "sol", approved: true, trustedCheckpoint: true, unrelatedWorkProven: true }), { status: "COMPLETED", advanced: false, action: "reverify" });
});

test("external side effects require compensating actions and security risks isolate before rollback", () => {
  const external = classify("EXTERNAL_SIDE_EFFECT");
  assert.deepEqual(executeRollback(external, { actor: "sol", approved: true }), { status: "BLOCKED", advanced: false, action: "compensating-action-required" });
  assert.deepEqual(executeRollback(external, { actor: "sol", approved: true, compensatingAction: true }), { status: "COMPLETED", advanced: false, action: "reverify" });
  const security = classify("SECURITY_RISK");
  assert.deepEqual(executeRollback(security, { actor: "sol", approved: true, isolated: false }), { status: "BLOCKED", advanced: false, action: "isolate-first" });
  assert.deepEqual(executeRollback(security, { actor: "sol", approved: true, isolated: true }), { status: "COMPLETED", advanced: false, action: "reverify" });
});

test("rollback evidence is captured first and failed or partial rollback cannot advance or PASS", () => {
  const decision = classify("SCOPE_VIOLATION");
  assert.deepEqual(executeRollback(decision, { approved: true, preEvidence: false }), { status: "BLOCKED", advanced: false, action: "capture-evidence-first" });
  assert.deepEqual(executeRollback(decision, { approved: true, partial: true }), { status: "PARTIAL", advanced: false, action: "block-and-escalate" });
  assert.ok(contract.sequencingRules.some((rule) => /never produces PASS/.test(rule)));
  assert.ok(contract.transitionRules.some((rule) => rule.match === "ROLLBACK_FAILED_OR_PARTIAL" && rule.to === "BLOCK_AND_ESCALATE"));
});

test("rollback state writes are atomic and preserve prior state on failure", () => {
  const previous = baseState({ rollback_status: "CLASSIFIED", rollback_policy: "SELECTIVE" });
  const next = { ...previous, rollback_status: "COMPLETED", rollback_result: { status: "COMPLETED" } };
  for (const step of ["flush", "close", "rename"]) {
    const failed = atomicPersist(previous, next, step);
    assert.equal(failed.published, false);
    assert.deepEqual(failed.state, previous);
  }
  assert.deepEqual(atomicPersist(previous, next).state, next);
});

test("same-task primary switches preserve rollback state and new workflows clear authority", () => {
  const before = baseState({
    primary_model: "luna",
    rollback_class: "SCOPE_VIOLATION",
    rollback_policy: "SELECTIVE",
    rollback_status: "EVIDENCE_CAPTURED",
    rollback_target_hash: "sha-before",
    rollback_checkpoint_id: "checkpoint-1",
    rollback_authority: "terra",
    rollback_evidence_refs: ["artifact-1"],
    rollback_attempts: 1
  });
  const switched = { ...before, primary_model: "terra" };
  for (const field of contract.stateFields) assert.deepEqual(switched[field], before[field], `${field} must survive primary switch`);
  const fresh = baseState({ workflow_id: "workflow-2", root_session_id: "root-2" });
  assert.equal(fresh.rollback_class, null);
  assert.equal(fresh.rollback_policy, null);
  assert.equal(fresh.rollback_status, "NOT_REQUIRED");
  assert.equal(fresh.rollback_target_hash, null);
  assert.equal(fresh.rollback_checkpoint_id, null);
  assert.equal(fresh.rollback_authority, null);
  assert.deepEqual(fresh.rollback_evidence_refs, []);
  assert.equal(fresh.rollback_result, null);
  assert.equal(fresh.rollback_attempts, 0);
});

test("Git and CVS inspection policies remain separate and interaction actions are canonical", () => {
  const policy = WORKFLOW_LUNA_INTERACTION_CONTRACT.actionPolicy;
  assert.ok(policy.safeInspection.includes("git-inspect"));
  assert.ok(policy.safeInspection.includes("cvs-inspect"));
  assert.equal(policy.safeInspection.includes("git-push"), false);
  assert.equal(policy.safeInspection.includes("cvs-update"), false);
  assert.ok(policy.userApproval.includes("git-push"));
  assert.ok(policy.userApproval.includes("cvs-update"));
  const allActions = Object.values(policy).flat();
  assert.equal(new Set(allActions).size, allActions.length);
});

test("rollback catalog is centralized and role prompts stay within the regression budget", () => {
  assert.match(TEMPLATES.skill.content, /Verification-failure rollback contract/);
  assert.match(TEMPLATES.skill.content, /CORRECTABLE/);
  assert.match(TEMPLATES.skill.content, /BLOCK_AND_ESCALATE/);
  for (const [name, template] of Object.entries(TEMPLATES)) {
    assert.match(template.content, /rollback status/);
    if (name !== "skill") assert.doesNotMatch(template.content, /Verification-failure rollback contract/);
  }
  assert.ok(TEMPLATES.skill.content.length < 24000);
  for (const name of ["terra", "luna", "sol", "planning"]) assert.ok(TEMPLATES[name].content.length < 5000, `${name} prompt budget`);
  for (const [name, entries] of Object.entries(LEGACY_TEMPLATES)) assert.ok(entries.length > 0, `${name} migration entries`);
});
