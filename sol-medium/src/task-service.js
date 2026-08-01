import { AppError } from './errors.js';

const VALID_LIST_STATUSES = new Set(['pending', 'completed', 'all']);

export function validateTitle(value) {
  const title = value.trim();
  if (title.length === 0) {
    throw new AppError('Title must not be empty.');
  }
  if (title.length > 120) {
    throw new AppError('Title must not exceed 120 characters.');
  }
  return title;
}

export function parseTaskId(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new AppError('Task ID must be a positive integer.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new AppError('Task ID must be a positive integer.');
  }
  return id;
}

export function createTask(id, title, now = new Date()) {
  return {
    id,
    title,
    status: 'pending',
    createdAt: now.toISOString(),
    completedAt: null
  };
}

export function listTasks(tasks, status = 'all') {
  if (!VALID_LIST_STATUSES.has(status)) {
    throw new AppError(`Invalid status: ${status}.`);
  }
  return [...tasks]
    .filter((task) => status === 'all' || task.status === status)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id);
}

function findTask(tasks, id) {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw new AppError(`Task ${id} not found.`);
  }
  return task;
}

export function completeTask(tasks, id, now = new Date()) {
  const task = findTask(tasks, id);
  if (task.status === 'completed') {
    return { tasks, task, changed: false };
  }

  const completed = { ...task, status: 'completed', completedAt: now.toISOString() };
  return {
    tasks: tasks.map((candidate) => candidate.id === id ? completed : candidate),
    task: completed,
    changed: true
  };
}

export function removeTask(tasks, id) {
  const task = findTask(tasks, id);
  return {
    tasks: tasks.filter((candidate) => candidate.id !== id),
    task
  };
}

export function calculateStatistics(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  return {
    total,
    pending: total - completed,
    completed,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100)
  };
}
