import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
const normalized = workflow.replace(/\r\n/g, "\n");

function jobBlock(name, nextName) {
  const start = normalized.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `${name} job is missing`);
  const end = nextName ? normalized.indexOf(`  ${nextName}:\n`, start + 1) : normalized.length;
  assert.notEqual(end, -1, `${nextName} job is missing`);
  return normalized.slice(start, end);
}

test("release workflow separates tag preparation from publication", () => {
  const prepare = jobBlock("prepare_tag", "release");
  const release = jobBlock("release");

  assert.match(prepare, /inputs\.action == 'prepare-and-release'/);
  assert.match(prepare, /npm run check/);
  assert.match(prepare, /npm test/);
  assert.match(prepare, /npm run test:package/);
  assert.match(prepare, /git push origin "refs\/tags\/\$RELEASE_TAG"/);
  assert.doesNotMatch(prepare, /npm publish/);

  assert.match(release, /needs: prepare_tag/);
  assert.match(release, /ref: \$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(release, /does not exist on the remote; publication is forbidden/);
  assert.match(release, /npm publish --access public --provenance/);

  const remoteTagCheck = release.indexOf("does not exist on the remote; publication is forbidden");
  const publish = release.indexOf("npm publish --access public --provenance");
  assert(remoteTagCheck >= 0 && publish > remoteTagCheck, "remote tag verification must precede publication");
});

test("release workflow supports only tag-first preparation and existing-tag retry", () => {
  assert.match(normalized, /- prepare-and-release\n\s+- retry-release/);
  assert.match(normalized, /inputs\.action == 'retry-release'/);
  assert.doesNotMatch(normalized, /bootstrap/i);
  assert.doesNotMatch(normalized, /NPM_TOKEN/);
  assert.match(normalized, /id-token: write/);
  assert.match(normalized, /git ls-remote --exit-code --tags origin/);
  assert.match(normalized, /refusing to move or overwrite it/);
});
