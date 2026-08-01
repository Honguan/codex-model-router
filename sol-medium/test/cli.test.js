import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(projectRoot, 'src', 'cli.js');

async function withWorkspace(run) {
  const workspace = await mkdtemp(join(tmpdir(), 'task-tracker-test-'));
  try {
    await run({ workspace, dataDirectory: join(workspace, 'data') });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function cli(workspace, dataDirectory, args) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: workspace,
      env: { ...process.env, TASK_TRACKER_DATA_DIR: dataDirectory },
      encoding: 'utf8'
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? ''
    };
  }
}

async function readTasks(dataDirectory) {
  return JSON.parse(await readFile(join(dataDirectory, 'tasks.json'), 'utf8'));
}

test('creates a valid task and trims only surrounding whitespace', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const result = await cli(workspace, dataDirectory, ['add', '--title', '  Buy   milk  ']);
  assert.deepEqual(result, { code: 0, stdout: 'Created task 1: Buy   milk\n', stderr: '' });
  const [task] = await readTasks(dataDirectory);
  assert.equal(task.id, 1);
  assert.equal(task.title, 'Buy   milk');
  assert.equal(task.status, 'pending');
  assert.equal(task.completedAt, null);
  assert.equal(new Date(task.createdAt).toISOString(), task.createdAt);
}));

test('accepts equals option syntax', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const add = await cli(workspace, dataDirectory, ['add', '--title=Equal form']);
  const list = await cli(workspace, dataDirectory, ['list', '--status=pending']);
  assert.equal(add.code, 0);
  assert.equal(list.stdout, '[ ] 1 Equal form\n');
}));

test('rejects missing, empty, and whitespace-only titles', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const cases = [
    { args: ['add'], message: 'Missing required option: --title.\n' },
    { args: ['add', '--title'], message: 'Missing value for --title.\n' },
    { args: ['add', '--title', ''], message: 'Title must not be empty.\n' },
    { args: ['add', '--title', '   '], message: 'Title must not be empty.\n' }
  ];
  for (const item of cases) {
    const result = await cli(workspace, dataDirectory, item.args);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, item.message);
  }
}));

test('accepts 120 title characters and rejects 121', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const accepted = await cli(workspace, dataDirectory, ['add', `--title=${'a'.repeat(120)}`]);
  const rejected = await cli(workspace, dataDirectory, ['add', `--title=${'b'.repeat(121)}`]);
  assert.equal(accepted.code, 0);
  assert.notEqual(rejected.code, 0);
  assert.equal(rejected.stdout, '');
  assert.equal(rejected.stderr, 'Title must not exceed 120 characters.\n');
}));

test('rejected titles do not consume an ID', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const rejected = await cli(workspace, dataDirectory, ['add', '--title', '   ']);
  const accepted = await cli(workspace, dataDirectory, ['add', '--title', 'First valid']);
  assert.notEqual(rejected.code, 0);
  assert.equal(accepted.stdout, 'Created task 1: First valid\n');
}));

test('lists all, pending, and completed tasks in exact format', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'First']);
  await cli(workspace, dataDirectory, ['add', '--title', 'Second']);
  await cli(workspace, dataDirectory, ['done', '2']);
  const all = await cli(workspace, dataDirectory, ['list']);
  const pending = await cli(workspace, dataDirectory, ['list', '--status', 'pending']);
  const completed = await cli(workspace, dataDirectory, ['list', '--status', 'completed']);
  assert.equal(all.stdout, '[ ] 1 First\n[x] 2 Second\n');
  assert.equal(pending.stdout, '[ ] 1 First\n');
  assert.equal(completed.stdout, '[x] 2 Second\n');
}));

test('sorts equal timestamps by ascending ID without changing storage', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await mkdir(dataDirectory, { recursive: true });
  const timestamp = '2026-08-01T05:00:00.000Z';
  const stored = [
    { id: 2, title: 'Second', status: 'pending', createdAt: timestamp, completedAt: null },
    { id: 1, title: 'First', status: 'pending', createdAt: timestamp, completedAt: null }
  ];
  const original = `${JSON.stringify(stored, null, 2)}\n`;
  await writeFile(join(dataDirectory, 'tasks.json'), original, 'utf8');
  const result = await cli(workspace, dataDirectory, ['list']);
  assert.equal(result.stdout, '[ ] 1 First\n[ ] 2 Second\n');
  assert.equal(await readFile(join(dataDirectory, 'tasks.json'), 'utf8'), original);
}));

test('reports no matching tasks and rejects invalid status', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const empty = await cli(workspace, dataDirectory, ['list']);
  const invalid = await cli(workspace, dataDirectory, ['list', '--status', 'open']);
  assert.deepEqual(empty, { code: 0, stdout: 'No tasks found.\n', stderr: '' });
  assert.notEqual(invalid.code, 0);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr, 'Invalid status: open.\n');
}));

test('read-only commands do not create storage', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  assert.equal((await cli(workspace, dataDirectory, ['list'])).code, 0);
  assert.equal((await cli(workspace, dataDirectory, ['stats'])).code, 0);
  await assert.rejects(stat(dataDirectory), { code: 'ENOENT' });
}));

test('completes a task while preserving creation fields', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'Finish me']);
  const before = (await readTasks(dataDirectory))[0];
  const result = await cli(workspace, dataDirectory, ['done', '1']);
  const after = (await readTasks(dataDirectory))[0];
  assert.deepEqual(result, { code: 0, stdout: 'Completed task 1: Finish me\n', stderr: '' });
  assert.equal(after.id, before.id);
  assert.equal(after.title, before.title);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.status, 'completed');
  assert.equal(new Date(after.completedAt).toISOString(), after.completedAt);
}));

test('completing an already completed task is idempotent and does not rewrite', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'Once']);
  await cli(workspace, dataDirectory, ['done', '1']);
  const path = join(dataDirectory, 'tasks.json');
  const before = await readFile(path, 'utf8');
  const result = await cli(workspace, dataDirectory, ['done', '1']);
  const after = await readFile(path, 'utf8');
  assert.deepEqual(result, { code: 0, stdout: 'Task 1 is already completed.\n', stderr: '' });
  assert.equal(after, before);
}));

test('removes exactly one task', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'Keep']);
  await cli(workspace, dataDirectory, ['add', '--title', 'Remove']);
  const result = await cli(workspace, dataDirectory, ['remove', '2']);
  assert.deepEqual(result, { code: 0, stdout: 'Removed task 2: Remove\n', stderr: '' });
  assert.deepEqual((await readTasks(dataDirectory)).map(({ id, title }) => ({ id, title })), [{ id: 1, title: 'Keep' }]);
}));

test('rejects unknown and invalid task IDs', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'Known']);
  for (const value of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
    const result = await cli(workspace, dataDirectory, ['done', value]);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Task ID must be a positive integer.\n');
  }
  for (const command of ['done', 'remove']) {
    const missing = await cli(workspace, dataDirectory, [command]);
    const unknown = await cli(workspace, dataDirectory, [command, '99']);
    assert.notEqual(missing.code, 0);
    assert.notEqual(unknown.code, 0);
    assert.equal(unknown.stderr, 'Task 99 not found.\n');
  }
}));

test('never reuses removed lower or highest IDs across CLI executions', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'One']);
  await cli(workspace, dataDirectory, ['add', '--title', 'Two']);
  await cli(workspace, dataDirectory, ['add', '--title', 'Three']);
  await cli(workspace, dataDirectory, ['remove', '1']);
  await cli(workspace, dataDirectory, ['remove', '3']);
  const fourth = await cli(workspace, dataDirectory, ['add', '--title', 'Four']);
  await cli(workspace, dataDirectory, ['remove', '4']);
  const fifth = await cli(workspace, dataDirectory, ['add', '--title', 'Five']);
  assert.equal(fourth.stdout, 'Created task 4: Four\n');
  assert.equal(fifth.stdout, 'Created task 5: Five\n');
  assert.deepEqual((await readTasks(dataDirectory)).map((task) => task.id), [2, 5]);
}));

test('shows exact statistics for empty data and rounded percentages', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const empty = await cli(workspace, dataDirectory, ['stats']);
  assert.equal(empty.stdout, 'Total: 0\nPending: 0\nCompleted: 0\nCompletion rate: 0%\n');
  for (const title of ['One', 'Two', 'Three']) {
    await cli(workspace, dataDirectory, ['add', '--title', title]);
  }
  await cli(workspace, dataDirectory, ['done', '1']);
  const result = await cli(workspace, dataDirectory, ['stats']);
  assert.equal(result.stdout, 'Total: 3\nPending: 2\nCompleted: 1\nCompletion rate: 33%\n');
  await cli(workspace, dataDirectory, ['done', '2']);
  const roundedUp = await cli(workspace, dataDirectory, ['stats']);
  assert.equal(roundedUp.stdout, 'Total: 3\nPending: 1\nCompleted: 2\nCompletion rate: 67%\n');
}));

test('does not print success when a storage operation fails', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await writeFile(dataDirectory, 'not a directory', 'utf8');
  const result = await cli(workspace, dataDirectory, ['add', '--title', 'Cannot persist']);
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Unable to save task data.\n');
}));

test('rejects every required corrupted task-data form without changing it', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const invalidTask = [{ id: 1, title: '', status: 'pending', createdAt: 'bad', completedAt: null }];
  const cases = ['', '{bad', '{}', JSON.stringify(invalidTask)];
  await mkdir(dataDirectory, { recursive: true });
  for (const content of cases) {
    const path = join(dataDirectory, 'tasks.json');
    await writeFile(path, content, 'utf8');
    const result = await cli(workspace, dataDirectory, ['list']);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /corrupted|invalid task/i);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
    assert.equal(await readFile(path, 'utf8'), content);
  }
}));

test('rejects duplicate IDs and inconsistent completion fields', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await mkdir(dataDirectory, { recursive: true });
  const timestamp = '2026-08-01T05:00:00.000Z';
  const task = { id: 1, title: 'Valid', status: 'pending', createdAt: timestamp, completedAt: null };
  for (const data of [[task, task], [{ ...task, completedAt: timestamp }], [{ ...task, status: 'completed' }]]) {
    await writeFile(join(dataDirectory, 'tasks.json'), JSON.stringify(data), 'utf8');
    const result = await cli(workspace, dataDirectory, ['stats']);
    assert.notEqual(result.code, 0);
    assert.equal(result.stderr, 'Task data contains an invalid task.\n');
  }
}));

test('rejects corrupted ID metadata and preserves both files', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'One']);
  const tasksBefore = await readFile(join(dataDirectory, 'tasks.json'), 'utf8');
  await writeFile(join(dataDirectory, 'metadata.json'), '{}', 'utf8');
  const result = await cli(workspace, dataDirectory, ['add', '--title', 'Two']);
  assert.notEqual(result.code, 0);
  assert.equal(result.stderr, 'ID metadata is corrupted.\n');
  assert.equal(await readFile(join(dataDirectory, 'tasks.json'), 'utf8'), tasksBefore);
  assert.equal(await readFile(join(dataDirectory, 'metadata.json'), 'utf8'), '{}');
}));

test('rejects unknown commands, unsupported options, duplicates, missing values, and extra arguments', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  const cases = [
    [], ['ADD'], ['unknown'], ['stats', 'extra'], ['stats', '--json'],
    ['add', '--name', 'x'], ['add', '--title', 'a', '--title', 'b'],
    ['list', '--status'], ['list', '--status='], ['list', '--status', 'all', 'extra'],
    ['done', '1', 'extra'], ['remove', '--force']
  ];
  for (const args of cases) {
    const result = await cli(workspace, dataDirectory, args);
    assert.notEqual(result.code, 0, args.join(' '));
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
}));

test('successful mutations leave complete human-readable JSON with trailing newlines', () => withWorkspace(async ({ workspace, dataDirectory }) => {
  await cli(workspace, dataDirectory, ['add', '--title', 'JSON']);
  await cli(workspace, dataDirectory, ['done', '1']);
  for (const filename of ['tasks.json', 'metadata.json']) {
    const content = await readFile(join(dataDirectory, filename), 'utf8');
    assert.doesNotThrow(() => JSON.parse(content));
    assert.match(content, /\n$/);
    assert.match(content, /\n  /);
  }
}));
