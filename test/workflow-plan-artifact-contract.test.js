import assert from "node:assert/strict";
import test from "node:test";
import { TEMPLATES, WORKFLOW_PLAN_ARTIFACT_CONTRACT } from "../lib/manifest.js";

const contract = WORKFLOW_PLAN_ARTIFACT_CONTRACT;

function artifactPath(root, workflowId) {
  return `${root}/model-router/workflows/${workflowId}/PLAN.md`;
}

function writableOwner({ stage, primary = "luna", lunaEnabled = true, terraEnabled = true, solFullTakeover = false }) {
  if (stage === "SOL_FULL_TAKEOVER") return solFullTakeover ? "sol" : null;
  if (stage === "SOL_PLAN_REVIEW_WITH_TERRA") return terraEnabled ? "terra" : null;
  if (stage === "SOL_REPLAN_WITH_LUNA") return lunaEnabled ? "luna" : null;
  return lunaEnabled ? "luna" : null;
}

test("the immutable plan-artifact contract defines scoped state, lifecycle, and every template", () => {
  assert.equal(Object.isFrozen(contract), true);
  assert.deepEqual(contract.stateFields, ["plan_path", "plan_artifact_owner", "plan_cleanup_owner", "plan_cleanup_required", "plan_artifact_status"]);
  assert.deepEqual(contract.statuses, ["missing", "pending-write", "active", "pending-cleanup", "retained", "removed", "cleanup-failed"]);
  assert.equal(contract.path, "<CODEX_ROOT>/model-router/workflows/<workflow_id>/PLAN.md");
  for (const template of Object.values(TEMPLATES)) {
    for (const field of contract.stateFields) assert.match(template.content, new RegExp(field));
    for (const rule of contract.ownershipRules) assert.match(template.content, new RegExp(rule.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("creation, revision, executor disablement, and takeover choose only an authorized writer", () => {
  assert.equal(writableOwner({ stage: "INITIAL", primary: "luna" }), "luna");
  assert.equal(writableOwner({ stage: "INITIAL", primary: "sol" }), "luna");
  assert.equal(writableOwner({ stage: "SOL_REPLAN_WITH_LUNA" }), "luna");
  assert.equal(writableOwner({ stage: "SOL_PLAN_REVIEW_WITH_TERRA", lunaEnabled: false }), "terra");
  assert.equal(writableOwner({ stage: "SOL_FULL_TAKEOVER", lunaEnabled: false, terraEnabled: false, solFullTakeover: true }), "sol");
  assert.equal(writableOwner({ stage: "SOL_REPLAN_WITH_LUNA", lunaEnabled: false }), null);
  assert.equal(writableOwner({ stage: "SOL_FULL_TAKEOVER", solFullTakeover: false }), null);
});

test("resume, replacement, switches, cancellation, and cleanup preserve the exact workflow directory", () => {
  const root = "C:/project/.codex";
  const workflowId = "workflow-92";
  const path = artifactPath(root, workflowId);
  assert.equal(path, "C:/project/.codex/model-router/workflows/workflow-92/PLAN.md");
  assert.equal(artifactPath(root, workflowId), path, "resume and replacement retain path");
  assert.equal(artifactPath(root, "workflow-93"), "C:/project/.codex/model-router/workflows/workflow-93/PLAN.md", "new task cannot overwrite old path");

  const active = { plan_path: path, plan_artifact_owner: "luna", plan_cleanup_owner: "luna", plan_cleanup_required: false, plan_artifact_status: "active" };
  const switched = { ...active, plan_artifact_owner: "terra", plan_cleanup_owner: "terra" };
  assert.equal(switched.plan_path, active.plan_path, "primary switch preserves artifact path");
  const pendingCleanup = { ...switched, plan_artifact_status: "pending-cleanup", plan_cleanup_required: true };
  assert.equal(pendingCleanup.plan_cleanup_owner, "terra");
  const failedCleanup = { ...pendingCleanup, plan_artifact_status: "cleanup-failed" };
  assert.equal(failedCleanup.plan_path, path, "cleanup failure remains persisted for retry");
  assert.equal(failedCleanup.plan_artifact_status, "cleanup-failed");
});
