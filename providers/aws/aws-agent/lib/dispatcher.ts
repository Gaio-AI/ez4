import { dispatchHandler } from '@ez4/aws-agent/handlers';

export const dispatcherEntryPoint = (event: unknown) => dispatchHandler(event);
