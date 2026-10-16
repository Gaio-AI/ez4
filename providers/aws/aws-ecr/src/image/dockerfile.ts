import { createHash } from 'node:crypto';

export const computeImageTag = (dockerfile: string, bundleHash: string): string =>
  createHash('sha256').update(dockerfile).update(bundleHash).digest('hex');
