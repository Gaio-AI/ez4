#!/usr/bin/env node
// Prints the key of the npm download cache: a digest of package-lock.json without what a release bumps.
// A release changes the version of each bumped workspace and the ranges other workspaces declare on it,
// never a dependency from the registry, so the release tree must key like the tree main cached.
//
// usage: node npm-cache-key.mjs <package-lock.json>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const isWorkspaceEntry = (path) => !/(^|\/)node_modules\//.test(path);

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
};

export function normalizeLockfile(lock) {
  const packages = lock.packages ?? {};
  const workspaces = new Set(
    Object.entries(packages)
      .filter(([path, entry]) => isWorkspaceEntry(path) && entry.name)
      .map(([, entry]) => entry.name)
  );

  const normalized = Object.fromEntries(
    Object.entries(packages).map(([path, entry]) => {
      if (!isWorkspaceEntry(path)) return [path, entry];
      const { version: _version, ...rest } = entry;
      for (const field of DEPENDENCY_FIELDS) {
        if (rest[field]) rest[field] = Object.fromEntries(Object.entries(rest[field]).filter(([name]) => !workspaces.has(name)));
      }
      return [path, rest];
    })
  );

  const { version: _version, ...rest } = lock;
  return sortKeys({ ...rest, packages: normalized });
}

export function npmCacheKey(text) {
  return createHash('sha256').update(JSON.stringify(normalizeLockfile(JSON.parse(text)))).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(npmCacheKey(readFileSync(process.argv[2], 'utf8')));
}
