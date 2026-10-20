export class MigrationIndexError extends Error {
  constructor(
    public index: string,
    reason: string
  ) {
    super(`Index ${index} ${reason}.`);
  }
}
