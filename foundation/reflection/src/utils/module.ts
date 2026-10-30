import type { CompilerHost, CompilerOptions, ModuleResolutionCache } from 'typescript';

import { createModuleResolutionCache, resolveModuleName } from 'typescript';

import { getCanonicalFileName } from './compiler';

const MODULES_PATH = '/node_modules/';

export const createModuleCache = (basePath: string, compilerOptions: CompilerOptions) => {
  return createModuleResolutionCache(basePath, (fileName) => getCanonicalFileName(fileName), compilerOptions);
};

export const getModulePath = (
  moduleName: string,
  sourceFile: string,
  compilerOptions: CompilerOptions,
  compilerHost: CompilerHost,
  moduleCache: ModuleResolutionCache
) => {
  const { resolvedModule } = resolveModuleName(moduleName, sourceFile, compilerOptions, compilerHost, moduleCache);

  return resolvedModule?.resolvedFileName;
};

export const getPathModule = (filePath: string) => {
  const moduleStart = filePath.indexOf(MODULES_PATH);

  if (moduleStart === -1) {
    return undefined;
  }

  const [moduleName, modulePath] = filePath.substring(moduleStart + MODULES_PATH.length).split('/');

  if (moduleName.startsWith('@')) {
    return `${moduleName}/${modulePath}`;
  }

  return moduleName;
};
