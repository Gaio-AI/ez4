import { Runtime } from '@ez4/common';

export type MessageTrace = {
  traceId?: string;
  scope?: string;
};

const TRACE_ID_HEADER = 'x-trace-id';
const SCOPE_HEADER = 'x-ez4-scope';

export const captureMessageTrace = (): MessageTrace => {
  return {
    traceId: Runtime.getScope()?.traceId,
    scope: Runtime.exportScope()
  };
};

export const getMessageTraceHeaders = (trace: MessageTrace): Record<string, string> => {
  return {
    ...(trace.traceId && { [TRACE_ID_HEADER]: trace.traceId }),
    ...(trace.scope && { [SCOPE_HEADER]: trace.scope })
  };
};

export const getMessageTraceFromHeaders = (headers: Record<string, string> | undefined): MessageTrace => {
  return {
    traceId: headers?.[TRACE_ID_HEADER],
    scope: headers?.[SCOPE_HEADER]
  };
};
