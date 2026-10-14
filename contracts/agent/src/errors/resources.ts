import { TypeError } from '@ez4/common/library';

export class InvalidCpuMemoryCombinationError extends TypeError {
  constructor(
    public cpu: number,
    public memory: number,
    fileName?: string
  ) {
    super(`Invalid CPU and memory combination (${cpu} CPU, ${memory} MiB) for Fargate agent.`, fileName);
  }
}

export class InvalidResourceBoundsError extends TypeError {
  constructor(
    public resourceName: string,
    public value: number,
    public bounds: [number, number],
    fileName?: string
  ) {
    super(
      `Resource '${resourceName}' value ${value} is out of bounds [${bounds[0]}, ${bounds[1]}].`,
      fileName
    );
  }
}
