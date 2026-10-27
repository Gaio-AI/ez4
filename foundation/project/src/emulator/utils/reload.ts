import type { MetadataReflection } from '../../types/metadata';

import { isAnyObject, isAnyString } from '@ez4/utils';

/**
 * Text that two metadata builds share when they declare the same services: the position of each handler is left
 * out, since editing a handler's file moves it without changing what the emulators were made from.
 */
export const getMetadataSignature = (metadata: MetadataReflection) => {
  return JSON.stringify(metadata, function (this: unknown, key: string, value: unknown) {
    return key === 'position' && isEntrypoint(this) ? undefined : value;
  });
};

const isEntrypoint = (value: unknown) => {
  return isAnyObject(value) && isAnyString(value.file) && isAnyString(value.name) && Array.isArray(value.position);
};
