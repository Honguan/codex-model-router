import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AppError } from './errors.js';

const TASK_KEYS = ['completedAt', 'createdAt', 'id', 'status', 'title'];

function isIsoTimestamp(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isValidTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return false;
  }
  const keys = Object.keys(task).sort();
  if (keys.length !== TASK_KEYS.length || keys.some((key, index) => key !== TASK_KEYS[index])) {
    return false;
  }
  if (!Number.isSafeInteger(task.id) || task.id <= 0) {
    return false;
  }
  if (typeof task.title !== 'string' || task.title.trim() !== task.title || task.title.length === 0 || task.title.length > 120) {
    return false;
  }
  if (!['pending', 'completed'].includes(task.status) || !isIsoTimestamp(task.createdAt)) {
    return false;
  }
  return task.status === 'pending'
    ? task.completedAt === null
    : isIsoTimestamp(task.completedAt);
}

function validateTasks(value) {
  if (!Array.isArray(value)) {
    throw new AppError('Task data is corrupted: expected a JSON array.');
  }
  const ids = new Set();
  for (const task of value) {
    if (!isValidTask(task) || ids.has(task.id)) {
      throw new AppError('Task data contains an invalid task.');
    }
    ids.add(task.id);
  }
  return value;
}

async function readJson(path, label) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw new AppError(`Unable to read ${label}.`);
  }
  if (content.length === 0) {
    throw new AppError(`${label} is corrupted: the file is empty.`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError(`${label} is corrupted: invalid JSON.`);
  }
}

async function atomicWriteJson(path, value) {
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch {
    throw new AppError('Unable to save task data.');
  }
  const suffix = `${process.pid}-${Date.now()}-${randomBytes(8).toString('hex')}`;
  const temporaryPath = `${path}.${suffix}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
  } catch {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw new AppError('Unable to save task data.');
  }
}

export class TaskStore {
  constructor(dataDirectory = process.env.TASK_TRACKER_DATA_DIR || resolve('.data')) {
    this.tasksPath = join(dataDirectory, 'tasks.json');
    this.metadataPath = join(dataDirectory, 'metadata.json');
  }

  async loadTasks() {
    const value = await readJson(this.tasksPath, 'Task data');
    return value === undefined ? [] : validateTasks(value);
  }

  async reserveId(tasks) {
    const metadata = await readJson(this.metadataPath, 'ID metadata');
    const minimumNextId = tasks.reduce((maximum, task) => Math.max(maximum, task.id), 0) + 1;
    let nextId = minimumNextId;

    if (metadata !== undefined) {
      const valid = metadata
        && typeof metadata === 'object'
        && !Array.isArray(metadata)
        && Object.keys(metadata).length === 1
        && Number.isSafeInteger(metadata.nextId)
        && metadata.nextId >= minimumNextId;
      if (!valid) {
        throw new AppError('ID metadata is corrupted.');
      }
      nextId = metadata.nextId;
    }

    await atomicWriteJson(this.metadataPath, { nextId: nextId + 1 });
    return nextId;
  }

  async saveTasks(tasks) {
    validateTasks(tasks);
    await atomicWriteJson(this.tasksPath, tasks);
  }
}
