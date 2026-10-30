import type { CompilerHost, CompilerOptions, Node, Program } from 'typescript';
import type { TypeAnyEvents } from './types/type-any';
import type { TypeVoidEvents } from './types/type-void';
import type { TypeNeverEvents } from './types/type-never';
import type { TypeUnknownEvents } from './types/type-unknown';
import type { TypeUndefinedEvents } from './types/type-undefined';
import type { TypeNullEvents } from './types/type-null';
import type { TypeBooleanEvents } from './types/type-boolean';
import type { TypeNumberEvents } from './types/type-number';
import type { TypeStringEvents } from './types/type-string';
import type { TypeObjectEvents } from './types/type-object';
import type { TypeReferenceEvents } from './types/type-reference';
import type { TypeIntersectionEvents } from './types/type-intersection';
import type { ReflectionTypes } from './types/source';
import type { ReflectionCompilerHost } from './compiler';
import type { AllType } from './types';

import { createSourceFile, isExportDeclaration, isImportDeclaration, ScriptTarget } from 'typescript';
import { relative, resolve } from 'node:path';

import { createModuleCache, getModulePath } from './utils/module';
import { isTypeLiteralString } from './resolver/type-string';
import { trySource } from './resolver/source';

export { createAny } from './resolver/type-any';
export { createVoid } from './resolver/type-void';
export { createNever } from './resolver/type-never';
export { createUnknown } from './resolver/type-unknown';
export { createUndefined } from './resolver/type-undefined';
export { createNull } from './resolver/type-null';
export { createBoolean } from './resolver/type-boolean';
export { createNumber } from './resolver/type-number';
export { createString } from './resolver/type-string';
export { createReference } from './resolver/model-reference';
export { createObject } from './resolver/type-object';
export { createUnion } from './resolver/type-union';
export { createArray } from './resolver/type-array';
export { createTuple } from './resolver/type-tuple';
export { createEnum } from './resolver/type-enum';
export { createEnumMember } from './resolver/enum-member';
export { createClass } from './resolver/type-class';
export { createInterface } from './resolver/type-interface';
export { createCallback } from './resolver/type-callback';
export { createFunction } from './resolver/type-function';

export type ResolverEvents = TypeAnyEvents &
  TypeVoidEvents &
  TypeNeverEvents &
  TypeUnknownEvents &
  TypeUndefinedEvents &
  TypeNullEvents &
  TypeNumberEvents &
  TypeStringEvents &
  TypeBooleanEvents &
  TypeObjectEvents &
  TypeReferenceEvents &
  TypeIntersectionEvents;

export type ResolverOptions = {
  /**
   * Determines whether or not model and function types will output its source location (file path, module name and position).
   */
  includeLocation?: boolean;

  /**
   * Determines whether or not `enum` types are ignored from reflection.
   */
  ignoreEnum?: boolean;

  /**
   * Determines whether or not `class` types are ignored from reflection.
   */
  ignoreClass?: boolean;

  /**
   * Determines whether or not `interface` types are ignored from reflection.
   */
  ignoreInterface?: boolean;

  /**
   * Determines whether or not `method` types are ignored from reflection.
   */
  ignoreMethod?: boolean;

  /**
   * Determines whether or not `callback` types are ignored from reflection.
   */
  ignoreCallback?: boolean;

  /**
   * Determines whether or not `function` types are ignored from reflection.
   */
  ignoreFunction?: boolean;

  /**
   * Determines whether or not `parameter` types are ignored from reflection.
   * It has no effect when `ignoreMethod`, `ignoreCallback` or `ignoreFunction` is `true`.
   */
  ignoreParameters?: boolean;

  /**
   * Determines whether or not return types for `method`, `callback` and `function` types
   * are ignored from reflection. It has no effect when `ignoreMethod`, `ignoreCallback` or
   * `ignoreFunction` is `true`.
   */
  ignoreReturns?: boolean;
};

export type ReflectionOptions = {
  resolverOptions?: ResolverOptions;
  resolverEvents?: ResolverEvents;
};

export type ReflectionFiles = Record<string, string[]>;

// The files a program loads: without `allowJs`, an import resolved to JavaScript or JSON has no imports of its own.
const TYPESCRIPT_FILE = /\.(?:d\.)?[cm]?tsx?$/;

export const resolveReflectionFiles = (
  program: Program,
  compilerOptions: CompilerOptions,
  compilerHost: CompilerHost & Partial<Pick<ReflectionCompilerHost, 'isRedirectedFile'>>,
  fileNames: readonly string[] = program.getRootFileNames()
) => {
  const basePath = program.getCurrentDirectory();
  const moduleCache = createModuleCache(basePath, compilerOptions);
  const importGraph = new Map<string, string[]>();

  // The dependencies of a file are the files a program of its own would load. A file the program read
  // from another one (`onResolveFileName`) keeps the imports of the file on disk, and so does a file
  // only those imports reach, which the program never loaded.
  const getImportSource = (filePath: string) => {
    const sourceFile = program.getSourceFile(filePath);

    if (sourceFile && !compilerHost.isRedirectedFile?.(filePath)) {
      return sourceFile;
    }

    if (!TYPESCRIPT_FILE.test(filePath)) {
      return undefined;
    }

    const sourceText = compilerHost.readFile(filePath);

    return sourceText !== undefined ? createSourceFile(filePath, sourceText, ScriptTarget.ESNext) : undefined;
  };

  const getImportFiles = (fileName: string) => {
    const cachedImportFiles = importGraph.get(fileName);

    if (cachedImportFiles) {
      return cachedImportFiles;
    }

    // Imports resolve from the absolute path: from a relative one, the lookup for a package stops at
    // the working directory and misses the `node_modules` of a parent workspace.
    const filePath = resolve(basePath, fileName);
    const sourceFile = getImportSource(filePath);
    const importFiles: string[] = [];

    sourceFile?.forEachChild((node) => {
      if (!isImportDeclaration(node) && !isExportDeclaration(node)) {
        return;
      }

      if (!node.moduleSpecifier || !isTypeLiteralString(node.moduleSpecifier)) {
        return;
      }

      const moduleName = node.moduleSpecifier.text;
      const modulePath = getModulePath(moduleName, filePath, compilerOptions, compilerHost, moduleCache);

      if (modulePath) {
        importFiles.push(relative(basePath, modulePath));
      }
    });

    importGraph.set(fileName, importFiles);

    return importFiles;
  };

  const groupReflectionFiles = (fileName: string, dependencies = new Set<string>()) => {
    if (!dependencies.has(fileName)) {
      dependencies.add(fileName);

      getImportFiles(fileName).forEach((importFile) => {
        groupReflectionFiles(importFile, dependencies);
      });
    }

    return dependencies;
  };

  const imports: ReflectionFiles = {};

  for (const fileName of fileNames) {
    imports[fileName] = [...groupReflectionFiles(fileName)];
  }

  return imports;
};

export const resolveReflectionMetadata = (program: Program, options?: ReflectionOptions) => {
  const reflection: ReflectionTypes = {};

  const sourceContext = {
    checker: program.getTypeChecker(),
    options: options?.resolverOptions ?? {},
    events: options?.resolverEvents ?? {},
    cache: new WeakMap<Node, AllType>(),
    pending: new Set<Node>()
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      const source = trySource(sourceFile, sourceContext);

      Object.assign(reflection, source);

      sourceContext.pending.clear();
    }
  }

  return reflection;
};
