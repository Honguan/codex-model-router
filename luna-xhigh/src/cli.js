import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments } from './arguments.js';
import { AppError } from './errors.js';
import {
  addTask,
  completeTask,
  formatStatistics,
  formatTasks,
  getStatistics,
  listTasks,
  removeTask
} from './task-service.js';
import { TaskStore } from './task-store.js';

export async function execute(argv, { dataDirectory, store } = {}) {
  const parsed = parseArguments(argv);
  const taskStore = store ?? new TaskStore({ dataDirectory });

  if (parsed.command === 'add') {
    const state = await taskStore.load();
    const result = addTask(state.tasks, state.nextId, parsed.options.title);
    await taskStore.saveState(result.tasks, result.nextId);
    return `Created task ${result.task.id}: ${result.task.title}\n`;
  }

  if (parsed.command === 'list') {
    const state = await taskStore.load();
    return formatTasks(listTasks(state.tasks, parsed.options.status ?? 'all'));
  }

  if (parsed.command === 'done') {
    const state = await taskStore.load();
    const result = completeTask(state.tasks, parsed.positionals[0]);
    if (!result.changed) {
      return `Task ${result.task.id} is already completed.\n`;
    }
    await taskStore.saveTasks(result.tasks, state.nextId);
    return `Completed task ${result.task.id}: ${result.task.title}\n`;
  }

  if (parsed.command === 'remove') {
    const state = await taskStore.load();
    const result = removeTask(state.tasks, parsed.positionals[0]);
    await taskStore.saveTasks(result.tasks, state.nextId);
    return `Removed task ${result.task.id}: ${result.task.title}\n`;
  }

  const state = await taskStore.load();
  return formatStatistics(getStatistics(state.tasks));
}

export async function main(argv = process.argv.slice(2), options = {}) {
  return execute(argv, options);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFile === currentFile) {
  main()
    .then((output) => {
      process.stdout.write(output);
    })
    .catch((error) => {
      const message = error instanceof AppError ? error.message : 'Unexpected error.';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
