import { AppError } from './errors.js';

function titleLength(value) {
  return Array.from(value).length;
}

function validateTitle(rawTitle) {
  const title = rawTitle.trim();
  if (title.length === 0) {
    throw new AppError('Title must not be empty.');
  }
  if (titleLength(title) > 120) {
    throw new AppError('Title must be 120 characters or fewer.');
  }
  return title;
}

export class TaskService {
  constructor(store) {
    this.store = store;
  }

  async add(title) {
    return this.store.createTask({
      title: validateTitle(title),
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  }

  async list(status) {
    const tasks = await this.store.loadTasks();
    return tasks
      .filter((task) => status === 'all' || task.status === status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id);
  }

  async complete(id) {
    const result = await this.store.updateTask(id, (task) => {
      if (task.status === 'completed') {
        return { changed: false, task };
      }
      return {
        changed: true,
        task: { ...task, status: 'completed', completedAt: new Date().toISOString() },
      };
    });
    if (result === undefined) {
      throw new AppError(`Task not found: ${id}.`);
    }
    return result;
  }

  async remove(id) {
    const task = await this.store.removeTask(id);
    if (task === undefined) {
      throw new AppError(`Task not found: ${id}.`);
    }
    return task;
  }

  async statistics() {
    const tasks = await this.store.loadTasks();
    const completed = tasks.filter((task) => task.status === 'completed').length;
    return {
      total: tasks.length,
      pending: tasks.length - completed,
      completed,
      rate: tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100),
    };
  }
}
