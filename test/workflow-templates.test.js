import assert from "node:assert/strict";
import test from "node:test";
import { TEMPLATES } from "../lib/manifest.js";

test("Luna reads requirements and remains the single writable role", () => {
  assert.match(TEMPLATES.luna.content, /REQUIREMENT_EVIDENCE/);
  assert.match(TEMPLATES.luna.content, /one persistent Luna role/);
  assert.match(TEMPLATES.luna.content, /sandbox_mode = "workspace-write"/);
  assert.match(TEMPLATES.luna.content, /Do not self-approve/);
});

test("Terra plans and verifies without implementation writes", () => {
  assert.match(TEMPLATES.terra.content, /PLAN\.md/);
  assert.match(TEMPLATES.terra.content, /FAIL_IMPLEMENTATION/);
  assert.match(TEMPLATES.terra.content, /FAIL_PLAN/);
  assert.match(TEMPLATES.terra.content, /sandbox_mode = "read-only"/);
  assert.match(TEMPLATES.terra.content, /Never edit implementation files/);
});

test("Sol is a read-only non-PASS replanner", () => {
  assert.match(TEMPLATES.sol.content, /non-PASS verification verdict/);
  assert.match(TEMPLATES.sol.content, /Rewrite only affected PLAN\.md sections/);
  assert.match(TEMPLATES.sol.content, /sandbox_mode = "read-only"/);
  assert.match(TEMPLATES.sol.content, /Do not edit implementation files/);
});

test("router reuses matching primary models and bounds correction", () => {
  const skill = TEMPLATES.skill.content;
  assert.match(skill, /Never launch duplicate same-model agents/);
  assert.match(skill, /If the primary is Luna/);
  assert.match(skill, /If the primary is Terra/);
  assert.match(skill, /If the primary is Sol/);
  assert.match(skill, /never exceed three total implementation-verification cycles/);
  assert.match(skill, /ordinary questions, explanations, read-only analysis/);
});
