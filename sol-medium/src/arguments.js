import { AppError } from './errors.js';

const COMMANDS = new Set(['add', 'list', 'done', 'remove', 'stats']);

function parseSingleOption(args, name, { required = false, defaultValue } = {}) {
  let value = defaultValue;
  let seen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === `--${name}`) {
      if (seen) {
        throw new AppError(`Duplicate option: --${name}.`);
      }
      const next = args[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new AppError(`Missing value for --${name}.`);
      }
      seen = true;
      value = next;
      index += 1;
    } else if (argument.startsWith(`--${name}=`)) {
      if (seen) {
        throw new AppError(`Duplicate option: --${name}.`);
      }
      value = argument.slice(name.length + 3);
      if (value.length === 0) {
        throw new AppError(`Missing value for --${name}.`);
      }
      seen = true;
    } else if (argument.startsWith('--')) {
      throw new AppError(`Unsupported option: ${argument}.`);
    } else {
      throw new AppError(`Unexpected argument: ${argument}.`);
    }
  }

  if (required && !seen) {
    throw new AppError(`Missing required option: --${name}.`);
  }

  return value;
}

function parseIdCommand(command, args) {
  if (args.length === 0) {
    throw new AppError(`Missing task ID for ${command}.`);
  }
  if (args.length > 1) {
    const unexpected = args[1];
    if (unexpected.startsWith('--')) {
      throw new AppError(`Unsupported option: ${unexpected}.`);
    }
    throw new AppError(`Unexpected argument: ${unexpected}.`);
  }
  if (args[0].startsWith('--')) {
    throw new AppError(`Unsupported option: ${args[0]}.`);
  }
  return { command, id: args[0] };
}

export function parseArguments(argv) {
  if (argv.length === 0) {
    throw new AppError('Missing command.');
  }

  const [command, ...args] = argv;
  if (!COMMANDS.has(command)) {
    throw new AppError(`Unknown command: ${command}.`);
  }

  switch (command) {
    case 'add':
      return { command, title: parseSingleOption(args, 'title', { required: true }) };
    case 'list':
      return { command, status: parseSingleOption(args, 'status', { defaultValue: 'all' }) };
    case 'done':
    case 'remove':
      return parseIdCommand(command, args);
    case 'stats':
      if (args.length > 0) {
        if (args[0].startsWith('--')) {
          throw new AppError(`Unsupported option: ${args[0]}.`);
        }
        throw new AppError(`Unexpected argument: ${args[0]}.`);
      }
      return { command };
    default:
      throw new AppError('Unknown command.');
  }
}
