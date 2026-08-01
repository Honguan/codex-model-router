import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const testDirectory = join(root, "test");
const files = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => join(testDirectory, entry.name))
  .sort((left, right) => left.localeCompare(right));

if (!files.length) {
  console.error("No root test files were found.");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
