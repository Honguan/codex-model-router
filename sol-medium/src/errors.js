export class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppError';
  }
}

export function isExpectedError(error) {
  return error instanceof AppError;
}
