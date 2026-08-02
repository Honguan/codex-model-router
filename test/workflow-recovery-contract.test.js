import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_TEMPLATES, TEMPLATES, WORKFLOW_AGENT_FAST_CONTRACT, WORKFLOW_ESCALATION_CONTRACT, WORKFLOW_RECOVERY_CONTRACT } from "../lib/manifest.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const canonicalResults = WORKFLOW_RECOVERY_CONTRACT.canonicalResultCodes;
const decisions = WORKFLOW_RECOVERY_CONTRACT.decisions;
const maxChildren = WORKFLOW_RECOVERY_CONTRACT.maxChildren;

function registry(agents, root_session_id = "root-1", workflow_id = "workflow-1") {
  return {
    version: WORKFLOW_RECOVERY_CONTRACT.stateVersion,
    root_session_id,
    workflow_id,
    agents,
    diagnostics: []
  };
}

const matchers = Object.freeze({
  "stale-root-workflow": (context) => context.stale,
  "saved-role-outside-ordered-policy-set": (context) => !context.policy.has(context.role) || context.disabled.has(context.role),
  "invalid-or-malformed-agent-id": (context) => typeof context.instance.agent_id !== "string" || !/^agent-[a-z0-9-]+$/.test(context.instance.agent_id),
  "runtime-resumable": (context) => context.runtime.state === "resumable",
  "confirmed-unusable-and-replacement-allowed": (context) => context.runtime.confirmed === true && ["missing", "closed", "invalid", "unsupported", "resume-failed"].includes(context.runtime.state) && context.replacementAllowed && context.hostCreationSupported,
  "resume-failed-without-allowed-replacement": (context) => context.runtime.state === "resume-failed",
  "unknown-or-unsupported": () => true
});

function evaluateRecovery({ saved, validRoles, runtime = {}, expectedRootSessionId = "root-1", expectedWorkflowId = "workflow-1", replacementAllowed = false, hostCreationSupported = false, disabledRoles = [] }) {
  const actions = [];
  if (validRoles.length > maxChildren) return { results: {}, actions, evidenceGap: true, mutated: false };

  const stale = saved.root_session_id !== expectedRootSessionId || saved.workflow_id !== expectedWorkflowId;
  const contextBase = {
    stale,
    policy: new Set(validRoles),
    disabled: new Set(disabledRoles),
    replacementAllowed,
    hostCreationSupported
  };
  const results = {};
  for (const [role, instance] of Object.entries(saved.agents)) {
    const context = {
      ...contextBase,
      role,
      instance,
      runtime: runtime[role] ?? { state: "unknown", confirmed: false }
    };
    const decision = decisions.find((candidate) => matchers[candidate.match](context));
    assert.ok(decision, `production contract has no decision for ${role}`);
    results[role] = decision.result;
    if (decision.action === "host-create-preserve-handoff") actions.push({ type: "create", role, handoff: instance.handoff });
  }
  return { results, actions, evidenceGap: false, mutated: true };
}

function atomicPersist(previous, next, failAt) {
  const actions = [];
  for (const step of WORKFLOW_RECOVERY_CONTRACT.atomicSteps) {
    actions.push(step);
    if (step === failAt) return { state: previous, published: false, actions: [] };
  }
  return { state: next, published: true, actions };
}

test("the exported structured contract is declarative and drives every template (contract fixture; not live E2E)", () => {
  assert.equal(WORKFLOW_RECOVERY_CONTRACT.stateVersion, 1);
  assert.equal(WORKFLOW_RECOVERY_CONTRACT.maxChildren, 2);
  assert.deepEqual(WORKFLOW_RECOVERY_CONTRACT.requiredRootFields, ["root_session_id", "workflow_id", "agents"]);
  assert.deepEqual(WORKFLOW_RECOVERY_CONTRACT.atomicSteps, ["flush", "close", "rename"]);
  assert.equal(Object.isFrozen(WORKFLOW_RECOVERY_CONTRACT), true);
  const production = TEMPLATES.skill.content;
  for (const result of canonicalResults) assert.match(production, new RegExp(`\\b${escapeRegex(result)}\\b`));
  for (const decision of decisions) assert.match(production, new RegExp(escapeRegex(decision.description)));
  assert.match(production, /RECOVERY_STATE_PATH=<ARTIFACT_DIR>\/recovery-state\.v1\.json/);
  assert.match(production, /agents must be an object, never an array/i);
  assert.match(production, /primary thread.*regardless of selected model.*owns RECOVERY_STATE_PATH/s);
});

test("all installed templates carry the root registry and atomic failure contract (contract fixture; not live E2E)", () => {
  for (const [name, template] of Object.entries(TEMPLATES)) {
    assert.match(template.content, /RECOVERY_STATE_PATH=<ARTIFACT_DIR>\/recovery-state\.v1\.json/, `${name} state path`);
    assert.match(template.content, /root_session_id/);
    assert.match(template.content, /workflow_id/);
    assert.match(template.content, /agents.*role.*agent_id.*status.*handoff/s);
    assert.match(template.content, /agents must be an object, never an array/i);
    assert.match(template.content, /flush.*close.*rename/s, `${name} atomic write sequence`);
    assert.match(template.content, /prior registry/);
    assert.match(template.content, /no dependent action/);
    assert.match(template.content, /Never claim process persistence/);
  }
});

test("full reuse and partial reuse outcomes are deterministic (contract fixture; not live E2E)", () => {
  const full = evaluateRecovery({
    validRoles: ["terra", "sol"],
    saved: registry({
      terra: { agent_id: "agent-terra", status: "saved", handoff: "t" },
      sol: { agent_id: "agent-sol", status: "saved", handoff: "s" }
    }),
    runtime: { terra: { state: "resumable" }, sol: { state: "resumable" } }
  });
  assert.deepEqual(full.results, { terra: "reused", sol: "reused" });
  assert.deepEqual(full.actions, []);

  const partial = evaluateRecovery({
    validRoles: ["terra", "sol"],
    saved: registry({
      terra: { agent_id: "agent-terra", status: "saved", handoff: "t" },
      sol: { agent_id: "agent-sol", status: "saved", handoff: "s" }
    }),
    runtime: { terra: { state: "resumable" }, sol: { state: "unsupported", confirmed: false } }
  });
  assert.deepEqual(partial.results, { terra: "reused", sol: "not-supported" });
  assert.deepEqual(partial.actions, []);
});

test("replacement, stale, invalid, and unsupported branches preserve exact outcomes (contract fixture; not live E2E)", () => {
  const replaced = evaluateRecovery({
    validRoles: ["terra", "sol"],
    replacementAllowed: true,
    hostCreationSupported: true,
    saved: registry({
      terra: { agent_id: "agent-terra", status: "saved", handoff: "terra-handoff" },
      sol: { agent_id: "agent-sol", status: "saved", handoff: "sol-handoff" }
    }),
    runtime: {
      terra: { state: "missing", confirmed: true },
      sol: { state: "resume-failed", confirmed: true }
    }
  });
  assert.deepEqual(replaced.results, { terra: "replaced", sol: "replaced" });
  assert.deepEqual(replaced.actions, [
    { type: "create", role: "terra", handoff: "terra-handoff" },
    { type: "create", role: "sol", handoff: "sol-handoff" }
  ]);

  const stale = evaluateRecovery({
    validRoles: ["terra", "sol"],
    saved: registry({
      terra: { agent_id: "agent-terra", status: "saved", handoff: "t" },
      sol: { agent_id: "agent-sol", status: "saved", handoff: "s" }
    }, "root-old", "workflow-old"),
    expectedRootSessionId: "root-new",
    expectedWorkflowId: "workflow-new",
    runtime: { terra: { state: "resumable" }, sol: { state: "missing", confirmed: true } },
    replacementAllowed: true,
    hostCreationSupported: true
  });
  assert.deepEqual(stale.results, { terra: "stale-workflow", sol: "stale-workflow" });
  assert.deepEqual(stale.actions, []);

  const invalid = evaluateRecovery({
    validRoles: ["terra"],
    saved: registry({ terra: { agent_id: "not an exact id", status: "saved", handoff: "t" } }),
    runtime: { terra: { state: "resumable" } }
  });
  assert.deepEqual(invalid.results, { terra: "invalid-agent-id" });

  const unsupported = evaluateRecovery({
    validRoles: ["terra", "sol"],
    saved: registry({
      terra: { agent_id: "agent-terra", status: "saved", handoff: "t" },
      sol: { agent_id: "agent-sol", status: "saved", handoff: "s" }
    }),
    runtime: { terra: { state: "unknown", confirmed: false }, sol: { state: "unsupported", confirmed: false } }
  });
  assert.deepEqual(unsupported.results, { terra: "not-supported", sol: "not-supported" });
  assert.deepEqual(unsupported.actions, []);
});

test("policy removal handles primary switch, disabled executor, and extra saved roles (contract fixture; not live E2E)", () => {
  const switched = evaluateRecovery({
    validRoles: ["luna"],
    saved: registry({
      terra: { agent_id: "agent-terra", status: "saved", handoff: "old-primary" },
      luna: { agent_id: "agent-luna", status: "saved", handoff: "l" }
    }),
    runtime: { terra: { state: "resumable" }, luna: { state: "resumable" } }
  });
  assert.deepEqual(switched.results, { terra: "removed-by-policy", luna: "reused" });

  const disabled = evaluateRecovery({
    validRoles: ["luna"],
    disabledRoles: ["luna"],
    saved: registry({ luna: { agent_id: "agent-luna", status: "saved", handoff: "l" } }),
    runtime: { luna: { state: "resumable" } }
  });
  assert.deepEqual(disabled.results, { luna: "removed-by-policy" });

  const extra = evaluateRecovery({
    validRoles: ["terra", "sol"],
    saved: registry({
      terra: { agent_id: "agent-terra", status: "saved", handoff: "t" },
      sol: { agent_id: "agent-sol", status: "saved", handoff: "s" },
      luna: { agent_id: "agent-luna", status: "saved", handoff: "extra" }
    }),
    runtime: { terra: { state: "resumable" }, sol: { state: "resumable" }, luna: { state: "resumable" } }
  });
  assert.deepEqual(extra.results, { terra: "reused", sol: "reused", luna: "removed-by-policy" });
  assert.deepEqual(extra.actions, []);
});

test("invalid policy topology is an evidence gap with no mutation, results, or actions (contract fixture; not live E2E)", () => {
  const gap = evaluateRecovery({
    validRoles: ["terra", "luna", "sol"],
    saved: registry({ terra: { agent_id: "agent-terra", status: "saved", handoff: "t" } }),
    runtime: { terra: { state: "resumable" } }
  });
  assert.equal(gap.evidenceGap, true);
  assert.deepEqual(gap.results, {});
  assert.deepEqual(gap.actions, []);
  assert.equal(gap.mutated, false);
});

test("resume failure is distinct with and without allowed replacement (contract fixture; not live E2E)", () => {
  const noReplacement = evaluateRecovery({
    validRoles: ["terra"],
    saved: registry({ terra: { agent_id: "agent-terra", status: "saved", handoff: "t" } }),
    runtime: { terra: { state: "resume-failed", confirmed: true } }
  });
  assert.deepEqual(noReplacement.results, { terra: "resume-failed" });
  assert.deepEqual(noReplacement.actions, []);

  const withReplacement = evaluateRecovery({
    validRoles: ["terra"],
    replacementAllowed: true,
    hostCreationSupported: true,
    saved: registry({ terra: { agent_id: "agent-terra", status: "saved", handoff: "t" } }),
    runtime: { terra: { state: "resume-failed", confirmed: true } }
  });
  assert.deepEqual(withReplacement.results, { terra: "replaced" });
  assert.deepEqual(withReplacement.actions, [{ type: "create", role: "terra", handoff: "t" }]);
});

test("atomic failure derives steps from the production contract and preserves prior state (contract fixture; not live E2E)", () => {
  const previous = registry({ terra: { agent_id: "agent-terra", status: "saved", handoff: "old" } });
  const next = registry({ terra: { agent_id: "agent-new", status: "saved", handoff: "new" } });
  for (const failAt of WORKFLOW_RECOVERY_CONTRACT.atomicSteps) {
    const failed = atomicPersist(previous, next, failAt);
    assert.equal(failed.published, false);
    assert.deepEqual(failed.state, previous);
    assert.deepEqual(failed.actions, []);
  }
  const published = atomicPersist(previous, next);
  assert.equal(published.published, true);
  assert.deepEqual(published.actions, [...WORKFLOW_RECOVERY_CONTRACT.atomicSteps]);
  assert.deepEqual(published.state, next);
});

test("canonical results and migration entries remain explicit (contract fixture; not live E2E)", () => {
  for (const [name, entries] of Object.entries(LEGACY_TEMPLATES)) {
    assert.ok(entries.some((entry) => !entry.includes("RECOVERY_STATE_PATH=<ARTIFACT_DIR>/recovery-state.v1.json")), `${name} legacy entry`);
  }
});

test("recovery owns only the committed identity/topology projection and does not duplicate escalation state (contract fixture; not live E2E)", () => {
  assert.equal(WORKFLOW_ESCALATION_CONTRACT.requiredStateFields.includes("agents"), false);
  assert.notEqual(WORKFLOW_ESCALATION_CONTRACT.workflowStatePath, "<ARTIFACT_DIR>/recovery-state.v1.json");
  assert.deepEqual(WORKFLOW_RECOVERY_CONTRACT.requiredRootFields, ["root_session_id", "workflow_id", "agents"]);
});

test("Fast recovery metadata remains role-local and never becomes a primary or reasoning setting (contract fixture; not live E2E)", () => {
  assert.deepEqual(WORKFLOW_RECOVERY_CONTRACT.fast, {
    agentField: "fast",
    reuse: "preserve-same-role-only",
    replacement: "copy-unchanged",
    primary: "never-apply"
  });
  assert.equal(WORKFLOW_AGENT_FAST_CONTRACT.propagation, "preserve-same-role-only");
  assert.equal(WORKFLOW_AGENT_FAST_CONTRACT.primary, "never-apply");
  assert.equal(WORKFLOW_AGENT_FAST_CONTRACT.reasoning, "independent");
  for (const name of ["terra", "luna", "sol"]) {
    assert.match(TEMPLATES[name].content, /Fast preferences are role-specific managed metadata/);
  }
});
