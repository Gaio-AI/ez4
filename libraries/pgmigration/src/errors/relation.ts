export class MigrationRelationError extends Error {
  constructor(
    public relation: string,
    reason: string
  ) {
    super(`Relation ${relation} ${reason}.`);
  }
}
