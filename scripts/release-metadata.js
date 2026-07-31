#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function extractChangelogSection(content, version) {
  if (!SEMVER.test(version)) throw new Error(`invalid package version: ${version}`);
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("## ")) continue;
    const match = lines[index].match(/^##\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+-\s+.+)?\s*$/);
    if (!match) throw new Error(`malformed changelog heading on line ${index + 1}: ${lines[index]}`);
    headings.push({ index, version: match[1] });
  }
  const matches = headings.filter((heading) => heading.version === version);
  if (matches.length === 0) throw new Error(`CHANGELOG.md has no entry for ${version}`);
  if (matches.length > 1) throw new Error(`CHANGELOG.md has duplicate entries for ${version}`);
  const start = matches[0].index;
  const next = headings.find((heading) => heading.index > start);
  const end = next?.index ?? lines.length;
  const section = lines.slice(start, end).join("\n").trim();
  if (!section || section === lines[start].trim()) throw new Error(`CHANGELOG.md entry for ${version} is empty`);
  return `${section}\n`;
}

export function validateReleaseContext({ repository, eventName, refType, refName, version }) {
  if (repository !== "Honguan/codex-model-router") {
    throw new Error(`release repository is not trusted: ${repository || "missing"}`);
  }
  if (!["push", "workflow_dispatch"].includes(eventName) || refType !== "tag") {
    throw new Error("releases require a pushed version tag or a manual retry at that exact tag");
  }
  const expected = `v${version}`;
  if (refName !== expected) throw new Error(`tag ${refName || "missing"} does not match package version ${version}`);
  return expected;
}

export async function loadReleaseMetadata({
  packagePath = "package.json",
  changelogPath = "CHANGELOG.md",
  environment = process.env,
  validateContext = true
} = {}) {
  const packageJson = JSON.parse(await readFile(resolve(packagePath), "utf8"));
  if (typeof packageJson.name !== "string" || !packageJson.name) throw new Error("package name is missing");
  if (typeof packageJson.version !== "string" || !SEMVER.test(packageJson.version)) {
    throw new Error("package version is missing or invalid");
  }
  const changelog = await readFile(resolve(changelogPath), "utf8");
  const notes = extractChangelogSection(changelog, packageJson.version);
  const tag = validateContext
    ? validateReleaseContext({
      repository: environment.GITHUB_REPOSITORY,
      eventName: environment.GITHUB_EVENT_NAME,
      refType: environment.GITHUB_REF_TYPE,
      refName: environment.GITHUB_REF_NAME,
      version: packageJson.version
    })
    : `v${packageJson.version}`;
  return { name: packageJson.name, version: packageJson.version, tag, notes };
}

function parseArguments(argv) {
  const result = { notesPath: "release-notes.md", outputPath: process.env.GITHUB_OUTPUT, validateContext: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--notes") result.notesPath = argv[++index];
    else if (argument === "--output") result.outputPath = argv[++index];
    else if (argument === "--no-context-validation") result.validateContext = false;
    else throw new Error(`unknown option: ${argument}`);
  }
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const metadata = await loadReleaseMetadata({ validateContext: options.validateContext });
  await writeFile(resolve(options.notesPath), metadata.notes, "utf8");
  if (options.outputPath) {
    await appendFile(resolve(options.outputPath), [
      `name=${metadata.name}`,
      `version=${metadata.version}`,
      `tag=${metadata.tag}`,
      `notes=${resolve(options.notesPath)}`,
      ""
    ].join("\n"), "utf8");
  }
  console.log(`${metadata.name}@${metadata.version} (${metadata.tag})`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("release-metadata.js")) {
  main().catch((error) => {
    console.error(`release metadata error: ${error.message}`);
    process.exitCode = 1;
  });
}
