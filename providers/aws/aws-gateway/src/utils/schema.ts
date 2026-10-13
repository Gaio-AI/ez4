import type { AnySchema } from '@ez4/schema';

import { getRuntimeSchema } from '@ez4/schema/library';

/**
 * A request or response schema as a function bundles it: without what only the documentation reads.
 */
export const getOptionalRuntimeSchema = <T extends AnySchema>(schema: T | undefined) => {
  return schema && getRuntimeSchema(schema);
};
