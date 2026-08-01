export class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppError';
  }
}

export class StorageError extends AppError {
  constructor(message) {
    super(message);
    this.name = 'StorageError';
  }
}
