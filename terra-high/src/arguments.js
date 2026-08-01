import { AppError } from './errors.js';

const commands = new Set(['add', 'list', 'done', 'remove', 'stats']);

function readSingleOption(tokens, name) {
  let value;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      throw new AppError(`Unexpected argument: ${token}.`);
    }

    const [option, inlineValue] = token.split(/=(.*)/s, 2);
    if (option !== name) {
      throw new AppError(`Unsupported option: ${option}.`);
    }
    if (value !== undefined) {
      throw new AppError(`Duplicate option: ${name}.`);
    }

    if (inlineValue !== undefined) {
      if (inlineValue.length === 0) {
        throw new AppError(`Missing value for ${name}.`);
      }
      value = inlineValue;
      continue;
    }

    const next = tokens[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new AppError(`Missing value for ${name}.`);
    }
    value = next;
    index += 1;
  }

  return value;
}

function parseId(tokens) {
  if (tokens.length === 0) {
    throw new AppError('A task ID is required.');
  }
  if (tokens.length !== 1 || tokens[0].startsWith('--')) {
    throw new AppError(`Unexpected argument: ${tokens[1] ?? tokens[0]}.`);
  }
  if (!/^\d+$/.test(tokens[0]) || !Number.isSafeInteger(Number(tokens[0])) || Number(tokens[0]) < 1) {
    throw new AppError('Task ID must be a positive integer.');
  }
  return Number(tokens[0]);
}

export function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (command === undefined) {
    throw new AppError('A command is required.');
  }
  if (!commands.has(command)) {
    throw new AppError(`Unknown command: ${command}.`);
  }

  if (command === 'add') {
    const title = readSingleOption(tokens, '--title');
    if (title === undefined) {
      throw new AppError('Title is required.');
    }
    return { command, title };
  }

  if (command === 'list') {
    const status = readSingleOption(tokens, '--status') ?? 'all';
    if (!['pending', 'completed', 'all'].includes(status)) {
      throw new AppError('Status must be pending, completed, or all.');
    }
    return { command, status };
  }

  if (command === 'done' || command === 'remove') {
    return { command, id: parseId(tokens) };
  }

  if (tokens.length > 0) {
    throw new AppError(`Unexpected argument: ${tokens[0]}.`);
  }
  return { command };
}
