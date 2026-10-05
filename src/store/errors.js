// Errors the hosted (snapshot) storage can raise. The app maps them to HTTP answers.

export class StorageConflict extends Error {
  constructor() {
    super('Day Hub was changed somewhere else a moment ago. Nothing was lost; please try again.');
    this.name = 'StorageConflict';
  }
}

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageError';
  }
}
