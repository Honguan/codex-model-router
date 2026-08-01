import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(projectRoot, 'src', 'cli.js');

async function createWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'task-tracker-cli-'));
}

function run(workspace, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: workspace,
      env: { ...process.env, TASK_TRACKER_DATA_DIR: path.join(workspace, 'isolated-data') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function withWorkspace(callback) {
  const workspace = await createWorkspace();
  try {
    await callback(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function add(workspace, title) {
  const result = await run(workspace, ['add', '--title', title]);
  assert.equal(result.code, 0);
  return result;
}

async function tasks(workspace) {
  const file = path.join(workspace, 'isolated-data', 'tasks.json');
  return JSON.parse(await readFile(file, 'utf8'));
}

test('creates a valid, trimmed pending task', async () => withWorkspace(async (workspace) => {
  const result = await add(workspace, '  Buy milk  ');
  assert.match(result.stdout, /^Created task 1: Buy milk\n$/);
  assert.equal(result.stderr, '');
  const [task] = await tasks(workspace);
  assert.deepEqual(Object.keys(task).sort(), ['completedAt', 'createdAt', 'id', 'status', 'title']);
  assert.equal(task.status, 'pending');
  assert.equal(task.completedAt, null);
  assert.equal(task.title, 'Buy milk');
  assert.equal(new Date(task.createdAt).toISOString(), task.createdAt);
}));

test('validates required titles and title length boundaries', async () => withWorkspace(async (workspace) => {
  for (const args of [
    ['add'],
    ['add', '--title'],
    ['add', '--title', '   '],
    ['add', '--title', 'x'.repeat(121)],
  ]) {
    const result = await run(workspace, args);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\.\n$/);
    assert.doesNotMatch(result.stderr, /Error:|at /);
  }
  const accepted = await run(workspace, ['add', `--title=${'x'.repeat(120)}`]);
  assert.equal(accepted.code, 0);
}));

test('lists all, pending, and completed tasks using exact formats', async () => withWorkspace(async (workspace) => {
  await add(workspace, 'first');
  await add(workspace, 'second');
  assert.equal((await run(workspace, ['done', '2'])).code, 0);
  assert.equal((await run(workspace, ['list'])).stdout, '[ ] 1 first\n[x] 2 second\n');
  assert.equal((await run(workspace, ['list', '--status=pending'])).stdout, '[ ] 1 first\n');
  assert.equal((await run(workspace, ['list', '--status', 'completed'])).stdout, '[x] 2 second\n');
  const invalid = await run(workspace, ['list', '--status', 'later']);
  assert.notEqual(invalid.code, 0);
  assert.equal(invalid.stdout, '');
}));

test('reports no matching tasks', async () => withWorkspace(async (workspace) => {
  assert.equal((await run(workspace, ['list'])).stdout, 'No tasks found.\n');
  await add(workspace, 'pending');
  assert.equal((await run(workspace, ['list', '--status', 'completed'])).stdout, 'No tasks found.\n');
}));

test('completes a task once without changing completedAt on repeat', async () => withWorkspace(async (workspace) => {
  await add(workspace, 'finish me');
  const before = (await tasks(workspace))[0];
  const completed = await run(workspace, ['done', '1']);
  assert.equal(completed.stdout, 'Completed task 1: finish me\n');
  const afterFirst = (await tasks(workspace))[0];
  assert.equal(afterFirst.createdAt, before.createdAt);
  assert.equal(afterFirst.status, 'completed');
  assert.equal(new Date(afterFirst.completedAt).toISOString(), afterFirst.completedAt);
  const repeated = await run(workspace, ['done', '1']);
  assert.equal(repeated.stdout, 'Task 1 is already completed.\n');
  assert.deepEqual((await tasks(workspace))[0], afterFirst);
}));

test('removes exactly one task and never reuses IDs', async () => withWorkspace(async (workspace) => {
  await add(workspace, 'one');
  await add(workspace, 'two');
  assert.equal((await run(workspace, ['remove', '2'])).stdout, 'Removed task 2: two\n');
  await add(workspace, 'three');
  assert.equal((await run(workspace, ['remove', '3'])).code, 0);
  await add(workspace, 'four');
  assert.equal((await run(workspace, ['list'])).stdout, '[ ] 1 one\n[ ] 4 four\n');
  const metadata = JSON.parse(await readFile(path.join(workspace, 'isolated-data', 'metadata.json'), 'utf8'));
  assert.equal(metadata.lastAssignedId, 4);
}));

test('rejects unknown and invalid task IDs', async () => withWorkspace(async (workspace) => {
  await add(workspace, 'known');
  for (const args of [
    ['done'], ['done', '0'], ['done', '-1'], ['done', '1.2'], ['remove', 'other'], ['remove', '2'],
  ]) {
    const result = await run(workspace, args);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
  }
}));

test('calculates statistics including rounded completion rates', async () => withWorkspace(async (workspace) => {
  assert.equal((await run(workspace, ['stats'])).stdout, 'Total: 0\nPending: 0\nCompleted: 0\nCompletion rate: 0%\n');
  await add(workspace, 'one');
  await add(workspace, 'two');
  await add(workspace, 'three');
  await run(workspace, ['done', '1']);
  assert.equal((await run(workspace, ['stats'])).stdout, 'Total: 3\nPending: 2\nCompleted: 1\nCompletion rate: 33%\n');
  await run(workspace, ['done', '2']);
  assert.equal((await run(workspace, ['stats'])).stdout, 'Total: 3\nPending: 1\nCompleted: 2\nCompletion rate: 67%\n');
}));

test('handles missing storage and rejects corrupted storage without replacing it', async () => withWorkspace(async (workspace) => {
  assert.equal((await run(workspace, ['list'])).code, 0);
  const directory = path.join(workspace, 'isolated-data');
  const file = path.join(directory, 'tasks.json');
  await mkdir(directory, { recursive: true });
  await writeFile(file, '{invalid', 'utf8');
  const malformed = await run(workspace, ['list']);
  assert.notEqual(malformed.code, 0);
  assert.equal(await readFile(file, 'utf8'), '{invalid');
  for (const content of ['', '{}', '[{"id":1}]']) {
    await writeFile(file, content, 'utf8');
    const result = await run(workspace, ['stats']);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(file, 'utf8'), content);
  }
}));

test('rejects unknown commands and malformed option use', async () => withWorkspace(async (workspace) => {
  for (const args of [
    ['unknown'], ['stats', '--verbose'], ['add', '--other', 'x'], ['add', '--title', 'x', '--title', 'y'],
    ['list', '--status'], ['list', '--status', 'pending', 'extra'], ['done', '1', 'extra'],
  ]) {
    const result = await run(workspace, args);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /Error:|at /);
  }
}));

test('writes complete valid JSON after successful mutations', async () => withWorkspace(async (workspace) => {
  await add(workspace, 'valid json');
  await run(workspace, ['done', '1']);
  await run(workspace, ['remove', '1']);
  assert.deepEqual(await tasks(workspace), []);
  const raw = await readFile(path.join(workspace, 'isolated-data', 'tasks.json'), 'utf8');
  assert.match(raw, /\n$/);
}));
