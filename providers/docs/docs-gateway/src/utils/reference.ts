export type SchemaOutputContext = {
  /**
   * JSON pointer of the schema being written.
   */
  pointer: string;

  /**
   * JSON pointer of every object schema written so far, by schema identity.
   */
  identities: Map<number, string>;
};

export const getSchemaReference = (schemaName: string) => {
  return `#/components/schemas/${getPointerToken(schemaName)}`;
};

export const createSchemaOutputContext = (schemaName: string): SchemaOutputContext => {
  return {
    pointer: getSchemaReference(schemaName),
    identities: new Map()
  };
};

export const getChildSchemaOutputContext = (context: SchemaOutputContext | undefined, ...path: (string | number)[]) => {
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    pointer: [context.pointer, ...path.map((token) => getPointerToken(`${token}`))].join('/')
  };
};

const getPointerToken = (token: string) => {
  // References are written in single quotes, so the quote is percent-encoded as well.
  return encodeURIComponent(token.replaceAll('~', '~0').replaceAll('/', '~1')).replaceAll(`'`, '%27');
};
