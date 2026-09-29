// The errors carry the name of the AWS SDK exceptions, so the code handling them works the same way locally.

export class ScheduleConflictError extends Error {
  constructor(identifier: string) {
    super(`Schedule ${identifier} already exists.`);

    this.name = 'ConflictException';
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Schedule ${identifier} does not exist.`);

    this.name = 'ResourceNotFoundException';
  }
}
