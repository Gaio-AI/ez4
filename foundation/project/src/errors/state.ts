export class StaleStateError extends Error {
  constructor() {
    super('State changed since the plan was made, nothing was applied: run it again to plan against the current state.');
  }
}
