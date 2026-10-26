import { RefusedError } from './errors.js';

// Some work while loading, so the resolutions of its imports and its sibling's land in different milliseconds,
// as they do in a real module graph.
const until = Date.now() + 5;

while (Date.now() < until) {
  // Busy wait.
}

export const fail = () => {
  throw new RefusedError('refused');
};
