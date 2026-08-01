import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = (await readFile(join(root, ".github", "workflows", "release.yml"), "utf8"))
  .replace(/\r\n/g, "\n");

function jobBlock(name, nextName) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `${name} job is missing`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:\n`, start + 1) : workflow.length;
  assert.notEqual(end, -1, `${nextName} job is missing`);
  return workflow.slice(start, end);
}

test("tag preparation cannot publish and publication requires the existing tag", () => {
  const prepare = jobBlock("prepare_tag", "release");
  const release = jobBlock("release");

  assert.match(prepare, /inputs\.action == 'prepare-and-release'/);
  assert.match(prepare, /git push origin "refs\/tags\/\$RELEASE_TAG"/);
  assert.match(prepare, /Remote tag verification failed/);
  assert.doesNotMatch(prepare, /npm publish/);

  assert.match(release, /needs: prepare_tag/);
  assert.match(release, /ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(release, /does not exist on the remote; publication is forbidden/);
  assert.match(release, /npm publish --access public --provenance/);

  const verify = release.indexOf("does not exist on the remote; publication is forbidden");
  const publish = release.indexOf("npm publish --access public --provenance");
  assert(verify >= 0 && publish > verify, "remote tag verification must precede publication");
});

test("release workflow uses OIDC only and supports existing-tag retry", () => {
  assert.match(workflow, /- prepare-and-release\n\s+- retry-release/);
  assert.match(workflow, /inputs\.action == 'retry-release'/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /bootstrap/i);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
});
