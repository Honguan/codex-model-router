import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_TEMPLATES, TEMPLATES, WORKFLOW_PLAN_ARTIFACT_CONTRACT } from "../lib/manifest.js";

function activeSandboxAssignments(content) {
  return content.split(/\r?\n/)
    .filter((line) => /^sandbox_mode\s*=\s*"[^"]+"\s*$/.test(line))
    .map((line) => line.match(/^sandbox_mode\s*=\s*"([^"]+)"\s*$/)[1]);
}

test("Luna remains permanently gated by its task-scoped execution flag", () => {
  assert.match(TEMPLATES.luna.content, /REQUIREMENT_EVIDENCE/);
  assert.match(TEMPLATES.luna.content, /one persistent Luna role/);
  assert.deepEqual(activeSandboxAssignments(TEMPLATES.luna.content), ["workspace-write"]);
  assert.match(TEMPLATES.luna.content, /luna_execution_enabled/);
  assert.match(TEMPLATES.luna.content, /disabled Luna remains coord-only permanently/);
  assert.match(TEMPLATES.luna.content, /Do not self-approve/);
});

test("Terra has workspace-write capability with a contract execution gate", () => {
  assert.match(TEMPLATES.terra.content, /PLAN_ARTIFACT_PATH/);
  assert.match(TEMPLATES.terra.content, /CODEX_ROOT/);
  assert.match(TEMPLATES.terra.content, /do not write PLAN_PATH/);
  assert.match(TEMPLATES.terra.content, /FAIL_IMPLEMENTATION/);
  assert.match(TEMPLATES.terra.content, /FAIL_PLAN/);
  assert.deepEqual(activeSandboxAssignments(TEMPLATES.terra.content), ["workspace-write"]);
  assert.match(TEMPLATES.terra.content, /terra_execution_enabled/);
  assert.match(TEMPLATES.terra.content, /otherwise remain read-only/);
});

test("Sol is contract-gated read-only before full takeover", () => {
  assert.match(TEMPLATES.sol.content, /non-PASS verification verdict/);
  assert.match(TEMPLATES.sol.content, /complete revised plan content/);
  assert.match(TEMPLATES.sol.content, /do not write PLAN_PATH/);
  assert.match(TEMPLATES.sol.content, /current active writable executor/);
  assert.deepEqual(activeSandboxAssignments(TEMPLATES.sol.content), ["workspace-write"]);
  assert.match(TEMPLATES.sol.content, /SOL_FULL_TAKEOVER/);
  assert.match(TEMPLATES.sol.content, /sol_full_takeover/);
  assert.match(TEMPLATES.sol.content, /read-only for planning and review before full takeover/);
});

test("agent templates have one active workspace-write assignment without a read-only fallback comment", () => {
  for (const name of ["terra", "luna", "sol"]) {
    const content = TEMPLATES[name].content;
    assert.deepEqual(activeSandboxAssignments(content), ["workspace-write"], `${name} must have one active sandbox assignment`);
    assert.doesNotMatch(content, /^\s*#.*sandbox_mode\s*=\s*"read-only"/m, `${name} must not use a commented sandbox fallback`);
  }
});

test("router uses matching primary inline and task-scoped escalation stages", () => {
  const skill = TEMPLATES.skill.content;
  assert.match(skill, /Never launch duplicate same-model agents/);
  assert.match(skill, /If the primary is Luna/);
  assert.match(skill, /If the primary is Terra/);
  assert.match(skill, /If the primary is Sol/);
  assert.match(skill, /SOL_REPLAN_WITH_LUNA/);
  assert.match(skill, /terra_execution_attempts/);
  assert.match(skill, /blocked verdicts never attempt execution/);
  assert.match(skill, /ordinary questions, explanations, read-only analysis/);
});

test("all current templates carry the deterministic scoped plan-artifact contract", () => {
  const contracts = [
    ["terra", [/workflow_id/, /PLAN_ARTIFACT_PATH/, /CODEX_ROOT/, /do not write PLAN_PATH/]],
    ["luna", [/same workflow_id/, /PLAN_ARTIFACT_PATH/, /active writable executor/, /in-memory artifact/]],
    ["sol", [/same workflow_id/, /PLAN_ARTIFACT_PATH/, /complete revised plan content/, /do not write PLAN_PATH/]],
    ["skill", [/PLAN_ARTIFACT_PATH/, /model-router\/workflows\/<workflow_id>\/PLAN\.md/, /active writable executor/, /cleanup-failed/]],
    ["planning", [/workflow_id/, /PLAN_ARTIFACT_PATH/, /CODEX_ROOT/, /source-tree path/]]
  ];

  for (const [name, patterns] of contracts) {
    const content = TEMPLATES[name].content;
    for (const pattern of patterns) assert.match(content, pattern, `${name} missing ${pattern}`);
    assert.doesNotMatch(content, /workspace PLAN\.md|workspace\/PLAN\.md|workspace\\PLAN\.md/i);
  }
  assert.equal(WORKFLOW_PLAN_ARTIFACT_CONTRACT.path, "<CODEX_ROOT>/model-router/workflows/<workflow_id>/PLAN.md");
});

test("pre-change current templates remain recognized for safe migration", () => {
  const legacyEvidence = [
    ["terra", /For planning, write or update the compact implementation-ready PLAN\.md/],
    ["luna", /Implementation stage: reread the complete latest PLAN\.md/],
    ["sol", /Rewrite only affected PLAN\.md sections/],
    ["skill", /Terra writes or updates the complete PLAN\.md/],
    ["planning", /Produce one compact current PLAN\.md snapshot/]
  ];

  for (const [name, pattern] of legacyEvidence) {
    assert.ok(LEGACY_TEMPLATES[name].some((content) => pattern.test(content)), `${name} legacy template is missing`);
  }
  assert.ok(LEGACY_TEMPLATES.terra.some((content) => /operating system temporary-directory facility/.test(content)));
  assert.ok(LEGACY_TEMPLATES.skill.some((content) => /operating system temporary-directory facility/.test(content)));
});
