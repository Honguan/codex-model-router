import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const VERSION = packageJson.version;

export const DEFAULTS = Object.freeze({
  model: "gpt-5.6-terra",
  model_reasoning_effort: "high"
});

const luna = `name = "luna"
description = "Low-risk helper for repeated edits, searches, formatting, extraction, counting, and summaries."
model = "gpt-5.6-luna"
model_reasoning_effort = "high"
developer_instructions = """
Handle only deterministic, low-risk work delegated by Terra.
Follow the assigned pattern exactly and return a concise result.
Escalate ambiguous, security-sensitive, or logic-heavy decisions to Terra.
"""
`;

const sol = `name = "sol"
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

const skill = `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol with the fewest required agents.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.
Use Sol for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Prefer review-only delegation first; when implementation or a confirmed fix is explicitly required, Sol may edit files in workspace-write mode and run relevant checks.
Do not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.
`;

export const TEMPLATES = Object.freeze({
  luna: Object.freeze({ relative: ["agents", "luna.toml"], content: luna }),
  sol: Object.freeze({ relative: ["agents", "sol.toml"], content: sol }),
  skill: Object.freeze({ content: skill })
});

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

const legacySkillReadOnly = `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol with the fewest required agents.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation. Never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer Luna when the same clear operation repeats at least three times.
Use Sol only as a read-only reviewer for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Terra applies fixes.
Do not spawn a subagent for a simple question. Use the minimum number of agents and run Luna with Sol only when both independent tasks are required.
`;

export const LEGACY_TEMPLATES = Object.freeze({
  luna: Object.freeze([]),
  sol: Object.freeze([legacySolReadOnly]),
  skill: Object.freeze([legacySkillReadOnly])
});

export const AGENT_EXPECTATIONS = Object.freeze({
  luna: Object.freeze({
    name: "luna",
    model: "gpt-5.6-luna",
    model_reasoning_effort: "high"
  }),
  sol: Object.freeze({
    name: "sol",
    model: "gpt-5.6-sol",
    model_reasoning_effort: "medium",
    sandbox_mode: "workspace-write"
  })
});
