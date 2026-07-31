import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractChangelogSection,
  resolveReleaseReference,
  validateReleaseContext
} from "../scripts/release-metadata.js";

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

test("explicit release reference overrides the workflow branch reference", () => {
  assert.deepEqual(resolveReleaseReference({
    GITHUB_REF_TYPE: "branch",
    GITHUB_REF_NAME: "main",
    RELEASE_REF_TYPE: "tag",
    RELEASE_REF_NAME: "v1.2.0"
  }), {
    refType: "tag",
    refName: "v1.2.0"
  });
  assert.deepEqual(resolveReleaseReference({
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: "v1.2.0"
  }), {
    refType: "tag",
    refName: "v1.2.0"
  });
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
  }), /explicit manual retry tag/);
  assert.throws(() => validateReleaseContext({
    repository: "Honguan/codex-model-router",
    eventName: "push",
    refType: "tag",
    refName: "v1.2.1",
    version: "1.2.0"
  }), /does not match/);
});

test("release workflow requires an explicit and isolated first-publication bootstrap", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(workflow, /publish_mode:/);
  assert.match(workflow, /type: choice/);
  assert.match(workflow, /- normal\n\s+- bootstrap/);
  assert.match(workflow, /PUBLISH_MODE: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.publish_mode \|\| 'normal' \}\}/);
  assert.match(workflow, /Bootstrap first npm publication with token and provenance/);
  assert.match(workflow, /env\.PUBLISH_MODE == 'bootstrap'/);
  assert.match(workflow, /Publish to npm with Trusted Publishing and provenance/);
  assert.match(workflow, /env\.PUBLISH_MODE == 'normal'/);
  assert.match(workflow, /Run this exact tag manually with publish_mode=bootstrap/);
  assert.match(workflow, /Bootstrap mode is only for creating the npm package/);
  assert.equal(workflow.match(/secrets\.NPM_TOKEN/g)?.length, 1);
  assert.equal(workflow.match(/^\s+NODE_AUTH_TOKEN:/gm)?.length, 1);
});
