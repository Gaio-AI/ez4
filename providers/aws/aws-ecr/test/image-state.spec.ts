import { deepEqual } from 'node:assert/strict';
import { it } from 'node:test';
import { createEcrImage } from '../src/image/state';
import type { EcrRepositoryState } from '../src/repository/types';

it('uses the image hash as the immutable image tag', () => {
  const state = {};
  const repository = { entryId: 'repository' } as EcrRepositoryState;
  const image = createEcrImage(state, repository, {
    imageName: 'agent',
    dockerfile: 'FROM x',
    bundleFile: '/tmp/runtime.mjs',
    bundleHash: 'bundle',
    imageTag: 'abc123'
  });
  deepEqual(image.parameters.imageTag, 'abc123');
});
