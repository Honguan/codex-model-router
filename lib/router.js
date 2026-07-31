import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MODELS = {
  model: "gpt-5.6-terra",
  model_reasoning_effort: "high"
};

const files = {
  luna: {
    relative: ["agents", "luna.toml"],
    content: `name = "luna"
description = "Low-risk helper for repeated edits, searches, formatting, extraction, and summaries."
model = "gpt-5.6-luna"
model_reasoning_effort = "high"
developer_instructions = """
Handle only deterministic, low-risk work delegated by Terra.
Do not make judgment calls outside the assigned operation.
"""
`
  },
  sol: {
    relative: ["agents", "sol.toml"],
    content: `name = "sol"
description = "Read-only reviewer for high-risk changes and explicit reviews."
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"
sandbox_mode = "read-only"
developer_instructions = """
Review only. Focus on security, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state, and regression risk.
Report findings to Terra; do not apply fixes.
"""
`
  },
  skill: {
    relative: ["model-router", "SKILL.md"],
    content: `---
name: model-router
description: Route Codex work between Terra, Luna, and Sol.
---

Terra handles ordinary questions, coding, debugging, fixes, testing, and implementation; never create a Terra subagent.
Use Luna only for deterministic low-risk repeated edits, bulk patterns, read-heavy searches, formatting, counting, extraction, or summaries; prefer it after the same clear operation appears at least three times.
Use Sol only as a read-only reviewer for security, authentication, authorization, permissions, secrets, destructive actions, financial logic, SQL writes, concurrency, complex state changes, high-regression-risk logic, or an explicit review. Terra applies fixes.
Do not spawn an agent for a simple question. Use the fewest agents, and start Luna and Sol together only when both independent tasks are required.
`
  }
};

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function paths({ cwd, home, global }) {
  const userHome = home ?? homedir();
  const codexHome = global ? (process.env.CODEX_HOME || join(userHome, ".codex")) : join(cwd, ".codex");
  const skillsHome = global ? join(userHome, ".agents", "skills") : join(cwd, ".agents", "skills");
  return {
    config: join(codexHome, "config.toml"),
    state: join(codexHome, "model-router-state.json"),
    backup: join(codexHome, "config.toml.codex-model-router.bak"),
    luna: join(codexHome, ...files.luna.relative),
    sol: join(codexHome, ...files.sol.relative),
    skill: join(skillsHome, ...files.skill.relative)
  };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function read(path) {
  return (await exists(path)) ? readFile(path, "utf8") : undefined;
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function uncomment(line) {
  let quote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && !escaped) quote = !quote;
    if (character === "#" && !quote) return line.slice(0, index);
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  return line;
}

function parseConfig(content) {
  const values = {};
  const lines = content.split(/\r?\n/);
  let inTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = uncomment(lines[index]).trim();
    if (!line) continue;
    if (/^\[\[?[A-Za-z0-9_.-]+\]?\]$/.test(line)) { inTable = true; continue; }
    if (!/^[A-Za-z0-9_-]+\s*=/.test(line)) {
      throw new Error(`config.toml 第 ${index + 1} 行無法安全解析`);
    }
    if (!inTable) {
      const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/);
      if (match && Object.hasOwn(MODELS, match[1])) {
        if (Object.hasOwn(values, match[1])) throw new Error(`config.toml 的 ${match[1]} 重複定義`);
        values[match[1]] = { value: match[2], line: index };
      } else if (Object.hasOwn(MODELS, line.split("=")[0].trim())) {
        throw new Error(`config.toml 的 ${line.split("=")[0].trim()} 必須是單行字串`);
      }
    }
  }
  return { lines, values, newline: content.includes("\r\n") ? "\r\n" : "\n" };
}

function insertTopLevel(lines, additions) {
  const index = lines.findIndex((line) => /^\s*\[\[?[A-Za-z0-9_.-]+\]?\]\s*(?:#.*)?$/.test(line));
  const at = index === -1 ? (lines.at(-1) === "" ? lines.length - 1 : lines.length) : index;
  lines.splice(at, 0, ...additions);
}

function patchConfig(content, stateValues) {
  const parsed = parseConfig(content);
  const additions = [];
  const owned = {};
  for (const [key, installed] of Object.entries(MODELS)) {
    const current = parsed.values[key];
    const existingState = stateValues?.[key];
    if (current) {
      if (existingState && current.value === existingState.installed) owned[key] = existingState;
      continue;
    }
    additions.push(`${key} = "${installed}"`);
    owned[key] = { previous: null, installed };
  }
  if (!additions.length) return { content, owned, changed: false };
  insertTopLevel(parsed.lines, additions);
  let updated = parsed.lines.join(parsed.newline);
  if (!updated.endsWith(parsed.newline)) updated += parsed.newline;
  return { content: updated, owned, changed: true };
}

function unpatchConfig(content, stateValues) {
  const parsed = parseConfig(content);
  const linesToRemove = new Set();
  for (const [key, owned] of Object.entries(stateValues || {})) {
    const current = parsed.values[key];
    if (current?.value === owned.installed) linesToRemove.add(current.line);
  }
  const preserved = Object.fromEntries(Object.entries(stateValues || {}).filter(([key]) => !linesToRemove.has(parsed.values[key]?.line)));
  if (!linesToRemove.size) return { content, preserved, changed: false };
  let updated = parsed.lines.filter((_, index) => !linesToRemove.has(index)).join(parsed.newline);
  if (updated && !updated.endsWith(parsed.newline)) updated += parsed.newline;
  return { content: updated, preserved, changed: true };
}

function emptyState(state) {
  return !Object.keys(state.config?.values || {}).length && !Object.keys(state.files || {}).length && !state.backup;
}

function message(output, text) { output?.(text); }

async function install(scope, output) {
  const location = paths(scope);
  let state;
  try {
    const stateText = await read(location.state);
    state = stateText ? JSON.parse(stateText) : { config: { path: location.config, values: {} }, files: {} };
    if (!state.config || !state.files) throw new Error("狀態檔格式不正確");
  } catch (error) {
    message(output, `failed: ${error.message}`);
    return 1;
  }

  const original = (await read(location.config)) ?? "";
  let patched;
  try { patched = patchConfig(original, state.config.values); }
  catch (error) { message(output, `failed: ${error.message}`); return 1; }

  if (patched.changed) {
    if (!state.backup && original && !(await exists(location.backup))) {
      await copyFile(location.config, location.backup);
      state.backup = { path: location.backup, hash: hash(original) };
    }
    await atomicWrite(location.config, patched.content);
    state.config = { path: location.config, values: patched.owned, hash: hash(patched.content) };
    message(output, "updated: config.toml");
  } else {
    state.config = { ...state.config, path: location.config, values: patched.owned, hash: hash(original) };
    message(output, "preserved: config.toml");
  }

  for (const [name, template] of Object.entries(files)) {
    const path = location[name];
    const current = await read(path);
    const tracked = state.files[name];
    if (current === undefined) {
      await atomicWrite(path, template.content);
      state.files[name] = { path, hash: hash(template.content) };
      message(output, `created: ${name}`);
    } else if (tracked && tracked.hash === hash(current)) {
      message(output, `skipped: ${name}`);
    } else {
      message(output, `preserved: ${name}`);
    }
  }
  await atomicWrite(location.state, `${JSON.stringify(state, null, 2)}\n`);
  return 0;
}

async function uninstall(scope, output) {
  const location = paths(scope);
  const stateText = await read(location.state);
  if (!stateText) { message(output, "skipped: no installed state"); return 0; }
  let state;
  try { state = JSON.parse(stateText); }
  catch { message(output, "failed: 狀態檔格式不正確"); return 1; }

  const currentConfig = await read(location.config);
  if (currentConfig !== undefined) {
    try {
      const result = unpatchConfig(currentConfig, state.config?.values);
      state.config.values = result.preserved;
      if (result.changed) {
        if (!Object.keys(result.preserved).length && !state.backup && result.content === "") await rm(location.config, { force: true });
        else await atomicWrite(location.config, result.content);
        message(output, "updated: config.toml");
      } else if (Object.keys(state.config.values).length) message(output, "preserved: config.toml");
    } catch (error) { message(output, `preserved: config.toml (${error.message})`); }
  }

  for (const [name, item] of Object.entries(state.files || {})) {
    const current = await read(item.path);
    if (current !== undefined && hash(current) === item.hash) {
      await rm(item.path, { force: true });
      delete state.files[name];
      message(output, `removed: ${name}`);
    } else {
      message(output, `preserved: ${name}`);
    }
  }
  if (state.backup) {
    const backup = await read(state.backup.path);
    if (backup !== undefined && hash(backup) === state.backup.hash) {
      await rm(state.backup.path, { force: true });
      delete state.backup;
    } else message(output, "preserved: config backup");
  }
  if (emptyState(state)) await rm(location.state, { force: true });
  else await atomicWrite(location.state, `${JSON.stringify(state, null, 2)}\n`);
  return 0;
}

async function doctor(scope, output) {
  const location = paths(scope);
  let healthy = true;
  const config = await read(location.config);
  if (config === undefined) { message(output, "failed: config.toml is missing"); healthy = false; }
  else {
    try {
      const parsed = parseConfig(config);
      for (const [key, value] of Object.entries(MODELS)) {
        if (parsed.values[key]?.value !== value) { message(output, `failed: ${key}`); healthy = false; }
      }
    } catch (error) { message(output, `failed: ${error.message}`); healthy = false; }
  }
  for (const [name, template] of Object.entries(files)) {
    const current = await read(location[name]);
    if (current === undefined ||
      (name === "sol" && (!/model = "gpt-5.6-sol"/.test(current) || !/model_reasoning_effort = "medium"/.test(current) || !/sandbox_mode = "read-only"/.test(current))) ||
      (name === "luna" && (!/model = "gpt-5.6-luna"/.test(current) || !/model_reasoning_effort = "high"/.test(current)))) {
      message(output, `failed: ${name}`); healthy = false;
    }
  }
  const stateText = await read(location.state);
  if (!stateText) { message(output, "failed: state is missing"); return 1; }
  try {
    const state = JSON.parse(stateText);
    for (const [name, item] of Object.entries(state.files || {})) {
      const current = await read(item.path);
      if (current === undefined || hash(current) !== item.hash) { message(output, `modified: ${name}`); healthy = false; }
    }
  } catch { message(output, "failed: 狀態檔格式不正確"); healthy = false; }
  if (healthy) message(output, "healthy");
  return healthy ? 0 : 1;
}

export async function run(argv, options = {}) {
  const [command, ...flags] = argv;
  const global = flags.length === 1 && flags[0] === "--global";
  if (!command || !["install", "uninstall", "doctor"].includes(command) || (flags.length && !global)) {
    options.output?.("Usage: codex-model-router <install|uninstall|doctor> [--global]");
    return 1;
  }
  const scope = { cwd: options.cwd ?? process.cwd(), home: options.home, global };
  if (command === "install") return install(scope, options.output);
  if (command === "uninstall") return uninstall(scope, options.output);
  return doctor(scope, options.output);
}
