// Imports a fixture entry once per version given (`-` for no version) through the ez4 loader, calls its `check`,
// and prints the results with how many times each fixture file was loaded.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = pathToFileURL(process.cwd()).href;

const loads = {};

registerHooks({
  load: (url, context, next) => {
    if (url.startsWith(root)) {
      const file = url.slice(root.length + 1).replace(/\?.*$/, '');

      loads[file] = (loads[file] ?? 0) + 1;
    }

    return next(url, context);
  }
});

const [entry, ...versions] = process.argv.slice(2);

const entryUrl = pathToFileURL(resolve(entry)).href;

const results = [];

for (const version of versions) {
  const module = await import(version === '-' ? entryUrl : `${entryUrl}?v=${version}`);

  results.push(module.check());
}

console.log(JSON.stringify({ results, loads }));
