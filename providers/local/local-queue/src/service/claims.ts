import { getRandomUUID } from '@ez4/utils';

export type HeldClaim = {
  key: string;
  owner: string;
};

/**
 * - `taken`: this execution holds the key and runs the handler.
 * - `done`: the key already ran, or its outcome is unknown, so the handler doesn't run again.
 * - `busy`: another execution holds the key, so the message goes back to the queue.
 */
export type ClaimResult = { status: 'taken'; claim: HeldClaim } | { status: 'done' } | { status: 'busy' };

export type LocalClaims = {
  take: (key: string, lease: number) => ClaimResult;
  keep: (claim: HeldClaim, state: 'done' | 'unknown', ttl: number) => void;
  release: (claim: HeldClaim) => void;
};

type StoredClaim = {
  state: 'running' | 'done' | 'unknown';
  owner: string;
  expiresAt: number;
};

// Past this many keys, expired ones are dropped before taking another, so a long serve doesn't keep them all.
const SweepThreshold = 10000;

// Holds the keys of the idempotent subscriptions of a queue like the claims table of @ez4/aws-queue does, with the
// lease and the ttl in milliseconds.
export const createLocalClaims = (): LocalClaims => {
  const claims = new Map<string, StoredClaim>();

  const sweepExpired = (now: number) => {
    for (const [key, claim] of claims) {
      if (claim.expiresAt <= now) {
        claims.delete(key);
      }
    }
  };

  return {
    take: (key, lease) => {
      const now = Date.now();

      if (claims.size >= SweepThreshold) {
        sweepExpired(now);
      }

      const current = claims.get(key);

      if (current && current.expiresAt > now) {
        return current.state === 'running' ? { status: 'busy' } : { status: 'done' };
      }

      const owner = getRandomUUID();

      claims.set(key, { state: 'running', owner, expiresAt: now + lease });

      return { status: 'taken', claim: { key, owner } };
    },

    keep: (claim, state, ttl) => {
      const current = claims.get(claim.key);

      if (current?.owner === claim.owner) {
        claims.set(claim.key, { ...current, state, expiresAt: Date.now() + ttl });
      }
    },

    release: (claim) => {
      if (claims.get(claim.key)?.owner === claim.owner) {
        claims.delete(claim.key);
      }
    }
  };
};
