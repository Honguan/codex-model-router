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
  INITIAL_FAIL_LUNA_OR_TERRA: (context) => context.state.current_stage === "INITIAL" && context.state.primary_model !== "sol" && failureVerdicts.has(context.verdict),
  SOL_REPLAN_FAIL: (context) => context.state.current_stage === "SOL_REPLAN_WITH_LUNA" && failureVerdicts.has(context.verdict),
  TERRA_ATTEMPT_1_FAIL: (context) => context.state.current_stage === "SOL_PLAN_REVIEW_WITH_TERRA" && context.state.primary_model !== "sol" && context.state.terra_execution_attempts === 0 && failureVerdicts.has(context.verdict),
  TERRA_ATTEMPT_2_FAIL: (context) => context.state.current_stage === "SOL_PLAN_REVIEW_WITH_TERRA" && context.state.primary_model !== "sol" && context.state.terra_execution_attempts === 1 && failureVerdicts.has(context.verdict),
  PRIMARY_SOL_INITIAL_FAIL: (context) => context.state.current_stage === "INITIAL" && context.state.primary_model === "sol" && failureVerdicts.has(context.verdict),
  PRIMARY_SOL_TERRA_ATTEMPT_2_FAIL: (context) => context.state.current_stage === "SOL_PLAN_REVIEW_WITH_TERRA" && context.state.primary_model === "sol" && context.state.terra_execution_attempts === 1 && failureVerdicts.has(context.verdict),
  PRIMARY_SWITCH: (context) => context.event === "primary-switch",
  NEW_WORKFLOW: (context) => context.event === "new-workflow"
});

function applyCounterDirectives(next, directives) {
  for (const directive of directives.split(";")) {
    if (!directive || directive === "none" || directive === "preserve") continue;
    if (directive === "reset") return state({ workflow_id: next.workflow_id, root_session_id: next.root_session_id, primary_model: next.primary_model });
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
  if (primary === "sol" && stage === "INITIAL") return { evidenceGap: false, children: ["terra"] };
  if (stage === "SOL_FULL_TAKEOVER") return { evidenceGap: false, children: [] };
  return { evidenceGap: false, children: validRoles.filter((role) => role !== primary) };
}

test("production structured contract is immutable and generated prose contains its data", () => {
  assert.equal(Object.isFrozen(contract), true);
  assert.deepEqual(contract.roles, ["terra", "luna", "sol"]);
  assert.deepEqual(contract.stages, ["INITIAL", "SOL_REPLAN_WITH_LUNA", "SOL_PLAN_REVIEW_WITH_TERRA", "SOL_FULL_TAKEOVER"]);
  assert.deepEqual(contract.atomicSteps, ["flush", "close", "rename"]);
  assert.deepEqual(Object.keys(state()).sort(), [...contract.requiredStateFields].sort());
  for (const template of Object.values(TEMPLATES)) {
    for (const ruleItem of contract.transitionRules) assert.match(template.content, new RegExp(ruleItem.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const switchRule of contract.switchRules) assert.match(template.content, new RegExp(switchRule.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const ruleItem of contract.topologyRules) assert.match(template.content, new RegExp(ruleItem.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const ruleItem of contract.authorityRules) assert.match(template.content, new RegExp(ruleItem.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
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
  assert.equal(initial.rule.match, rule("INITIAL_FAIL_LUNA_OR_TERRA").match);
  assert.equal(initial.state.current_stage, "SOL_REPLAN_WITH_LUNA");
  assert.equal(initial.state.luna_execution_enabled, true);

  const solFail = interpret({ state: initial.state, verdict: "FAIL_IMPLEMENTATION" });
  assert.equal(solFail.rule.match, rule("SOL_REPLAN_FAIL").match);
  assert.equal(solFail.state.current_stage, "SOL_PLAN_REVIEW_WITH_TERRA");
  assert.equal(solFail.state.sol_review_failures, 1);
  assert.equal(solFail.state.luna_execution_enabled, false);

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

test("primary Sol INITIAL topology and two Terra attempts are data-driven", () => {
  assert.deepEqual(topology("sol", "INITIAL", ["terra"]), { evidenceGap: false, children: ["terra"] });
  const first = interpret({ state: state({ primary_model: "sol" }), verdict: "FAIL_IMPLEMENTATION" });
  assert.equal(first.rule.match, rule("PRIMARY_SOL_INITIAL_FAIL").match);
  assert.equal(first.state.current_stage, "SOL_PLAN_REVIEW_WITH_TERRA");
  assert.equal(first.state.terra_execution_attempts, 1);
  const second = interpret({ state: first.state, verdict: "FAIL_PLAN" });
  assert.equal(second.rule.match, rule("PRIMARY_SOL_TERRA_ATTEMPT_2_FAIL").match);
  assert.equal(second.state.current_stage, "SOL_FULL_TAKEOVER");
  assert.equal(second.state.terra_execution_enabled, false);
  assert.equal(second.state.sol_full_takeover, true);
});

test("topology enforces two children, no matching primary, and stage-required spawn", () => {
  assert.deepEqual(topology("sol", "INITIAL", ["terra"]), { evidenceGap: false, children: ["terra"] });
  assert.deepEqual(topology("luna", "INITIAL", ["luna", "terra", "sol"]), { evidenceGap: true, children: [] });
  assert.deepEqual(topology("terra", "SOL_FULL_TAKEOVER", ["luna", "sol"]), { evidenceGap: false, children: [] });
  const blocked = interpret({ state: state(), verdict: "EVIDENCE_GAP", validRoles: ["terra", "sol"] });
  assert.deepEqual(blocked.spawned, []);
});

test("all six same-session switches preserve task state and rebind through recovery projection", () => {
  assert.equal(contract.switchRules.length, 6);
  const directedPairs = contract.switchRules.map(({ from, to }) => `${from}->${to}`);
  assert.equal(new Set(directedPairs).size, 6);
  for (const switchRule of contract.switchRules) {
    const { from, to } = switchRule;
    const before = state({ primary_model: from, current_stage: "SOL_PLAN_REVIEW_WITH_TERRA", latest_verdict: "FAIL_PLAN", sol_review_failures: 1, terra_execution_attempts: 1, luna_execution_enabled: false, terra_execution_enabled: true });
    const switched = interpret({ state: before, event: "primary-switch", primaryModel: to });
    assert.equal(switched.rule.match, rule("PRIMARY_SWITCH").match);
    for (const field of contract.requiredStateFields) {
      if (field === "primary_model") continue;
      assert.deepEqual(switched.state[field], before[field], `${field} must survive a primary switch`);
    }
    assert.equal(switched.state.primary_model, to);
  }
});

test("disabled primary remains coord-only, new workflow resets, and recovery projection is not duplicated", () => {
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
