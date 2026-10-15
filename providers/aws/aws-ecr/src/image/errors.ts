export class MissingDockerCliError extends Error {
  constructor() {
    super('Docker CLI not found in PATH. Docker is required to build agent container images.');
  }
}
