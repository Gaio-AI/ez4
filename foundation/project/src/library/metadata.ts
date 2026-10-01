import type { AllType, ReflectionTypes, TypeClass } from '@ez4/reflection';
import type { MetadataDependencies, MetadataReflection } from '../types/metadata';

import { getReflectionFiles, isTypeClass, isTypeInterface, TypeName } from '@ez4/reflection';
import { triggerAllSync } from '@ez4/project/library';
import { Logger } from '@ez4/logger';

import { assertNoErrors } from '../utils/errors';
import { DuplicateMetadataError, UnhandledServiceError } from '../errors/metadata';
import { buildReflection, watchReflection } from './reflection';

export type MetadataReadyListener = (metadata: MetadataReflection) => Promise<void> | void;

export type MetadataResult = {
  dependencies: MetadataDependencies;
  metadata: MetadataReflection;
};

export type BuildMetadataOptions = {
  aliasPaths?: Record<string, string[]>;
};

export const buildMetadata = (sourceFiles: string[], options?: BuildMetadataOptions): MetadataResult => {
  const reflectionTypes = buildReflection(sourceFiles, options);
  const reflectionFiles = getMetadataFiles(reflectionTypes);

  const metadata: MetadataReflection = {};

  triggerAllSync('metadata:getServices', (handler) => {
    const result = handler(reflectionTypes);

    if (result) {
      assertNoErrors(result.errors);
      assignMetadataServices(metadata, result.services);
    }

    return null;
  });

  assertNoErrors(getUnhandledServiceErrors(reflectionTypes, metadata));

  return {
    metadata,
    dependencies: getReflectionFiles(reflectionFiles, {
      paths: options?.aliasPaths
    })
  };
};

export type WatchMetadataOptions = {
  onMetadataReady: MetadataReadyListener;
  aliasPaths?: Record<string, string[]>;
  additionalPaths?: string[];
};

export const watchMetadata = (sourceFiles: string[], options: WatchMetadataOptions) => {
  const { additionalPaths, aliasPaths, onMetadataReady } = options;

  return watchReflection(sourceFiles, {
    additionalPaths,
    aliasPaths,
    onReflectionReady: async (reflectionTypes) => {
      const metadata: MetadataReflection = {};

      triggerAllSync('metadata:getServices', (handler) => {
        const result = handler(reflectionTypes);

        if (result) {
          if (!result.errors.length) {
            assignMetadataServices(metadata, result.services);
          }

          for (const error of result.errors) {
            Logger.error(error.message);
          }
        }

        return null;
      });

      for (const error of getUnhandledServiceErrors(reflectionTypes, metadata)) {
        Logger.error(error.message);
      }

      await onMetadataReady(metadata);
    }
  });
};

const assignMetadataServices = (metadata: MetadataReflection, services: MetadataReflection) => {
  for (const identity in services) {
    if (identity in metadata) {
      throw new DuplicateMetadataError(identity);
    }

    metadata[identity] = services[identity];
  }
};

// Contracts and providers are found through the `@ez4/*` dependencies of the project, while a service
// declaration compiles with any package the workspace installs. A service whose contract package is
// missing is read by nobody: without this check it is left out of the deploy and the deploy succeeds.
const getUnhandledServiceErrors = (reflection: ReflectionTypes, metadata: MetadataReflection) => {
  const errors: UnhandledServiceError[] = [];

  for (const identity in reflection) {
    const declaration = reflection[identity];

    if (!isTypeClass(declaration) || !declaration.modifiers?.declare || declaration.modifiers.abstract) {
      continue;
    }

    // It needs to be a file in the project's root.
    if (!declaration.file || declaration.file.startsWith('..') || declaration.name in metadata) {
      continue;
    }

    const packageName = getServiceContractPackage(reflection, declaration);

    if (packageName) {
      errors.push(new UnhandledServiceError(declaration.name, packageName));
    }
  }

  return errors;
};

const getServiceContractPackage = (reflection: ReflectionTypes, declaration: TypeClass) => {
  for (const { path } of declaration.heritage ?? []) {
    const parent = reflection[path];

    if (parent?.module && isServiceProvider(reflection, parent, new Set())) {
      return parent.module;
    }
  }

  return undefined;
};

// Every service and import of a contract implements `Service.Provider` from `@ez4/common`.
const isServiceProvider = (reflection: ReflectionTypes, type: AllType, visited: Set<string>): boolean => {
  if (!isTypeClass(type) && !isTypeInterface(type)) {
    return false;
  }

  if (type.module === '@ez4/common' && type.name === 'Provider') {
    return true;
  }

  return !!type.heritage?.some(({ path }) => {
    const parent = reflection[path];

    if (!parent || visited.has(path)) {
      return false;
    }

    visited.add(path);

    return isServiceProvider(reflection, parent, visited);
  });
};

const getMetadataFiles = (reflection: ReflectionTypes) => {
  const metadataFiles = new Set<string>();

  for (const identity in reflection) {
    const declaration = reflection[identity];

    // It needs to be a file in the project's root.
    if (!declaration.file || declaration.file.startsWith('..')) {
      continue;
    }

    groupDeclarationFiles(declaration, metadataFiles);

    metadataFiles.add(declaration.file);
  }

  return [...metadataFiles];
};

const groupDeclarationFiles = (declaration: AllType, files = new Set<string>()) => {
  switch (declaration.type) {
    case TypeName.Function:
      if (declaration.file) {
        files.add(declaration.file);
      }
      break;

    case TypeName.Object:
      if (Array.isArray(declaration.members)) {
        declaration.members?.forEach((member) => {
          groupDeclarationFiles(member, files);
        });
      }
      break;

    case TypeName.Class:
    case TypeName.Interface:
      declaration.members?.forEach((member) => {
        groupDeclarationFiles(member, files);
      });
      break;
  }

  return files;
};
