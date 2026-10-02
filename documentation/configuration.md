# EZ4: Configuration

EZ4 projects are configured through an `ez4.project.js` file. Each independently deployed project should have its own configuration file, typically placed at the project root.

## Getting started

The configuration file controls how EZ4 builds, deploys, and serves your project. It defines defaults for all resources, deployment behavior, local development settings, shared variables, and more. It can include any of the options shown below, and only the fields relevant to your project are required.

```js
import { ArchitectureType, LogLevel, RuntimeType } from '@ez4/project';

/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: 'dev', // Project prefix
  projectName: 'backend', // Project name (required)
  branchName: 'feat-1', // Optional branch name to share deployed resources
  sourceFiles: ['./src/api.ts', './src/queues/*.ts'], // Entry-point source files or glob patterns

  tsconfigFile: 'tsconfig.json', // Specify a custom tsconfig.json location
  packageFile: 'package.json', // Specify a custom package.json location

  confirmMode: true, // Ask for deploy confirmation when it's true
  debugMode: true, // See more logs when serving and in the deployed resources
  localMode: true, // Enable the local mode for the resources when serving
  resetMode: true, // Enable the reset mode for the local resources when serving

  // Configure how the state file is stored
  stateFile: {
    path: 'ez4-state', // Path to the state file
    remote: true // Enable remote storage (in your cloud account) for the state file
  },

  // Configure the default options for all resource contracts
  defaultOptions: {
    logLevel: LogLevel.Debug, // Default log level for all handlers
    logRetention: 15, // Default log retention (in days) for all handlers
    architecture: ArchitectureType.Arm, // Default architecture for all handlers
    runtime: RuntimeType.Node24, // Default runtime for all handlers
    memory: 192 // Default amount of memory available (in megabytes) for all handlers
  },

  // Configure the deployment options for all resources
  deployOptions: {
    maxConcurrency: 10, // Maximum number of resource changes processed concurrently.

    // Configure the deployment release
    release: {
      tagName: 'Version', // Name of the tag to hold the release version
      variableName: 'VERSION', // Name of the environment variable to hold the release version
      version: '0.0.0' // Current release version
    }
  },

  // Configure how to serve the project locally
  serveOptions: {
    localHost: 'localhost', // Host name/address when serving the project
    localPort: 3734 // Port when serving the project
  },

  // Configure the watch mode for when serving the project
  watchOptions: {
    additionalPaths: ['./test'] // Additional paths to watch during development.
  },

  // Configure the local development options for the providers
  localOptions: {},

  // Configure the test options for the providers
  testOptions: {},

  // Environment variables shared with all resources
  variables: {
    DUMMY_API_KEY: 'A-BC123'
  },

  // Tags shared with all resources
  tags: {
    Project: 'EZ4' // Use the tag name/value key pair
  },

  // Configure the imported projects references
  references: {
    // Identification key for the imported project
    another_project: {
      projectFile: '../frontend/ez4.project.js', // Path to the EZ4's configuration
      enabled: true // Set false where the imported project isn't deployed (see below)
    }
  },

  // Configure the custom providers
  customProviders: {
    packages: ['@my-project/custom'] // List of installed packages that have custom providers
  }
};
```

With the configuration file in place, EZ4 knows how to build, deploy, and serve your project.

## Disabled references

A project that exists only in some environments (e.g. only in production) can still be referenced from the others by disabling its reference there:

```js
const { STAGE } = process.env;

export default {
  // ...
  references: {
    '@my-project/collector': {
      projectFile: '../collector/ez4.project.js',
      enabled: STAGE === 'prd'
    }
  }
};
```

A disabled reference still provides its types, so the code importing them keeps compiling, but nothing of the referenced project is looked up or linked:

- Each `Http.Import` of it has no gateway, the deploy says so with an `Import <project> is disabled` warning, and its client fails every operation with `503` (`Imported service '<project>' is disabled in this deployment.`), deployed or served locally.
- Any other import of it (e.g. `Queue.Import` or `Topic.Import`) fails the deploy, as only `Http.Import` supports a disabled reference.
- Switching the reference on or off redeploys the code of every function using its imports, so they get the right client.

## Examples

- [Storage manager](../examples/aws-storage-manager)
- [Schedule manager](../examples/aws-schedule-manager)
- [Importing gateway](../examples/aws-import-gateway)
- [Importing queue](../examples/aws-import-queue)
- [Importing topic](../examples/aws-import-topic)

## What's next

- [Deployment overview](./deployment.md)
- [Contracts overview](./contracts.md)
- [Architecture overview](./architecture.md)
- [Philosophy](./philosophy.md)

## License

MIT License
