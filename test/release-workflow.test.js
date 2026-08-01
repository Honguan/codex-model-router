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

  const resolve = stepIndex(workflow, "Resolve release target");
  const metadata = stepIndex(workflow, "Validate release metadata and extract notes");
  const createTag = stepIndex(workflow, "Create missing release tag");
  const verifyTag = stepIndex(workflow, "Verify and check out release tag");
  const inspectNpm = stepIndex(workflow, "Inspect npm package state");
  const bootstrapPublish = stepIndex(workflow, "Bootstrap first npm publication with token and provenance");
  const trustedPublish = stepIndex(workflow, "Publish to npm with Trusted Publishing and provenance");
  const githubRelease = stepIndex(workflow, "Create GitHub Release");

  assert(resolve < metadata);
  assert(metadata < createTag);
  assert(createTag < verifyTag);
  assert(verifyTag < inspectNpm);
  assert(inspectNpm < bootstrapPublish);
  assert(inspectNpm < trustedPublish);
  assert(bootstrapPublish < githubRelease);
  assert(trustedPublish < githubRelease);

  assert.match(workflow, /if: steps\.target\.outputs\.create_tag == 'true'/);
  assert.match(workflow, /git push origin "refs\/tags\/\$RELEASE_TAG"/);
  assert.match(workflow, /git checkout --detach "\$RELEASE_TAG"/);
  assert.match(workflow, /git describe --tags --exact-match HEAD/);
  assert.match(workflow, /Only a manual Release run may create a missing tag/);
  assert.doesNotMatch(workflow, /Missing release tags can be created only by a manual bootstrap run/);
  assert.doesNotMatch(workflow, /\[ "\$PUBLISH_MODE" != "bootstrap" \].*create a missing tag/);
});

test("manual and tag-triggered runs share one release concurrency key", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(
    workflow,
    /group: release-\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref_name \}\}/
  );
});
