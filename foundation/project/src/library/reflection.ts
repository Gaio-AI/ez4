import type { ReflectionOptions, ReflectionReadyListener, ReflectionTypes } from '@ez4/reflection';

import { existsSync, globSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { getReflectionFromFiles, watchReflectionFromFiles } from '@ez4/reflection';
import { triggerAllSync } from '@ez4/project/library';

import { ReflectionSourceFileNotFound } from '../errors/reflection';

export type BuildReflectionOptions = {
  aliasPaths?: Record<string, string[]>;
};

export const buildReflection = (sourceFiles: string[], options?: BuildReflectionOptions): ReflectionTypes => {
  return getReflectionFromFiles(getReflectionSources(sourceFiles), {
    ...getReflectionOptions(),
    compilerOptions: {
      paths: options?.aliasPaths
    }
  });
};

export type WatchReflectionOptions = {
  onReflectionReady: ReflectionReadyListener;
  aliasPaths?: Record<string, string[]>;
  additionalPaths?: string[];
};

export const watchReflection = (sourceFiles: string[], options: WatchReflectionOptions) => {
  const { additionalPaths, aliasPaths } = options;

  return watchReflectionFromFiles(getReflectionSources(sourceFiles), {
    ...getReflectionOptions(options.onReflectionReady),
    additionalPaths,
    compilerOptions: {
      paths: aliasPaths
    }
  });
};

const getReflectionOptions = (onReflectionReady?: ReflectionReadyListener): ReflectionOptions => {
  return {
    compilerEvents: {
      onReflectionReady,
      onResolveFileName: (fileName) => {
        return triggerAllSync('reflection:loadFile', (handler) => handler(fileName)) ?? fileName;
      }
    },
    resolverEvents: {
      onTypeObject: (type) => {
        return triggerAllSync('reflection:typeObject', (handler) => handler(type)) ?? type;
      }
    },
    resolverOptions: {
      ignoreMethod: true,
      includeLocation: true
    }
  };
};

/**
 * Expand the project source files, each one a path or a glob pattern, into the files to reflect.
 * An entry naming an existing file is taken as it is, so a file name with glob characters or a path
 * inside `node_modules` keeps working. A pattern only matches files, sorted, since the order a
 * directory lists its files differs between systems. A file reached twice is reflected once.
 */
export const getReflectionSources = (sourceFiles: string[]) => {
  const reflectionSources = new Set<string>();

  for (const sourceFile of sourceFiles) {
    if (existsSync(sourceFile)) {
      reflectionSources.add(resolve(sourceFile));
      continue;
    }

    // A pattern in `exclude` is matched relative to the working directory and misses a pattern
    // outside it, like `../shared/**`, so dependencies are pruned by directory name instead.
    const matches = globSync(sourceFile, {
      exclude: (entry) => entry.name === 'node_modules',
      withFileTypes: true
    });

    const matchedFiles = matches.filter((entry) => entry.isFile()).map((entry) => resolve(join(entry.parentPath, entry.name)));

    if (!matchedFiles.length) {
      throw new ReflectionSourceFileNotFound(sourceFile);
    }

    for (const matchedFile of matchedFiles.sort()) {
      reflectionSources.add(matchedFile);
    }
  }

  return [...reflectionSources];
};
