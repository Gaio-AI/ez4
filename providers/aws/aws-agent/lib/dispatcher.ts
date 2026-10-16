import { dispatchHandler } from '@ez4/aws-agent/library';

export const dispatcherEntryPoint = (event: unknown) => dispatchHandler(event);
