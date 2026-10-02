import type { StageThrottling } from '../client';

export type ThrottlingChange = { action: 'apply'; throttling: StageThrottling } | { action: 'reset' };

/**
 * What a stage's throttling needs to go from the deployed limits to the candidate ones. A stage that
 * loses its throttling is reset, or it would keep the last limits it was given.
 */
export const getThrottlingChange = (
  candidate: StageThrottling | undefined,
  current: StageThrottling | undefined
): ThrottlingChange | undefined => {
  if (candidate) {
    if (candidate.rateLimit !== current?.rateLimit || candidate.burstLimit !== current?.burstLimit) {
      return { action: 'apply', throttling: candidate };
    }

    return undefined;
  }

  if (current) {
    return { action: 'reset' };
  }

  return undefined;
};
