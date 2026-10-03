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

## Proxy host

Projects served side by side (e.g. one per git worktree) can share the `ez4 proxy` instead of picking a port each:

```js
export default {
  // ...
  serveOptions: {
    proxy: {
      domain: 'acme', // Required: label added before `.localhost`
      port: 80, // Optional: proxy port (default `80`)
      namespace: 'feat-1' // Optional: host label used instead of the branch
    }
  }
};
```

The project is then reached at `<project>.<branch>.<domain>.localhost`, where the branch comes from `--branch` or `branchName` and is left out when empty. The proxy listens on port `80` unless `EZ4_PROXY_PORT` or `proxy.port` (in that order) sets another one, which is then added to the host (`<project>.<branch>.<domain>.localhost:1355`). Clients of imported services use the same host, so a reference with `proxy` is called through the proxy. Without `proxy`, `serve` keeps `localHost` and `localPort`.

`proxy.namespace` replaces the branch in the host (`<project>.<namespace>.<domain>.localhost`), sanitized like a branch, and wins over `--branch` and `branchName`. It only changes the host, not resource names, so a worktree can serve against the remote resources of an environment without a branch and still get its own host.

With `proxy`, `ez4 serve` binds a free port on `127.0.0.1` (or `PORT` when set), starts the proxy when needed and registers its host; the route is removed when `serve` exits. Under `ez4 proxy run`, `serve` uses the given `PORT` and leaves the route to `proxy run`.

Branch names are sanitized the same way for hosts and resource names: any run of characters other than letters and digits becomes `-` (`feat/inbox_search` becomes `feat-inbox-search`). Postgres database names longer than 63 characters are cut and suffixed with a short hash, so long branches keep separate databases.

### Proxy commands

`ez4 serve` with `proxy` registers itself on the proxy and starts it when needed. Other local servers (e.g. a Vite app) can be put behind it with `ez4 proxy`:

| Command                                | Effect                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ez4 proxy run <name> -- <command>`    | Runs `<command>` with `PORT` (a free port), `HOST=127.0.0.1` and `EZ4_PROXY_ROUTE=<name>.localhost` and serves it at `http://<name>.localhost`. The route is removed when the command exits. |
| `ez4 proxy run -d <name> -- <command>` | Same, in the background; prints the URL and its log file, `~/.ez4/logs/<name>.localhost.log`.                                                                                                |
| `ez4 proxy ls`                         | Lists the running routes: host, URL, upstream port and pid.                                                                                                                                  |
| `ez4 proxy stop <name>`                | Stops the process behind a route.                                                                                                                                                            |
| `ez4 proxy setup`                      | Linux only: lets unprivileged processes bind port 80 (see below).                                                                                                                            |
| `ez4 proxy`                            | Starts the proxy in the foreground.                                                                                                                                                          |

`<name>` gets `.localhost` appended unless it already ends with it, and may only hold letters, digits, dashes and dots. `ez4 proxy run` requires a command after `--` and refuses a name whose route is owned by a live process; stop it first with `ez4 proxy stop <name>`. Routes of dead processes are dropped on the next lookup.

The proxy and every process behind it listen on `127.0.0.1` and `::1` only, and host names are validated before they touch the route files under `~/.ez4/proxy/routes`.

`EZ4_PROXY_PORT` sets the proxy port (default `80`, or `proxy.port`). `EZ4_PROXY_HOME` moves the proxy state (default `~/.ez4/proxy`), and logs then go to `<EZ4_PROXY_HOME>/logs` instead of `~/.ez4/logs`. The background proxy logs to `proxy.log` there.

Port `80` needs permission. On Linux the proxy uses the first option that works:

1. Bind port `80` directly (after `ez4 proxy setup`, or with the `CAP_NET_BIND_SERVICE` capability).
2. Listen on port `1355` behind a Docker container named `ez4-proxy-80` that forwards loopback port `80` to it (`alpine/socat`, host network, restarted with Docker). Remove it with `docker rm -f ez4-proxy-80`.
3. Fail, asking to run `ez4 proxy setup`, install Docker or set `EZ4_PROXY_PORT=1355`.

On macOS and Windows, binding loopback port `80` needs root and Docker Desktop's host network does not reach host loopback, so without root the proxy fails and asks for `EZ4_PROXY_PORT=1355` (URLs then carry `:1355`). When another server holds port `80`, the proxy fails too. The port never changes on its own: a different port only comes from `EZ4_PROXY_PORT` or `proxy.port`.

`ez4 proxy setup` writes `net.ipv4.ip_unprivileged_port_start=80` to `/etc/sysctl.d/50-ez4-proxy.conf` with sudo. This is system-wide: every user and process on the machine may then bind ports from `80` up. Delete that file and run `sudo sysctl --system` to undo it.

`ez4 proxy run` targets POSIX systems (Linux, macOS). Signals sent to it reach the command, but killing it with `SIGKILL` leaves the command running.

### Checking the proxy

```sh
ez4 proxy ls                                  # registered routes
curl -i http://backend.feat-1.acme.localhost/ # request through the proxy
curl -i -H 'Host: backend.feat-1.acme.localhost' http://127.0.0.1/ # when the client does not resolve *.localhost
```

A `502` with `ez4 proxy: no route for <host>` means nothing is registered for that host: the server is not running, or the host differs (check the branch and `ez4 proxy ls`). `ez4 proxy: <host> unreachable` means the route exists but its process does not answer. Proxy start errors are in `~/.ez4/logs/proxy.log`.

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
