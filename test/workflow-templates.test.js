import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEGACY_TEMPLATES,
  TEMPLATES,
  WORKFLOW_LUNA_INTERACTION_CONTRACT,
  WORKFLOW_PLAN_ARTIFACT_CONTRACT,
  WORKFLOW_ROLLBACK_CONTRACT
} from "../lib/manifest.js";

function activeSandboxAssignments(content) {
  return content.split(/\r?\n/)
    .filter((line) => /^sandbox_mode\s*=\s*"[^"]+"\s*$/.test(line))
    .map((line) => line.match(/^sandbox_mode\s*=\s*"([^"]+)"\s*$/)[1]);
}

test("Luna authority is mode-gated and identity remains reusable", () => {
  assert.match(TEMPLATES.luna.content, /REQUIREMENT_EVIDENCE/);
  assert.match(TEMPLATES.luna.content, /one persistent Luna role/);
  assert.deepEqual(activeSandboxAssignments(TEMPLATES.luna.content), ["workspace-write"]);
  assert.match(TEMPLATES.luna.content, /luna_execution_enabled/);
  assert.match(TEMPLATES.luna.content, /ACTIVE_EXECUTOR/);
  assert.match(TEMPLATES.luna.content, /INTERACTION_ONLY/);
  assert.match(TEMPLATES.luna.content, /DETACHED/);
  assert.match(TEMPLATES.luna.content, /runtime authority derives from `luna_mode`/);
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
  assert.match(TEMPLATES.sol.content, /retain the same Luna identity as INTERACTION_ONLY/);
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
  assert.match(skill, /Verification-failure rollback contract/);
  assert.match(skill, /CORRECTABLE/);
  assert.match(skill, /BLOCK_AND_ESCALATE/);
});

test("bilingual README workflow overview uses the dedicated diagrams", () => {
  const chinese = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const english = readFileSync(new URL("../README.en.md", import.meta.url), "utf8");

  assert.doesNotMatch(chinese, /primary Sol 的 INITIAL 不建立 Luna，只使用 Terra 子代理/);
  assert.doesNotMatch(english, /primary Sol INITIAL has no Luna child and uses Terra as the only child executor/);
  assert.match(chinese, /## 多代理工作流程總覽/);
  assert.match(chinese, /docs\/images\/zh-TW\/multi-agent-workflow-overview-zh-TW\.png/);
  assert.doesNotMatch(chinese, /## 工作流程契約|SOL_REPLAN_WITH_LUNA|SOL_PLAN_REVIEW_WITH_TERRA|SOL_FULL_TAKEOVER/);
  assert.match(english, /## Multi-Agent Workflow Overview/);
  assert.match(english, /docs\/images\/en\/multi-agent-workflow-overview-en\.png/);
  assert.doesNotMatch(english, /## Workflow contract|SOL_REPLAN_WITH_LUNA|SOL_PLAN_REVIEW_WITH_TERRA|SOL_FULL_TAKEOVER/);
});

test("the full plan contract is centralized and role prompts stay compact", () => {
  const contracts = [
    ["terra", [/workflow_id/, /PLAN_ARTIFACT_PATH/, /CODEX_ROOT/, /do not write PLAN_PATH/, /current stage, Luna mode/]],
    ["luna", [/same workflow_id/, /PLAN_ARTIFACT_PATH/, /ACTIVE_EXECUTOR/, /INTERACTION_ONLY/, /current stage, Luna mode/]],
    ["sol", [/same workflow_id/, /PLAN_ARTIFACT_PATH/, /complete revised plan content/, /do not write PLAN_PATH/, /current stage, Luna mode/]],
    ["skill", [/PLAN_ARTIFACT_PATH/, /model-router\/workflows\/<workflow_id>\/PLAN\.md/, /active writable executor/, /cleanup-failed/]],
    ["planning", [/workflow_id/, /PLAN_ARTIFACT_PATH/, /CODEX_ROOT/, /source-tree path/, /current stage, Luna mode/]]
  ];

  for (const [name, patterns] of contracts) {
    const content = TEMPLATES[name].content;
    for (const pattern of patterns) assert.match(content, pattern, `${name} missing ${pattern}`);
    assert.doesNotMatch(content, /workspace PLAN\.md|workspace\/PLAN\.md|workspace\\PLAN\.md/i);
    if (name !== "skill") {
      assert.doesNotMatch(content, /Workflow recovery \(declarative host contract/);
      assert.doesNotMatch(content, /Workflow escalation \(declarative host contract/);
      assert.doesNotMatch(content, /Plan artifact \(declarative host contract/);
    }
  }
  assert.equal(WORKFLOW_PLAN_ARTIFACT_CONTRACT.path, "<CODEX_ROOT>/model-router/workflows/<workflow_id>/PLAN.md");
  assert.deepEqual(WORKFLOW_ROLLBACK_CONTRACT.failureClasses, [
    "CORRECTABLE",
    "SCOPE_VIOLATION",
    "WORKSPACE_POLLUTION",
    "WORKSPACE_CORRUPTION",
    "DEPENDENCY_CORRUPTION",
    "EXTERNAL_SIDE_EFFECT",
    "SECURITY_RISK",
    "UNKNOWN_STATE"
  ]);
});

test("Luna action policy is canonical, disjoint, and has a bounded prompt surface", () => {
  assert.deepEqual(WORKFLOW_LUNA_INTERACTION_CONTRACT.modes, ["ACTIVE_EXECUTOR", "INTERACTION_ONLY", "DETACHED"]);
  assert.deepEqual(WORKFLOW_LUNA_INTERACTION_CONTRACT.modeByStage, {
    INITIAL: "ACTIVE_EXECUTOR",
    SOL_REPLAN_WITH_LUNA: "ACTIVE_EXECUTOR",
    SOL_PLAN_REVIEW_WITH_TERRA: "INTERACTION_ONLY",
    SOL_FULL_TAKEOVER: "INTERACTION_ONLY"
  });
  const categories = Object.values(WORKFLOW_LUNA_INTERACTION_CONTRACT.actionPolicy);
  const allActions = categories.flat();
  assert.equal(new Set(allActions).size, allActions.length);
  assert.equal(WORKFLOW_LUNA_INTERACTION_CONTRACT.resultFields.includes("artifact_refs"), true);
  assert.equal(WORKFLOW_LUNA_INTERACTION_CONTRACT.resultFields.includes("redactions"), true);
  assert.ok(TEMPLATES.terra.content.length < 5000);
  assert.ok(TEMPLATES.luna.content.length < 5000);
  assert.ok(TEMPLATES.sol.content.length < 5000);
  assert.ok(TEMPLATES.planning.content.length < 5000);
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
