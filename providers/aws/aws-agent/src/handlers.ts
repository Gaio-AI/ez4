// What the Lambda templates (`lib/dispatcher.ts`, `lib/workflow.ts`) import. Not the library, which reaches the deploy
// code and through `@ez4/project` bundles TypeScript, nor the runtime entry, which bundles the provider SDK only the
// agent image runs.
export { dispatchHandler } from './dispatch/handler';
export { handleWorkflowEvent } from './workflow/handler';
