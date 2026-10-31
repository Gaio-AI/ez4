export class MigrationTimestampsError extends Error {
  constructor(
    public table: string,
    reason: string
  ) {
    super(`Table ${table} ${reason}.`);
  }
}
