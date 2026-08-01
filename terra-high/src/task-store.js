import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StorageError } from './errors.js';

const taskKeys = ['completedAt', 'createdAt', 'id', 'status', 'title'];

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function titleLength(value) {
  return Array.from(value).length;
}

function validateTask(task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task) || !hasExactKeys(task, taskKeys)) {
    return false;
  }
  if (!Number.isSafeInteger(task.id) || task.id < 1
    || typeof task.title !== 'string' || task.title.trim().length === 0 || titleLength(task.title) > 120
    || !['pending', 'completed'].includes(task.status) || !isIsoTimestamp(task.createdAt)) {
    return false;
  }
  return task.status === 'pending'
    ? task.completedAt === null
    : isIsoTimestamp(task.completedAt);
}

function validateTasks(tasks) {
  if (!Array.isArray(tasks) || !tasks.every(validateTask)) {
    throw new StorageError('Stored task data is invalid.');
  }
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) {
    throw new StorageError('Stored task data is invalid.');
  }
  return tasks;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(filePath, missingValue) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return missingValue;
    }
    throw new StorageError('Unable to read task data.');
  }
  if (text.length === 0) {
    throw new StorageError('Data storage is corrupted.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new StorageError('Data storage is corrupted.');
  }
}

async function writeAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    await fs.mkdir(directory, { recursive: true });
    handle = await fs.open(temporaryPath, 'wx');
    await handle.writeFile(serialize(value), 'utf8');
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof StorageError) {
      throw error;
    }
    throw new StorageError('Unable to save task data.');
  }
}

export class TaskStore {
  constructor(dataDirectory = process.env.TASK_TRACKER_DATA_DIR ?? path.join(process.cwd(), '.data')) {
    this.dataDirectory = path.resolve(dataDirectory);
    this.tasksPath = path.join(this.dataDirectory, 'tasks.json');
    this.metadataPath = path.join(this.dataDirectory, 'metadata.json');
  }

  async loadTasks() {
    return validateTasks(await readJson(this.tasksPath, []));
  }

  async loadMetadata(tasks) {
    const metadata = await readJson(this.metadataPath, undefined);
    if (metadata === undefined) {
      return { lastAssignedId: Math.max(0, ...tasks.map((task) => task.id)) };
    }
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)
      || !hasExactKeys(metadata, ['lastAssignedId'])
      || !Number.isSafeInteger(metadata.lastAssignedId) || metadata.lastAssignedId < 0
      || metadata.lastAssignedId < Math.max(0, ...tasks.map((task) => task.id))) {
      throw new StorageError('Stored ID metadata is invalid.');
    }
    return metadata;
  }

  async createTask(task) {
    const tasks = await this.loadTasks();
    const metadata = await this.loadMetadata(tasks);
    if (metadata.lastAssignedId >= Number.MAX_SAFE_INTEGER) {
      throw new StorageError('No more task IDs are available.');
    }
    const newTask = { ...task, id: metadata.lastAssignedId + 1 };
    await writeAtomic(this.metadataPath, { lastAssignedId: newTask.id });
    await writeAtomic(this.tasksPath, [...tasks, newTask]);
    return newTask;
  }

  async updateTask(id, update) {
    const tasks = await this.loadTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      return undefined;
    }
    const result = update(tasks[index]);
    if (result.changed) {
      const nextTasks = [...tasks];
      nextTasks[index] = result.task;
      await writeAtomic(this.tasksPath, nextTasks);
    }
    return result;
  }

  async removeTask(id) {
    const tasks = await this.loadTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      return undefined;
    }
    const [removed] = tasks.splice(index, 1);
    await writeAtomic(this.tasksPath, tasks);
    return removed;
  }
}
