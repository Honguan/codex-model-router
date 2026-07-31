import assert from "node:assert/strict";
import test from "node:test";
import { extractChangelogSection, validateReleaseContext } from "../scripts/release-metadata.js";

test("extracts only the current LF changelog entry", () => {
  const changelog = "# Changelog\n\n## 1.2.0 - 2026-07-31\n\n- Current.\n\n## 1.1.1 - 2026-07-30\n\n- Old.\n";
  assert.equal(extractChangelogSection(changelog, "1.2.0"), "## 1.2.0 - 2026-07-31\n\n- Current.\n");
});

test("extracts a CRLF changelog entry", () => {
  const changelog = "# Changelog\r\n\r\n## 1.2.0 - date\r\n\r\n- Current.\r\n\r\n## 1.1.1 - date\r\n- Old.\r\n";
  assert.match(extractChangelogSection(changelog, "1.2.0"), /Current/);
  assert.doesNotMatch(extractChangelogSection(changelog, "1.2.0"), /Old/);
});

test("rejects missing, duplicate, malformed, and empty entries", () => {
  assert.throws(() => extractChangelogSection("# Changelog\n## 1.1.0\n- old\n", "1.2.0"), /no entry/);
  assert.throws(() => extractChangelogSection("# Changelog\n## 1.2.0\n- one\n## 1.2.0\n- two\n", "1.2.0"), /duplicate/);
  assert.throws(() => extractChangelogSection("# Changelog\n## next\n- bad\n", "1.2.0"), /malformed/);
  assert.throws(() => extractChangelogSection("# Changelog\n## 1.2.0\n## 1.1.0\n- old\n", "1.2.0"), /empty/);
});

test("release context accepts only the trusted repository and exact version tag", () => {
  for (const eventName of ["push", "workflow_dispatch"]) {
    assert.equal(validateReleaseContext({
      repository: "Honguan/codex-model-router",
      eventName,
      refType: "tag",
      refName: "v1.2.0",
      version: "1.2.0"
    }), "v1.2.0");
  }
  assert.throws(() => validateReleaseContext({
    repository: "fork/codex-model-router",
    eventName: "push",
    refType: "tag",
    refName: "v1.2.0",
    version: "1.2.0"
  }), /not trusted/);
  assert.throws(() => validateReleaseContext({
    repository: "Honguan/codex-model-router",
    eventName: "workflow_dispatch",
    refType: "branch",
    refName: "main",
    version: "1.2.0"
  }), /exact tag/);
  assert.throws(() => validateReleaseContext({
    repository: "Honguan/codex-model-router",
    eventName: "push",
    refType: "tag",
    refName: "v1.2.1",
    version: "1.2.0"
  }), /does not match/);
});
