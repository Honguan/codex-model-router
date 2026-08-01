import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { atomicWrite } from '../src/task-store.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = join(PROJECT_ROOT, 'src', 'cli.js');

function runCli(dataDirectory, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, TASK_TRACKER_DATA_DIR: dataDirectory },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code, stdout, stderr }));
  });
}

async function createDataDirectory(t) {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'task-tracker-cli-'));
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  return dataDirectory;
}

async function readTasks(dataDirectory) {
  return JSON.parse(await readFile(join(dataDirectory, 'tasks.json'), 'utf8'));
}

async function writeTasks(dataDirectory, value) {
  await writeFile(join(dataDirectory, 'tasks.json'), value, 'utf8');
}

async function addTaskThroughCli(dataDirectory, title) {
  return runCli(dataDirectory, ['add', '--title', title]);
}

test('creates a valid task and persists formatted JSON', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const result = await addTaskThroughCli(dataDirectory, 'Buy milk');

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'Created task 1: Buy milk\n');
  assert.equal(result.stderr, '');
  const tasks = await readTasks(dataDirectory);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0], {
    id: 1,
    title: 'Buy milk',
    status: 'pending',
    createdAt: tasks[0].createdAt,
    completedAt: null
  });
  assert.match(tasks[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(tasks, null, 2) + '\n', await readFile(join(dataDirectory, 'tasks.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(join(dataDirectory, 'id-sequence.json'), 'utf8'));
  assert.deepEqual(metadata, { nextId: 2 });
});

test('trims only title edges and accepts both title option forms', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const first = await runCli(dataDirectory, ['add', '--title', '  Buy   milk  ']);
  const second = await runCli(dataDirectory, ['add', '--title=Read   book']);

  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.deepEqual((await readTasks(dataDirectory)).map((task) => task.title), ['Buy   milk', 'Read   book']);
});

test('rejects missing, empty, and whitespace-only titles', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  for (const args of [['add'], ['add', '--title'], ['add', '--title', ''], ['add', '--title', '   ']]) {
    const result = await runCli(dataDirectory, args);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /at .*\.js:/);
  }
});

test('rejects titles over 120 characters and accepts exactly 120', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const tooLong = await runCli(dataDirectory, ['add', '--title', 'a'.repeat(121)]);
  const exact = await runCli(dataDirectory, ['add', '--title', 'b'.repeat(120)]);

  assert.notEqual(tooLong.code, 0);
  assert.equal(tooLong.stdout, '');
  assert.equal(exact.code, 0);
  assert.equal((await readTasks(dataDirectory))[0].title.length, 120);
});

test('lists all, pending, and completed tasks in creation order', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  await addTaskThroughCli(dataDirectory, 'First');
  await addTaskThroughCli(dataDirectory, 'Second');
  await runCli(dataDirectory, ['done', '1']);

  assert.equal((await runCli(dataDirectory, ['list'])).stdout, '[x] 1 First\n[ ] 2 Second\n');
  assert.equal((await runCli(dataDirectory, ['list', '--status', 'pending'])).stdout, '[ ] 2 Second\n');
  assert.equal((await runCli(dataDirectory, ['list', '--status=completed'])).stdout, '[x] 1 First\n');
  assert.equal((await runCli(dataDirectory, ['list', '--status=all'])).code, 0);
});

test('rejects invalid statuses and reports no matching tasks exactly', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const invalid = await runCli(dataDirectory, ['list', '--status', 'waiting']);
  const empty = await runCli(dataDirectory, ['list', '--status', 'completed']);

  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /Invalid status/);
  assert.equal(empty.code, 0);
  assert.equal(empty.stdout, 'No tasks found.\n');
});

test('completes a task, sets completedAt, and preserves identity fields', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  await addTaskThroughCli(dataDirectory, 'Finish report');
  const before = (await readTasks(dataDirectory))[0];
  const result = await runCli(dataDirectory, ['done', '1']);
  const after = (await readTasks(dataDirectory))[0];

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'Completed task 1: Finish report\n');
  assert.equal(after.id, before.id);
  assert.equal(after.title, before.title);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.status, 'completed');
  assert.match(after.completedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('completion is idempotent and does not rewrite the data file', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  await addTaskThroughCli(dataDirectory, 'One time');
  await runCli(dataDirectory, ['done', '1']);
  const beforeContent = await readFile(join(dataDirectory, 'tasks.json'), 'utf8');
  const beforeStat = await stat(join(dataDirectory, 'tasks.json'));
  const result = await runCli(dataDirectory, ['done', '1']);
  const afterContent = await readFile(join(dataDirectory, 'tasks.json'), 'utf8');
  const afterStat = await stat(join(dataDirectory, 'tasks.json'));

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'Task 1 is already completed.\n');
  assert.equal(afterContent, beforeContent);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
});

test('removes exactly one task and keeps IDs increasing after deletions and restarts', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  await addTaskThroughCli(dataDirectory, 'One');
  await addTaskThroughCli(dataDirectory, 'Two');
  await addTaskThroughCli(dataDirectory, 'Three');
  const removed = await runCli(dataDirectory, ['remove', '3']);
  const removedLower = await runCli(dataDirectory, ['remove', '1']);
  const fourth = await addTaskThroughCli(dataDirectory, 'Four');
  const fifth = await addTaskThroughCli(dataDirectory, 'Five');

  assert.equal(removed.stdout, 'Removed task 3: Three\n');
  assert.equal(removedLower.stdout, 'Removed task 1: One\n');
  assert.equal(fourth.stdout, 'Created task 4: Four\n');
  assert.equal(fifth.stdout, 'Created task 5: Five\n');
  assert.deepEqual((await readTasks(dataDirectory)).map((task) => task.id), [2, 4, 5]);
});

test('rejects missing, invalid, and unknown IDs', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  await addTaskThroughCli(dataDirectory, 'Task');

  for (const command of ['done', 'remove']) {
    for (const id of [undefined, '0', '-1', '1.2', 'abc', '999999999999999999999']) {
      const args = id === undefined ? [command] : [command, id];
      const result = await runCli(dataDirectory, args);
      assert.notEqual(result.code, 0);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /at .*\.js:/);
    }
  }
});

test('shows empty and rounded statistics with exact output', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const empty = await runCli(dataDirectory, ['stats']);
  assert.equal(empty.stdout, 'Total: 0\nPending: 0\nCompleted: 0\nCompletion rate: 0%\n');

  await addTaskThroughCli(dataDirectory, 'One');
  await addTaskThroughCli(dataDirectory, 'Two');
  await addTaskThroughCli(dataDirectory, 'Three');
  await runCli(dataDirectory, ['done', '1']);
  await runCli(dataDirectory, ['done', '2']);
  const result = await runCli(dataDirectory, ['stats']);
  assert.equal(result.stdout, 'Total: 3\nPending: 1\nCompleted: 2\nCompletion rate: 67%\n');
});

test('treats missing storage as an empty store without writing during reads', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'task-tracker-parent-'));
  const dataDirectory = join(parent, 'missing-data');
  t.after(() => rm(parent, { recursive: true, force: true }));

  const list = await runCli(dataDirectory, ['list']);
  assert.equal(list.code, 0);
  assert.equal(list.stdout, 'No tasks found.\n');
  await assert.rejects(() => stat(dataDirectory));

  const add = await addTaskThroughCli(dataDirectory, 'Created');
  assert.equal(add.code, 0);
  assert.deepEqual((await readTasks(dataDirectory)).map((task) => task.id), [1]);
});

test('rejects empty, malformed, non-array, and invalid-object storage', async (t) => {
  const cases = [
    '',
    '{"id":',
    '{}',
    '[{"id":1,"title":"x","status":"unknown","createdAt":"2026-08-01T05:00:00.000Z","completedAt":null}]'
  ];

  for (const value of cases) {
    const dataDirectory = await createDataDirectory(t);
    await writeTasks(dataDirectory, value);
    const result = await runCli(dataDirectory, ['list']);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(join(dataDirectory, 'tasks.json'), 'utf8'), value);
    assert.equal(result.stdout, '');
  }
});

test('rejects unknown commands, unsupported options, duplicates, and missing values', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const cases = [
    ['unknown'],
    ['list', '--title', 'x'],
    ['list', '--status', 'pending', '--status=all'],
    ['list', '--status'],
    ['stats', 'extra'],
    ['add', '--title', 'x', 'extra']
  ];

  for (const args of cases) {
    const result = await runCli(dataDirectory, args);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, /Error:\s+Error/);
  }
});

test('preserves corrupted data and cleans temporary files after atomic write failure', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const tasksPath = join(dataDirectory, 'tasks.json');
  const original = '[\n  {\n    "id": 1\n  }\n]\n';
  await writeFile(tasksPath, original, 'utf8');
  const failingFileSystem = {
    ...fsPromises,
    rename: async () => {
      const error = new Error('simulated replacement failure');
      error.code = 'EIO';
      throw error;
    }
  };

  await assert.rejects(() => atomicWrite(tasksPath, '[]\n', failingFileSystem));
  assert.equal(await readFile(tasksPath, 'utf8'), original);
  assert.deepEqual((await readdir(dataDirectory)).filter((name) => name.endsWith('.tmp')), []);
});

test('accepts valid equals and separated options while rejecting option case changes', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  const add = await runCli(dataDirectory, ['add', '--title=Case test']);
  const invalid = await runCli(dataDirectory, ['list', '--Status', 'all']);
  const list = await runCli(dataDirectory, ['list', '--status', 'all']);

  assert.equal(add.code, 0);
  assert.notEqual(invalid.code, 0);
  assert.equal(list.stdout, '[ ] 1 Case test\n');
});

test('writes valid JSON after every successful mutation', async (t) => {
  const dataDirectory = await createDataDirectory(t);
  await addTaskThroughCli(dataDirectory, 'One');
  await addTaskThroughCli(dataDirectory, 'Two');
  await runCli(dataDirectory, ['done', '1']);
  await runCli(dataDirectory, ['remove', '2']);

  const parsed = JSON.parse(await readFile(join(dataDirectory, 'tasks.json'), 'utf8'));
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, 'completed');
});

test('reports normal file operations with clean successful output', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'task-tracker-operation-'));
  const dataDirectory = join(parent, 'data');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const result = await runCli(dataDirectory, ['add', '--title', 'Task']);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
});
