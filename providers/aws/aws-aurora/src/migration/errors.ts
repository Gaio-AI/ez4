export class MigrationFailedError extends Error {
  constructor(errors: string[]) {
    super(`Migration failed with errors:${['', ...errors].join('\n  ')}`);
  }
}

export class MigrationStatementRunningError extends Error {
  constructor(query: string) {
    super(`Statement still running in the database, the next ones would run alongside it: ${query}`);
  }
}
