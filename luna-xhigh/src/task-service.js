import { AppError } from './errors.js';

const VALID_STATUSES = new Set(['pending', 'completed', 'all']);
const MAX_TITLE_LENGTH = 120;

function characterLength(value) {
  return Array.from(value).length;
}

export function validateTitle(title) {
  if (typeof title !== 'string') {
    throw new AppError('The --title option is required.');
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    throw new AppError('Title must not be empty.');
  }
  if (characterLength(trimmedTitle) > MAX_TITLE_LENGTH) {
    throw new AppError('Title must be 120 characters or fewer.');
  }

  return trimmedTitle;
}

export function validateStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new AppError(`Invalid status: ${status}.`);
  }
  return status;
}

export function validateTaskId(id) {
  if (typeof id === 'number') {
    if (Number.isSafeInteger(id) && id > 0) {
      return id;
    }
  } else if (typeof id === 'string' && /^[1-9]\d*$/.test(id)) {
    const numericId = Number(id);
    if (Number.isSafeInteger(numericId)) {
      return numericId;
    }
  }

  throw new AppError('Task ID must be a positive integer.');
}

function timestampFrom(now) {
  const date = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('Unable to create a valid timestamp.');
  }
  return date.toISOString();
}

export function addTask(tasks, nextId, title, now) {
  const normalizedTitle = validateTitle(title);
  if (!Number.isSafeInteger(nextId) || nextId < 1) {
    throw new AppError('Stored ID metadata is invalid.');
  }

  const task = {
    id: nextId,
    title: normalizedTitle,
    status: 'pending',
    createdAt: timestampFrom(now),
    completedAt: null
  };

  return {
    task,
    tasks: [...tasks, task],
    nextId: nextId + 1
  };
}

export function completeTask(tasks, id, now) {
  const numericId = validateTaskId(id);
  const taskIndex = tasks.findIndex((task) => task.id === numericId);
  if (taskIndex === -1) {
    throw new AppError(`Task ${numericId} not found.`);
  }

  const task = tasks[taskIndex];
  if (task.status === 'completed') {
    return { task, tasks, changed: false };
  }

  const completedTask = {
    ...task,
    status: 'completed',
    completedAt: timestampFrom(now)
  };
  const updatedTasks = [...tasks];
  updatedTasks[taskIndex] = completedTask;

  return { task: completedTask, tasks: updatedTasks, changed: true };
}

export function removeTask(tasks, id) {
  const numericId = validateTaskId(id);
  const taskIndex = tasks.findIndex((task) => task.id === numericId);
  if (taskIndex === -1) {
    throw new AppError(`Task ${numericId} not found.`);
  }

  const [task] = tasks.slice(taskIndex, taskIndex + 1);
  return { task, tasks: tasks.filter((candidate) => candidate.id !== numericId) };
}

export function listTasks(tasks, status = 'all') {
  validateStatus(status);
  return tasks
    .filter((task) => status === 'all' || task.status === status)
    .slice()
    .sort((left, right) => {
      const timestampDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return timestampDifference || left.id - right.id;
    });
}

export function getStatistics(tasks) {
  const completed = tasks.reduce(
    (count, task) => count + (task.status === 'completed' ? 1 : 0),
    0
  );
  const total = tasks.length;
  const completionRate = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, pending: total - completed, completed, completionRate };
}

export function formatTasks(tasks) {
  if (tasks.length === 0) {
    return 'No tasks found.\n';
  }

  return `${tasks
    .map((task) => `${task.status === 'completed' ? '[x]' : '[ ]'} ${task.id} ${task.title}`)
    .join('\n')}\n`;
}

export function formatStatistics(statistics) {
  return [
    `Total: ${statistics.total}`,
    `Pending: ${statistics.pending}`,
    `Completed: ${statistics.completed}`,
    `Completion rate: ${statistics.completionRate}%`
  ].join('\n') + '\n';
}
