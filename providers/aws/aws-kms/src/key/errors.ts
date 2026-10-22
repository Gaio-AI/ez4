export class KeyNotFoundError extends Error {
  constructor(serviceName: string) {
    super(`Encryption service '${serviceName}' wasn't found.`);
  }
}
