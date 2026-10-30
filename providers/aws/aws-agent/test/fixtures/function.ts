// A function template like any provider's: the bundler inlines it after the handler import and the linked context.
declare const __EZ4_CONTEXT: object;

declare function handle(request: unknown, context: object): unknown;

export const entryPoint = (request: unknown) => handle(request, __EZ4_CONTEXT);
