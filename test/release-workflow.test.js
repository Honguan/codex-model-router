import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/release.yml", import.meta.url);

function stepIndex(workflow, name) {
  const index = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(index, -1, `missing Release workflow step: ${name}`);
  return index;
}

test("Release creates and verifies the exact tag before npm publication", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  const metadata = stepIndex(workflow, "Validate release metadata before tagging");
  const createTag = stepIndex(workflow, "Create and push the validated tag");
  const verifyTag = stepIndex(workflow, "Verify the existing release tag");
  const inspectNpm = stepIndex(workflow, "Inspect npm package state");
  const trustedPublish = stepIndex(workflow, "Publish to npm with Trusted Publishing and provenance");
  const githubRelease = stepIndex(workflow, "Create GitHub Release");

  assert(metadata < createTag);
  assert(createTag < verifyTag);
  assert(verifyTag < inspectNpm);
  assert(inspectNpm < trustedPublish);
  assert(trustedPublish < githubRelease);

  assert.match(workflow, /prepare_tag:/);
  assert.match(workflow, /needs: prepare_tag/);
  assert.match(workflow, /git push origin "refs\/tags\/\$RELEASE_TAG"/);
  assert.match(workflow, /ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /does not exist on the remote; publication is forbidden/);
  assert.match(workflow, /inputs\.action == 'retry-release'/);
  assert.doesNotMatch(workflow, /bootstrap/i);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});

test("manual and tag-triggered runs share one release concurrency key", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(
    workflow,
    /group: release-\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref_name \}\}/
  );
});
