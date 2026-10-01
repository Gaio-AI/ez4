import { MissingPackageError } from './common';

export class DuplicateMetadataError extends Error {
  constructor(public serviceName: string) {
    super(`Metadata for service ${serviceName} is duplicate.`);
  }
}

export class UnhandledServiceError extends MissingPackageError {
  constructor(
    public serviceName: string,
    public packageName: string
  ) {
    super(
      `Service ${serviceName} uses a contract from ${packageName}, but no package in this project reads it, so it would not be deployed.`
    );
  }
}
