import { AppError } from './errors.js';

const COMMAND_OPTIONS = {
  add: new Set(['title']),
  list: new Set(['status']),
  done: new Set(),
  remove: new Set(),
  stats: new Set()
};

const COMMANDS = new Set(Object.keys(COMMAND_OPTIONS));

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function parseOption(token, tokens, index, allowedOptions, options) {
  const equalsIndex = token.indexOf('=');
  const optionName = equalsIndex === -1 ? token.slice(2) : token.slice(2, equalsIndex);
  const optionLabel = `--${optionName}`;

  if (!allowedOptions.has(optionName)) {
    throw new AppError(`Unsupported option: ${token}.`);
  }
  if (hasOwn(options, optionName)) {
    throw new AppError(`Duplicate option: ${optionLabel}.`);
  }

  if (equalsIndex !== -1) {
    options[optionName] = token.slice(equalsIndex + 1);
    return index;
  }

  const next = tokens[index + 1];
  if (next === undefined || next.startsWith('-')) {
    throw new AppError(`Missing value for option ${optionLabel}.`);
  }

  options[optionName] = next;
  return index + 1;
}

function validatePositionals(command, positionals) {
  if (command === 'done' || command === 'remove') {
    if (positionals.length === 0) {
      throw new AppError('Task ID is required.');
    }
    if (positionals.length > 1) {
      throw new AppError(`Unexpected argument: ${positionals[1]}.`);
    }
    return;
  }

  if (positionals.length > 0) {
    throw new AppError(`Unexpected argument: ${positionals[0]}.`);
  }
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new AppError('Command is required.');
  }

  const [command, ...tokens] = argv;
  if (!COMMANDS.has(command)) {
    throw new AppError(`Unknown command: ${command}.`);
  }

  const options = {};
  const positionals = [];
  const allowedOptions = COMMAND_OPTIONS[command];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('--')) {
      index = parseOption(token, tokens, index, allowedOptions, options);
      continue;
    }
    if (token.startsWith('-')) {
      throw new AppError(`Unsupported option: ${token}.`);
    }
    positionals.push(token);
  }

  validatePositionals(command, positionals);

  return { command, options, positionals };
}
