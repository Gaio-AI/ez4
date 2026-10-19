import { MAX_NAME_SIZE } from '../utils/naming';

export class MigrationNameCollisionError extends Error {
  constructor(public names: string[]) {
    super(`Names longer than ${MAX_NAME_SIZE} bytes collide once Postgres truncates them: ${names.join(', ')}.`);
  }
}
