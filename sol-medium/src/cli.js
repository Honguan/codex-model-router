#!/usr/bin/env node
import { parseArguments } from './arguments.js';
import { isExpectedError } from './errors.js';
import {
  calculateStatistics,
  completeTask,
  createTask,
  listTasks,
  parseTaskId,
  removeTask,
  validateTitle
} from './task-service.js';
import { TaskStore } from './task-store.js';

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}

async function run(argv) {
  const input = parseArguments(argv);
  const store = new TaskStore();

  switch (input.command) {
    case 'add': {
      const title = validateTitle(input.title);
      const tasks = await store.loadTasks();
      const id = await store.reserveId(tasks);
      const task = createTask(id, title);
      await store.saveTasks([...tasks, task]);
      return `Created task ${task.id}: ${task.title}`;
    }
    case 'list': {
      const tasks = listTasks(await store.loadTasks(), input.status);
      if (tasks.length === 0) {
        return 'No tasks found.';
      }
      return tasks
        .map((task) => `[${task.status === 'completed' ? 'x' : ' '}] ${task.id} ${task.title}`)
        .join('\n');
    }
    case 'done': {
      const id = parseTaskId(input.id);
      const tasks = await store.loadTasks();
      const result = completeTask(tasks, id);
      if (!result.changed) {
        return `Task ${id} is already completed.`;
      }
      await store.saveTasks(result.tasks);
      return `Completed task ${id}: ${result.task.title}`;
    }
    case 'remove': {
      const id = parseTaskId(input.id);
      const tasks = await store.loadTasks();
      const result = removeTask(tasks, id);
      await store.saveTasks(result.tasks);
      return `Removed task ${id}: ${result.task.title}`;
    }
    case 'stats': {
      const stats = calculateStatistics(await store.loadTasks());
      return [
        `Total: ${stats.total}`,
        `Pending: ${stats.pending}`,
        `Completed: ${stats.completed}`,
        `Completion rate: ${stats.completionRate}%`
      ].join('\n');
    }
    default:
      throw new Error('Unreachable command.');
  }
}

try {
  const output = await run(process.argv.slice(2));
  writeLine(process.stdout, output);
} catch (error) {
  writeLine(process.stderr, isExpectedError(error) ? error.message : 'Unexpected internal failure.');
  process.exitCode = 1;
}
