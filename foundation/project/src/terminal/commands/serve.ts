import type { ServiceEmulators } from '../../emulator/service';
import type { ServeOptions } from '../../types/options';
import type { InputOptions } from '../options';
import type { AddressInfo } from 'node:net';

import { Logger, DynamicLogger, LogLevel } from '@ez4/logger';

import { createServer } from 'node:http';

import { warnUnsupportedFlags } from '../../utils/flags';
import { getProxyPort, getServeBind } from '../../utils/project';
import { addRoute, removeRoute } from '../../proxy/routes';
import { ensureProxy } from '../../proxy/daemon';
import { toRouteHost } from './proxy';
import { bootstrapServices, prepareServices, shutdownServices } from '../../emulator/utils/hooks';
import { useLambdaTimezone } from '../../emulator/utils/timezone';
import { getServiceEmulators } from '../../emulator/service';
import { getServeOptions } from '../../emulator/options';
import { loadReferences } from '../../config/references';
import { loadEnvironment } from '../../config/environment';
import { loadProviders } from '../../config/providers';
import { loadProject } from '../../config/project';
import { loadPaths } from '../../config/tsconfig';
import { configureVariables } from '@ez4/project/library';

import { watchMetadata } from '../../library/metadata';
import { upgradeHandler } from '../../serve/upgrade';
import { requestHandler } from '../../serve/request';

export const serveCommand = async (input: InputOptions) => {
  const project = await loadProject(input.project);
  const options = getServeOptions(input, project);

  configureVariables({
    strict: project.serveOptions?.strictVariables,
    allowed: project.serveOptions?.allowedVariables
  });

  if (options.debug) {
    Logger.setLevel(LogLevel.Debug);
  }

  const [paths, references, namespacePath] = await DynamicLogger.logExecution('⚡ Initializing', () => {
    return Promise.all([loadPaths(project), loadReferences(project), loadProviders(project)]);
  });

  if (input.environment) {
    loadEnvironment(input.environment);
  }

  useLambdaTimezone();

  warnUnsupportedFlags(input, {
    reset: options.local,
    environment: true,
    suppress: true,
    inspect: true,
    local: true
  });

  let emulators: ServiceEmulators = {};
  let isRunning = false;

  const additionalPaths = project.watchOptions?.additionalPaths ?? [];

  options.imports = references.imports;

  const sourceWatcher = await watchMetadata(project.sourceFiles, {
    additionalPaths: [namespacePath, ...additionalPaths],
    aliasPaths: { ...references.paths, ...paths },
    onMetadataReady: async (metadata) => {
      if (isRunning) {
        await shutdownServices(emulators);
        Logger.space();
      }

      emulators = await DynamicLogger.logExecution('🔄️ Loading emulators', () => {
        return getServiceEmulators(metadata, options);
      });

      displayServices(emulators, options);

      if (!isRunning) {
        await prepareServices(emulators);
      }

      await bootstrapServices(emulators);

      if (isRunning) {
        Logger.log(`🚀 Project [${project.projectName}] reloaded`);
      }

      options.version++;

      isRunning = true;
    }
  });

  const server = createServer();

  const bind = getServeBind(project.serveOptions);

  server.on('request', (request, stream) => {
    return requestHandler(request, stream, emulators, options);
  });

  server.on('upgrade', (request, socket) => {
    return upgradeHandler(request, socket, emulators, options);
  });

  server.on('error', async () => {
    Logger.error(`Unable to serve project [${project.projectName}] at http://${options.serviceHost}`);
    await shutdownServices(emulators);
    sourceWatcher.stop();
  });

  server.listen(bind.port, bind.host, async () => {
    if (bind.register) {
      const host = toRouteHost(options.serviceHost);
      const { port } = server.address() as AddressInfo;

      try {
        await ensureProxy(getProxyPort(project.serveOptions?.proxy));
        addRoute({ host, port, pid: process.pid });
        process.once('exit', () => removeRoute(host, process.pid));
      } catch (error) {
        Logger.error(`Not reachable at http://${options.serviceHost}: ${(error as Error).message}`);
      }
    }

    Logger.log(`🚀 Project [${project.projectName}] up and running`);
  });
};

const displayServices = (emulators: ServiceEmulators, options: ServeOptions) => {
  for (const identifier in emulators) {
    const emulator = emulators[identifier];

    if (emulator.requestHandler) {
      Logger.log(`🌐 Serving ${emulator.type} [${emulator.name}] at http://${options.serviceHost}/${identifier}`);
    }

    if (emulator.connectHandler) {
      Logger.log(`🌐 Serving ${emulator.type} [${emulator.name}] at ws://${options.serviceHost}/${identifier}`);
    }
  }
};
