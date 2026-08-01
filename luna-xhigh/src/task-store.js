import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';

const DATA_DIRECTORY_ENV = 'TASK_TRACKER_DATA_DIR';
const TASKS_FILE_NAME = 'tasks.json';
const ID_METADATA_FILE_NAME = 'id-sequence.json';
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimestamp(value) {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function maxTaskId(tasks) {
  return tasks.reduce((maximum, task) => Math.max(maximum, task.id), 0);
}

export function validateTasks(tasks) {
  if (!Array.isArray(tasks)) {
    throw new AppError('Stored task data is invalid.');
  }

  const ids = new Set();
  for (const task of tasks) {
    const taskKeys = isPlainObject(task) ? Object.keys(task) : [];
    const requiredKeys = ['id', 'title', 'status', 'createdAt', 'completedAt'];
    if (!isPlainObject(task) || taskKeys.length !== requiredKeys.length || requiredKeys.some((key) => !hasOwn(task, key))) {
      throw new AppError('Stored task data is invalid.');
    }
    if (!Number.isSafeInteger(task.id) || task.id < 1 || ids.has(task.id)) {
      throw new AppError('Stored task data is invalid.');
    }
    if (typeof task.title !== 'string') {
      throw new AppError('Stored task data is invalid.');
    }
    const titleLength = Array.from(task.title.trim()).length;
    if (titleLength === 0 || titleLength > 120) {
      throw new AppError('Stored task data is invalid.');
    }
    if (task.status !== 'pending' && task.status !== 'completed') {
      throw new AppError('Stored task data is invalid.');
    }
    if (!isValidTimestamp(task.createdAt)) {
      throw new AppError('Stored task data is invalid.');
    }
    if (task.status === 'pending' && task.completedAt !== null) {
      throw new AppError('Stored task data is invalid.');
    }
    if (task.status === 'completed' && !isValidTimestamp(task.completedAt)) {
      throw new AppError('Stored task data is invalid.');
    }
    ids.add(task.id);
  }

  return tasks;
}

function validateMetadata(metadata, tasks) {
  if (!isPlainObject(metadata) || Object.keys(metadata).length !== 1 || !hasOwn(metadata, 'nextId')) {
    throw new AppError('Stored ID metadata is invalid.');
  }
  if (!Number.isSafeInteger(metadata.nextId) || metadata.nextId < 1) {
    throw new AppError('Stored ID metadata is invalid.');
  }
  if (metadata.nextId <= maxTaskId(tasks)) {
    throw new AppError('Stored ID metadata is invalid.');
  }
  return metadata.nextId;
}

function parseContent(content, kind) {
  if (content.trim().length === 0) {
    throw new AppError(`${kind} is corrupted.`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError(`${kind} is corrupted.`);
  }
}

async function readOptional(filePath, kind, fileSystem) {
  try {
    return await fileSystem.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw new AppError(`Unable to read ${kind}.`);
  }
}

async function removeIfPresent(filePath, fileSystem) {
  try {
    await fileSystem.unlink(filePath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      return;
    }
  }
}

function temporaryPath(filePath) {
  const suffix = `${process.pid}-${Date.now()}-${randomBytes(8).toString('hex')}`;
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${suffix}.tmp`);
}

export async function atomicWrite(filePath, content, fileSystem = fs) {
  const directory = path.dirname(filePath);
  const tempFilePath = temporaryPath(filePath);
  let handle;
  let replaced = false;

  await fileSystem.mkdir(directory, { recursive: true });
  try {
    handle = await fileSystem.open(tempFilePath, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.close();
    handle = undefined;
    await fileSystem.rename(tempFilePath, filePath);
    replaced = true;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        handle = undefined;
      }
    }
    if (!replaced) {
      await removeIfPresent(tempFilePath, fileSystem);
    }
  }
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class TaskStore {
  constructor({ dataDirectory, fileSystem = fs } = {}) {
    const configuredDirectory = dataDirectory ?? process.env[DATA_DIRECTORY_ENV];
    this.dataDirectory = path.resolve(
      configuredDirectory && configuredDirectory.length > 0
        ? configuredDirectory
        : path.join(process.cwd(), '.data')
    );
    this.tasksPath = path.join(this.dataDirectory, TASKS_FILE_NAME);
    this.metadataPath = path.join(this.dataDirectory, ID_METADATA_FILE_NAME);
    this.fileSystem = fileSystem;
  }

  async load() {
    const [tasksContent, metadataContent] = await Promise.all([
      readOptional(this.tasksPath, 'task data', this.fileSystem),
      readOptional(this.metadataPath, 'ID metadata', this.fileSystem)
    ]);

    const tasks = tasksContent === null ? [] : parseContent(tasksContent, 'Task data');
    validateTasks(tasks);

    if (metadataContent === null) {
      const maximumId = maxTaskId(tasks);
      if (maximumId === Number.MAX_SAFE_INTEGER) {
        throw new AppError('Stored ID metadata is invalid.');
      }
      return { tasks, nextId: maximumId + 1 };
    }

    const metadata = parseContent(metadataContent, 'ID metadata');
    const nextId = validateMetadata(metadata, tasks);
    return { tasks, nextId };
  }

  async saveTasks(tasks, nextId) {
    validateTasks(tasks);
    if (nextId !== undefined) {
      validateMetadata({ nextId }, tasks);
      await atomicWrite(this.metadataPath, jsonText({ nextId }), this.fileSystem);
    }
    await atomicWrite(this.tasksPath, jsonText(tasks), this.fileSystem);
  }

  async saveState(tasks, nextId) {
    validateTasks(tasks);
    validateMetadata({ nextId }, tasks);
    await atomicWrite(this.metadataPath, jsonText({ nextId }), this.fileSystem);
    await atomicWrite(this.tasksPath, jsonText(tasks), this.fileSystem);
  }
}

export const storageConstants = {
  DATA_DIRECTORY_ENV,
  TASKS_FILE_NAME,
  ID_METADATA_FILE_NAME
};
