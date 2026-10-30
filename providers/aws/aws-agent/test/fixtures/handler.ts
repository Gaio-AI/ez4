export const handle = (_request: unknown, context: object) => Object.keys(context);

// The bundler caches a bundle by file and function, so a second function of the file gets its own.
export const route = (_request: unknown, context: object) => Object.keys(context);
