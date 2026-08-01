#!/usr/bin/env node
import { parseArguments } from './arguments.js';
import { AppError } from './errors.js';
import { TaskService } from './task-service.js';
import { TaskStore } from './task-store.js';

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}

async function main(argv) {
  const request = parseArguments(argv);
  const service = new TaskService(new TaskStore());

  if (request.command === 'add') {
    const task = await service.add(request.title);
    writeLine(process.stdout, `Created task ${task.id}: ${task.title}`);
    return;
  }
  if (request.command === 'list') {
    const tasks = await service.list(request.status);
    if (tasks.length === 0) {
      writeLine(process.stdout, 'No tasks found.');
      return;
    }
    for (const task of tasks) {
      writeLine(process.stdout, `[${task.status === 'completed' ? 'x' : ' '}] ${task.id} ${task.title}`);
    }
    return;
  }
  if (request.command === 'done') {
    const result = await service.complete(request.id);
    writeLine(process.stdout, result.changed
      ? `Completed task ${request.id}: ${result.task.title}`
      : `Task ${request.id} is already completed.`);
    return;
  }
  if (request.command === 'remove') {
    const task = await service.remove(request.id);
    writeLine(process.stdout, `Removed task ${task.id}: ${task.title}`);
    return;
  }
  const statistics = await service.statistics();
  writeLine(process.stdout, `Total: ${statistics.total}\nPending: ${statistics.pending}\nCompleted: ${statistics.completed}\nCompletion rate: ${statistics.rate}%`);
}

main(process.argv.slice(2)).catch((error) => {
  writeLine(process.stderr, error instanceof AppError ? error.message : 'Unexpected error.');
  process.exitCode = 1;
});
