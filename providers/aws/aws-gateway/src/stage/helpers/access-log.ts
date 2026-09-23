import type { Arn } from '@ez4/aws-common';

export type AccessLogSettings = {
  logGroupArn?: Arn;
  format?: string;
};

export type AccessLogChange = { action: 'enable'; logGroupArn: Arn } | { action: 'disable' };

/**
 * Line written to a stage's access log for every request.
 *
 * A request the gateway fails on its own (authorizer, Lambda invoke, timeout) reaches no handler, so
 * only this line tells it apart: `errorType` names the failing step, `integrationServiceStatus` is
 * what the Lambda service answered (not the function), and `responseLatency` against
 * `integrationLatency` shows where the time went.
 */
export const getAccessLogFormat = (): string => {
  return JSON.stringify({
    requestId: '$context.requestId',
    timestamp: '$context.requestTimeEpoch',
    protocol: '$context.protocol',
    route: '$context.routeKey',
    status: '$context.status',
    responseLatency: '$context.responseLatency',
    errorMessage: '$context.error.message',
    errorType: '$context.error.responseType',
    responseLength: '$context.responseLength',
    authorizationError: '$context.authorizer.error',
    integrationRequestId: '$context.integration.requestId',
    integrationStatus: '$context.integration.status',
    integrationServiceStatus: '$context.integration.integrationStatus',
    integrationError: '$context.integration.error',
    integrationLatency: '$context.integration.latency',
    userAgent: '$context.identity.userAgent',
    ip: '$context.identity.sourceIp'
  });
};

/**
 * What a stage's access logs need to go from the deployed settings to the candidate ones. The format
 * counts as much as the log group, or a stage that already logs keeps the format it was created with.
 */
export const getAccessLogChange = (candidate: AccessLogSettings, current: AccessLogSettings): AccessLogChange | undefined => {
  const { logGroupArn } = candidate;

  if (logGroupArn) {
    if (logGroupArn !== current.logGroupArn || candidate.format !== current.format) {
      return { action: 'enable', logGroupArn };
    }

    return undefined;
  }

  if (current.logGroupArn) {
    return { action: 'disable' };
  }

  return undefined;
};
