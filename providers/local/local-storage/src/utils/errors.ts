// Same name and message as the S3 error, so the code handling it works the same way locally.
export class ObjectNotFoundError extends Error {
  constructor() {
    super('The specified key does not exist.');

    this.name = 'NoSuchKey';
  }
}
