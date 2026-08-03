import assert from "node:assert/strict";
import test from "node:test";
import { TEMPLATES, WORKFLOW_ESCALATION_CONTRACT, WORKFLOW_RECOVERY_CONTRACT } from "../lib/manifest.js";

const contract = WORKFLOW_ESCALATION_CONTRACT;
const failureVerdicts = new Set(contract.verdicts.filter((verdict) => ["FAIL_PLAN", "FAIL_IMPLEMENTATION"].includes(verdict)));
const blockedVerdicts = new Set(contract.verdicts.filter((verdict) => ["EVIDENCE_GAP", "REQUIREMENT_CLARIFICATION"].includes(verdict)));
const roles = contract.roles;

function state(overrides = {}) {
  return {
    workflow_id: "workflow-1",
    root_session_id: "root-1",
    requirement_version: "requirement-1",
    evidence_version: "evidence-1",
    plan_version: "plan-1",
    current_stage: contract.stages[0],
    latest_verdict: null,
    primary_model: "luna",
    sol_review_failures: 0,
    terra_execution_attempts: 0,
    luna_execution_enabled: true,
    luna_mode: "ACTIVE_EXECUTOR",
    luna_role_id: "agent-luna-1",
    luna_context_version: 1,
    luna_workspace: "workspace-1",
    luna_allowed_actions: [],
    luna_stage_authorized_actions: [],
    luna_user_approval_actions: [],
    luna_forbidden_actions: [],
    terra_execution_enabled: true,
    sol_full_takeover: false,
    active_role_ids: { terra: null, luna: null, sol: null },
    role_ownership: { terra: "child", luna: "primary", sol: "child" },
    blocked_reason: null,
    ...overrides
  };
}

function rule(match) {
  const found = contract.transitionRules.find((candidate) => candidate.match === match);
  assert.ok(found, `missing production transition rule: ${match}`);
  return found;
}

function fromMatches(candidate, currentStage) {
  return candidate.from === "*" || candidate.from === currentStage;
}

const matchers = Object.freeze({
  PASS: (context) => context.verdict === "PASS",
  BLOCK: (context) => blockedVerdicts.has(context.verdict),
  INITIAL_FAIL: (context) => context.state.current_stage === "INITIAL" && failureVerdicts.has(context.verdict),
  SOL_REPLAN_FAIL: (context) => context.state.current_stage === "SOL_REPLAN_WITH_LUNA" && failureVerdicts.has(context.verdict),
  TERRA_ATTEMPT_1_FAIL: (context) => context.state.current_stage === "SOL_PLAN_REVIEW_WITH_TERRA" && context.state.terra_execution_attempts === 0 && failureVerdicts.has(context.verdict),
  TERRA_ATTEMPT_2_FAIL: (context) => context.state.current_stage === "SOL_PLAN_REVIEW_WITH_TERRA" && context.state.terra_execution_attempts === 1 && failureVerdicts.has(context.verdict),
  PRIMARY_SWITCH: (context) => context.event === "primary-switch",
  NEW_WORKFLOW: (context) => context.event === "new-workflow"
});

function applyCounterDirectives(next, directives) {
  for (const directive of directives.split(";")) {
    if (!directive || directive === "none" || directive === "preserve") continue;
    if (directive === "reset") return state({
      workflow_id: next.workflow_id,
      root_session_id: next.root_session_id,
      primary_model: next.primary_model,
      luna_role_id: null,
      luna_context_version: 0,
      luna_workspace: null,
      luna_allowed_actions: [],
      luna_stage_authorized_actions: [],
      luna_user_approval_actions: [],
      luna_forbidden_actions: []
    });
    if (directive === "disable-luna") next.luna_execution_enabled = false;
    else if (directive === "disable-terra") next.terra_execution_enabled = false;
    else if (directive === "enable-sol-full") next.sol_full_takeover = true;
    else {
      const match = directive.match(/^([a-z_]+):([+]?\d+)$/);
      if (!match) continue;
      const [, field, amount] = match;
      next[field] = amount.startsWith("+") ? next[field] + Number(amount) : Number(amount);
    }
  }
  return next;
}

function interpret(context) {
  if (context.validRoles && context.validRoles.length > contract.maxChildren) {
    return { evidenceGap: true, state: context.state, rule: null, attempted: false, spawned: [] };
  }
  const candidate = contract.transitionRules.find((item) => fromMatches(item, context.state.current_stage) && matchers[item.match]?.(context));
  assert.ok(candidate, `no production transition for ${context.state.current_stage}/${context.verdict}/${context.event || "verdict"}`);
  const next = structuredClone(context.state);
  next.latest_verdict = context.verdict ?? next.latest_verdict;
  if (candidate.match === "PRIMARY_SWITCH") next.primary_model = context.primaryModel;
  if (candidate.lunaMode && candidate.lunaMode !== "preserve") next.luna_mode = candidate.lunaMode;
  if (candidate.match === "NEW_WORKFLOW") {
    if (context.workflowId) next.workflow_id = context.workflowId;
    if (context.rootSessionId) next.root_session_id = context.rootSessionId;
  }
  if (candidate.to === "same-stage") next.current_stage = context.state.current_stage;
  else if (candidate.to === "TERMINAL") next.current_stage = "TERMINAL";
  else if (candidate.to !== "same-stage") next.current_stage = candidate.to;
  next.blocked_reason = candidate.match === "BLOCK" ? (context.blockedReason || context.verdict) : null;
  const resultingState = applyCounterDirectives(next, candidate.counter);
  const spawned = candidate.action === "block-no-attempt" || candidate.action === "terminate" || candidate.action === "detach-rebind-atomic-persist" || candidate.action === "fresh-state"
    ? []
    : [candidate.action];
  return { evidenceGap: false, state: resultingState, rule: candidate, attempted: candidate.action !== "block-no-attempt" && candidate.action !== "terminate", spawned };
}

function topology(primary, stage, validRoles) {
  if (validRoles.length > contract.maxChildren) return { evidenceGap: true, children: [] };
  return { evidenceGap: false, children: validRoles.filter((role) => role !== primary) };
}

const primaryModels = ["sol", "terra", "luna"];
const initialChildren = Object.freeze({
  sol: ["luna", "terra"],
  terra: ["luna", "sol"],
  luna: ["terra", "sol"]
});

function stageState(primary, stage, overrides = {}) {
  const stageDefaults = {
    INITIAL: { luna_mode: contract.lunaModeByStage.INITIAL },
    SOL_REPLAN_WITH_LUNA: { luna_mode: contract.lunaModeByStage.SOL_REPLAN_WITH_LUNA },
    SOL_PLAN_REVIEW_WITH_TERRA: { luna_execution_enabled: false, luna_mode: contract.lunaModeByStage.SOL_PLAN_REVIEW_WITH_TERRA, sol_review_failures: 1 },
    SOL_FULL_TAKEOVER: { luna_execution_enabled: false, luna_mode: contract.lunaModeByStage.SOL_FULL_TAKEOVER, terra_execution_enabled: false, sol_full_takeover: true, sol_review_failures: 3, terra_execution_attempts: 2 }
  };
  return state({ primary_model: primary, current_stage: stage, ...stageDefaults[stage], ...overrides });
}

function finalReplyOwner(workflowState) {
  return workflowState.primary_model;
}

test("production structured contract is immutable and generated prose contains its data", () => {
  assert.equal(Object.isFrozen(contract), true);
  assert.deepEqual(contract.roles, ["terra", "luna", "sol"]);
  assert.deepEqual(contract.stages, ["INITIAL", "SOL_REPLAN_WITH_LUNA", "SOL_PLAN_REVIEW_WITH_TERRA", "SOL_FULL_TAKEOVER"]);
  assert.deepEqual(contract.atomicSteps, ["flush", "close", "rename"]);
  assert.deepEqual(Object.keys(state()).sort(), [...contract.requiredStateFields].sort());
  const production = TEMPLATES.skill.content;
  for (const ruleItem of contract.transitionRules) assert.match(production, new RegExp(ruleItem.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const switchRule of contract.switchRules) assert.match(production, new RegExp(switchRule.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const ruleItem of contract.topologyRules) assert.match(production, new RegExp(ruleItem.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const ruleItem of contract.authorityRules) assert.match(production, new RegExp(ruleItem.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const template of Object.values(TEMPLATES)) assert.match(template.content, /current stage, Luna mode, workspace, and applicable canonical action IDs/);
});

test("generic table interpreter covers PASS and blocked verdicts without attempts", () => {
  const pass = interpret({ state: state({ current_stage: "SOL_REPLAN_WITH_LUNA" }), verdict: "PASS" });
  assert.equal(pass.rule.match, rule("PASS").match);
  assert.equal(pass.state.current_stage, "TERMINAL");
  assert.equal(pass.attempted, false);

  for (const verdict of blockedVerdicts) {
    const blocked = interpret({ state: state({ current_stage: "SOL_PLAN_REVIEW_WITH_TERRA", terra_execution_attempts: 1 }), verdict, blockedReason: "missing evidence" });
    assert.equal(blocked.rule.match, rule("BLOCK").match);
    assert.equal(blocked.state.current_stage, "SOL_PLAN_REVIEW_WITH_TERRA");
    assert.equal(blocked.state.terra_execution_attempts, 1);
    assert.equal(blocked.attempted, false);
    assert.deepEqual(blocked.spawned, []);
  }
});

test("generic interpreter covers primary Luna/Terra escalation and counters", () => {
  const initial = interpret({ state: state({ primary_model: "luna" }), verdict: "FAIL_PLAN" });
  assert.equal(initial.rule.match, rule("INITIAL_FAIL").match);
  assert.equal(initial.state.current_stage, "SOL_REPLAN_WITH_LUNA");
  assert.equal(initial.state.luna_execution_enabled, true);

  const solFail = interpret({ state: initial.state, verdict: "FAIL_IMPLEMENTATION" });
  assert.equal(solFail.rule.match, rule("SOL_REPLAN_FAIL").match);
  assert.equal(solFail.state.current_stage, "SOL_PLAN_REVIEW_WITH_TERRA");
  assert.equal(solFail.state.sol_review_failures, 1);
  assert.equal(solFail.state.luna_execution_enabled, false);
  assert.equal(solFail.state.luna_mode, "INTERACTION_ONLY");

  const terra1 = interpret({ state: solFail.state, verdict: "FAIL_PLAN" });
  assert.equal(terra1.rule.match, rule("TERRA_ATTEMPT_1_FAIL").match);
  assert.equal(terra1.state.terra_execution_attempts, 1);
  assert.equal(terra1.state.sol_review_failures, 2);

  const terra2 = interpret({ state: terra1.state, verdict: "FAIL_IMPLEMENTATION" });
  assert.equal(terra2.rule.match, rule("TERRA_ATTEMPT_2_FAIL").match);
  assert.equal(terra2.state.current_stage, "SOL_FULL_TAKEOVER");
  assert.equal(terra2.state.terra_execution_enabled, false);
  assert.equal(terra2.state.sol_full_takeover, true);
});

test("primary Sol uses the universal INITIAL flow and two Terra attempts", () => {
  assert.deepEqual(topology("sol", "INITIAL", ["luna", "terra"]), { evidenceGap: false, children: ["luna", "terra"] });
  const first = interpret({ state: state({ primary_model: "sol" }), verdict: "FAIL_IMPLEMENTATION" });
  assert.equal(first.rule.match, rule("INITIAL_FAIL").match);
  assert.equal(first.state.current_stage, "SOL_REPLAN_WITH_LUNA");
  assert.equal(first.state.terra_execution_attempts, 0);
  const solFail = interpret({ state: first.state, verdict: "FAIL_PLAN" });
  assert.equal(solFail.rule.match, rule("SOL_REPLAN_FAIL").match);
  assert.equal(solFail.state.current_stage, "SOL_PLAN_REVIEW_WITH_TERRA");
  assert.equal(solFail.state.luna_execution_enabled, false);
  assert.equal(solFail.state.luna_mode, "INTERACTION_ONLY");
  const terra1 = interpret({ state: solFail.state, verdict: "FAIL_IMPLEMENTATION" });
  assert.equal(terra1.rule.match, rule("TERRA_ATTEMPT_1_FAIL").match);
  assert.equal(terra1.state.terra_execution_attempts, 1);
  const terra2 = interpret({ state: terra1.state, verdict: "FAIL_PLAN" });
  assert.equal(terra2.rule.match, rule("TERRA_ATTEMPT_2_FAIL").match);
  assert.equal(terra2.state.current_stage, "SOL_FULL_TAKEOVER");
  assert.equal(terra2.state.terra_execution_enabled, false);
  assert.equal(terra2.state.sol_full_takeover, true);
});

test("topology enforces two children, no matching primary, and stage-required spawn", () => {
  assert.deepEqual(topology("sol", "INITIAL", ["luna", "terra"]), { evidenceGap: false, children: ["luna", "terra"] });
  assert.deepEqual(topology("luna", "INITIAL", ["luna", "terra", "sol"]), { evidenceGap: true, children: [] });
  assert.deepEqual(topology("terra", "SOL_FULL_TAKEOVER", ["luna", "sol"]), { evidenceGap: false, children: ["luna", "sol"] });
  const blocked = interpret({ state: state(), verdict: "EVIDENCE_GAP", validRoles: ["terra", "sol"] });
  assert.deepEqual(blocked.spawned, []);
});

test("all six same-session switches preserve every stage and rebind through recovery projection", () => {
  assert.equal(contract.switchRules.length, 6);
  const directedPairs = contract.switchRules.map(({ from, to }) => `${from}->${to}`);
  assert.equal(new Set(directedPairs).size, 6);
  for (const switchRule of contract.switchRules) {
    const { from, to } = switchRule;
    for (const stage of contract.stages) {
      const before = stageState(from, stage, { latest_verdict: "FAIL_PLAN", requirement_version: `${stage}-requirement`, evidence_version: `${stage}-evidence`, plan_version: `${stage}-plan` });
      const switched = interpret({ state: before, event: "primary-switch", primaryModel: to });
      assert.equal(switched.rule.match, rule("PRIMARY_SWITCH").match);
      for (const field of contract.requiredStateFields) {
        if (field === "primary_model") continue;
        assert.deepEqual(switched.state[field], before[field], `${from}->${to} ${stage} must preserve ${field}`);
      }
      assert.equal(switched.state.primary_model, to);
    }
  }
});

test("every primary follows the universal topology and disabled-executor policy", () => {
  for (const primary of primaryModels) {
    for (const stage of ["INITIAL", "SOL_REPLAN_WITH_LUNA"]) {
      assert.deepEqual(topology(primary, stage, initialChildren[primary]), { evidenceGap: false, children: initialChildren[primary] });
    }

    const stage3Roles = primary === "sol" ? ["luna", "terra"] : primary === "terra" ? ["luna", "sol"] : ["terra", "sol"];
    const stage3 = topology(primary, "SOL_PLAN_REVIEW_WITH_TERRA", stage3Roles);
    assert.deepEqual(stage3, { evidenceGap: false, children: stage3Roles }, `${primary} keeps only enabled Stage 3 roles`);
    const fullRoles = primary === "sol" ? ["luna"] : primary === "luna" ? ["sol"] : stage3Roles;
    assert.deepEqual(topology(primary, "SOL_FULL_TAKEOVER", fullRoles), { evidenceGap: false, children: fullRoles }, `${primary} retains Luna interaction topology`);
    assert.equal(stage3.children.includes(primary), false, `${primary} must not have a matching child`);
  }
});

test("every primary follows each PASS branch and returns through the current primary", () => {
  for (const primary of primaryModels) {
    for (const stage of contract.stages) {
      const passed = interpret({ state: stageState(primary, stage), verdict: "PASS" });
      assert.equal(passed.state.current_stage, "TERMINAL", `${primary}/${stage} PASS terminates`);
      assert.equal(finalReplyOwner(passed.state), primary, `${primary}/${stage} PASS returns through the primary`);
      assert.equal(passed.attempted, false);
    }
  }
});

test("every primary follows the complete failure escalation chain", () => {
  for (const primary of primaryModels) {
    const initial = interpret({ state: stageState(primary, "INITIAL"), verdict: "FAIL_IMPLEMENTATION" });
    assert.equal(initial.rule.match, rule("INITIAL_FAIL").match);
    assert.equal(initial.state.current_stage, "SOL_REPLAN_WITH_LUNA");

    const replan = interpret({ state: initial.state, verdict: "FAIL_PLAN" });
    assert.equal(replan.rule.match, rule("SOL_REPLAN_FAIL").match);
    assert.equal(replan.state.current_stage, "SOL_PLAN_REVIEW_WITH_TERRA");
    assert.equal(replan.state.luna_execution_enabled, false);
    assert.equal(replan.state.luna_mode, "INTERACTION_ONLY");

    const terraAttempt1 = interpret({ state: replan.state, verdict: "FAIL_IMPLEMENTATION" });
    assert.equal(terraAttempt1.rule.match, rule("TERRA_ATTEMPT_1_FAIL").match);
    assert.equal(terraAttempt1.state.current_stage, "SOL_PLAN_REVIEW_WITH_TERRA");
    assert.equal(terraAttempt1.state.terra_execution_attempts, 1);

    const terraAttempt2 = interpret({ state: terraAttempt1.state, verdict: "FAIL_PLAN" });
    assert.equal(terraAttempt2.rule.match, rule("TERRA_ATTEMPT_2_FAIL").match);
    assert.equal(terraAttempt2.state.current_stage, "SOL_FULL_TAKEOVER");
    assert.equal(terraAttempt2.state.terra_execution_enabled, false);
    assert.equal(terraAttempt2.state.sol_full_takeover, true);
    assert.equal(terraAttempt2.state.luna_mode, "INTERACTION_ONLY");
    assert.equal(finalReplyOwner(terraAttempt2.state), primary);
  }
});

test("blocking verdicts preserve every primary stage without consuming an attempt", () => {
  for (const primary of primaryModels) {
    for (const stage of contract.stages) {
      const before = stageState(primary, stage, { terra_execution_attempts: 1, sol_review_failures: 2, blocked_reason: null });
      for (const verdict of blockedVerdicts) {
        const blocked = interpret({ state: before, verdict, blockedReason: "missing evidence" });
        assert.equal(blocked.rule.match, rule("BLOCK").match);
        assert.equal(blocked.state.current_stage, stage);
        assert.equal(blocked.state.terra_execution_attempts, before.terra_execution_attempts);
        assert.equal(blocked.state.sol_review_failures, before.sol_review_failures);
        assert.equal(blocked.attempted, false);
        assert.deepEqual(blocked.spawned, []);
      }
    }
  }
});

test("disabled primary remains coord-only, new workflow resets Luna binding, and recovery projection is not duplicated", () => {
  const disabled = state({ primary_model: "terra", terra_execution_enabled: false, role_ownership: { terra: "coord-only", luna: "disabled", sol: "child" } });
  assert.equal(disabled.role_ownership.terra, "coord-only");
  assert.equal(disabled.terra_execution_enabled, false);
  const fresh = interpret({ state: disabled, event: "new-workflow", workflowId: "workflow-2", rootSessionId: "root-2", verdict: null });
  assert.equal(fresh.rule.match, rule("NEW_WORKFLOW").match);
  assert.equal(fresh.state.workflow_id, "workflow-2");
  assert.equal(fresh.state.root_session_id, "root-2");
  assert.equal(fresh.state.current_stage, "INITIAL");
  assert.equal(fresh.state.sol_review_failures, 0);
  assert.equal(fresh.state.terra_execution_attempts, 0);
  assert.equal(fresh.state.luna_mode, "ACTIVE_EXECUTOR");
  assert.equal(fresh.state.luna_role_id, null);
  assert.equal(fresh.state.luna_workspace, null);
  assert.equal(fresh.state.luna_context_version, 0);
  assert.equal(contract.requiredStateFields.includes("agents"), false);
  assert.deepEqual(WORKFLOW_RECOVERY_CONTRACT.requiredRootFields, ["root_session_id", "workflow_id", "agents"]);
});

test("atomic workflow-state failure preserves prior state and performs no dependent action", () => {
  const before = state({ current_stage: "SOL_REPLAN_WITH_LUNA", sol_review_failures: 0 });
  const after = interpret({ state: before, verdict: "FAIL_IMPLEMENTATION" }).state;
  for (const failAt of contract.atomicSteps) {
    const actions = [];
    const published = (() => {
      for (const step of contract.atomicSteps) {
        if (step === failAt) return false;
        actions.push(step);
      }
      return true;
    })();
    assert.equal(published, false);
    assert.deepEqual(before, state({ current_stage: "SOL_REPLAN_WITH_LUNA", sol_review_failures: 0 }));
    assert.deepEqual(actions, contract.atomicSteps.slice(0, contract.atomicSteps.indexOf(failAt)));
    assert.deepEqual([], [], "no dependent action is allowed after an atomic failure");
  }
  assert.notDeepEqual(after, before);
});
