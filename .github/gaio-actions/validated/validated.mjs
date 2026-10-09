import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LEG_NAME, legLabel, resolveNaming } from './names.mjs';

export function onlyIgnored(paths, ignore) {
  return paths.every((path) =>
    ignore.some((pattern) => (pattern.startsWith('*') ? path.endsWith(pattern.slice(1)) : path.startsWith(pattern)))
  );
}

export function mustRun(paths, configPath) {
  return paths.some((path) => path === configPath || path.startsWith('.github/workflows/'));
}

export function skipsAll(changed, ignore, configPath) {
  return !mustRun(changed, configPath) && !changed.some((path) => path.startsWith('.changeset/')) && onlyIgnored(changed, ignore);
}

// Version bumps come from the release flow, not from a code change: a manifest whose only difference is
// `version` (and any CHANGELOG.md) must hash identically so a released tree reuses the validated cache.
export function normalizePackageJson(text) {
  try {
    const manifest = JSON.parse(text);
    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest) && 'version' in manifest) {
      const { version: _version, ...rest } = manifest;
      return JSON.stringify(rest);
    }
    return text;
  } catch {
    return text;
  }
}

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

const digestLines = (entries, readBlob) => {
  const lines = [];
  for (const { path, blob } of entries) {
    if (basename(path) === 'CHANGELOG.md') continue;
    const id = basename(path) === 'package.json' ? createHash('sha256').update(normalizePackageJson(readBlob(blob))).digest('hex') : blob;
    lines.push(`${path}\0${id}`);
  }
  return lines.sort();
};

export function contentDigest(entries, readBlob) {
  return createHash('sha256').update(digestLines(entries, readBlob).join('\n')).digest('hex');
}

export function lintInputs(files, ignore, configPath, readBlob = (blob) => blob) {
  const entries = files.filter(({ path }) => mustRun([path], configPath) || !onlyIgnored([path], ignore));
  return Object.fromEntries(digestLines(entries, readBlob).map((line) => line.split('\0')));
}

const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]+')}$`);

export function workspaceDirs(files, patterns) {
  const matchers = patterns.map(globToRegExp);
  return files
    .filter((file) => file.endsWith('/package.json'))
    .map((file) => file.slice(0, -'/package.json'.length))
    .filter((dir) => matchers.some((matcher) => matcher.test(dir)))
    .sort();
}

export function packageDirs(files, patterns) {
  return patterns.length > 0 ? workspaceDirs(files, patterns) : ['.'];
}

export const treeRef = (dir) => (dir === '.' ? 'HEAD:' : `HEAD:${dir}`);

export function closure(name, graph, seen = new Set()) {
  if (seen.has(name)) return [...seen].sort();
  seen.add(name);
  for (const dep of graph[name] ?? []) closure(dep, graph, seen);
  return [...seen].sort();
}

const sorted = (map) => Object.keys(map).sort().map((key) => `${key}=${map[key]}`).join('\n');

export function taskHash({ task, command, node, trees, shared }) {
  return createHash('sha256').update([task, command, node, sorted(trees), sorted(shared)].join('\n--\n')).digest('hex');
}

const fill = (template, pkg, shard) =>
  template.replaceAll('{package}', pkg).replaceAll('{shard}', shard ? `--shard=${shard}` : '').trim();

export function packageTaskHash({ task, pkg, node, trees, shared }) {
  return taskHash({ task: task.name, command: fill(task.run, pkg, ''), node, trees, shared });
}

export function planLegs({ tasks, packages, hashes, validated, legName = DEFAULT_LEG_NAME }) {
  const legs = [];
  for (const task of tasks) {
    for (const pkg of Object.keys(packages).sort()) {
      const hash = hashes[task.name]?.[pkg];
      if (task.packages && !task.packages.includes(pkg)) continue;
      if (!packages[pkg].scripts?.[task.script] || !hash || validated.has(hash)) continue;
      const count = task.shards?.[pkg] ?? 0;
      const shards = count > 1 ? Array.from({ length: count }, (_, i) => `${i + 1}/${count}`) : [''];
      const prepare = fill(task.prepare?.[pkg] ?? task.prepare?.['*'] ?? '', pkg, '');
      shards.forEach((shard, index) => legs.push({ task: task.name, package: pkg, shard, index, hash, run: fill(task.run, pkg, shard), prepare, label: legLabel(legName, { task: task.name, package: pkg, shard }) }));
    }
  }
  return legs;
}

export function checkLegs({ checks, hashOf, validated, legName = DEFAULT_LEG_NAME }) {
  return (checks ?? [])
    .map((check) => ({ name: check.name, run: check.run, advisory: check.advisory === true, hash: hashOf(check), label: legLabel(legName, { task: check.name }) }))
    .filter((leg) => !validated.has(leg.hash));
}

export function expectedCounts(legs, lintHash, extraHashes = []) {
  const counts = {};
  for (const leg of legs) counts[leg.hash] = (counts[leg.hash] ?? 0) + 1;
  if (lintHash) counts[lintHash] = 1;
  for (const hash of extraHashes) counts[hash] = 1;
  return counts;
}

export function greenHashes(files, expected) {
  const seen = {};
  for (const file of files) {
    const [hash, index] = file.split('__');
    (seen[hash] ??= new Set()).add(index);
  }
  return Object.keys(expected).filter((hash) => (seen[hash]?.size ?? 0) >= expected[hash]).sort();
}

export function mergeManifest(previous, passed, cap = 5000) {
  const lines = [...previous.split('\n').filter(Boolean), ...passed];
  const unique = [...new Map(lines.map((line, index) => [line, index])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([line]) => line);
  const kept = unique.slice(-cap);
  return kept.length ? `${kept.join('\n')}\n` : '';
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const revParse = (spec) => {
  try {
    return git('rev-parse', spec);
  } catch {
    return undefined;
  }
};

const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

const OUTPUT_DELIMITER = 'GAIO_OUTPUT_EOF';

export function formatOutput(key, value) {
  if (!String(value).includes('\n')) return `${key}=${value}\n`;
  if (String(value).includes(OUTPUT_DELIMITER)) throw new Error(`output ${key} contains ${OUTPUT_DELIMITER}`);
  return `${key}<<${OUTPUT_DELIMITER}\n${value}\n${OUTPUT_DELIMITER}\n`;
}

export function resolveBuildCache(config) {
  const paths = config['build-cache'];
  if (paths === undefined) return [];
  if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error('build-cache: must be an array of non-empty strings');
  }
  paths.forEach((entry, index) => {
    if (entry.startsWith('/') || entry.split('/').includes('..')) throw new Error(`build-cache[${index}]: must be a relative path without ..`);
  });
  return paths;
}

const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, formatOutput(key, value));
};

// ponytail: negated (`!dir`) workspace globs are ignored; add exclusion when a consumer needs it.
function workspacePatterns() {
  const yaml = readText('pnpm-workspace.yaml');
  if (!yaml) {
    const workspaces = JSON.parse(readText('package.json') || '{}').workspaces ?? [];
    return Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? []);
  }
  const patterns = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) inPackages = /^packages:\s*$/.test(line);
    const item = inPackages && line.match(/^\s+-\s+['"]?([^'"#\s]+)/);
    if (item && !item[1].startsWith('!')) patterns.push(item[1]);
  }
  return patterns;
}

function readWorkspace() {
  const dirs = packageDirs(git('ls-files').split('\n'), workspacePatterns());
  const manifests = dirs.map((dir) => ({ dir, ...JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) }));
  const names = new Set(manifests.map((manifest) => manifest.name));
  const packages = {};
  const graph = {};
  const dirOf = {};
  for (const { dir, name, scripts, dependencies, devDependencies, peerDependencies } of manifests) {
    packages[name] = { scripts: scripts ?? {} };
    dirOf[name] = dir;
    graph[name] = Object.keys({ ...dependencies, ...devDependencies, ...peerDependencies }).filter((dep) => names.has(dep));
  }
  return { packages, graph, dirOf };
}

const treeEntries = (dir) =>
  git('ls-tree', '-r', '-z', treeRef(dir))
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { path, blob: meta.split(' ')[2] };
    });

const readBlobs = (blobs) => {
  const texts = {};
  const unique = [...new Set(blobs)];
  for (let i = 0; i < unique.length; i++) {
    texts[unique[i]] = git('cat-file', 'blob', unique[i]);
  }
  return texts;
};

const treeDigestOf = (dir) => {
  const entries = treeEntries(dir);
  const blobs = readBlobs(entries.filter(({ path }) => basename(path) === 'package.json').map(({ blob }) => blob));
  return contentDigest(entries, (blob) => blobs[blob] ?? blob);
};

const trackedFiles = () =>
  git('ls-tree', '-r', '-z', '--full-tree', 'HEAD')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { path, blob: meta.split(' ')[2] };
    });

function computeHashes(config, configPath) {
  const node = readText('.nvmrc').trim();
  const { packages, graph, dirOf } = readWorkspace();
  const shared = {};
  for (const file of config['shared-inputs'] ?? []) {
    const blob = revParse(`HEAD:${file}`);
    if (blob) shared[file] = blob;
  }
  const hashes = {};
  for (const task of config.tasks ?? []) {
    hashes[task.name] = {};
    for (const pkg of Object.keys(packages)) {
      const trees = Object.fromEntries(closure(pkg, graph).map((dep) => [dirOf[dep], treeDigestOf(dirOf[dep])]));
      hashes[task.name][pkg] = packageTaskHash({ task, pkg, node, trees, shared });
    }
  }
  const tracked = trackedFiles();
  const trackedBlobs = readBlobs(tracked.filter(({ path }) => basename(path) === 'package.json').map(({ blob }) => blob));
  const trees = lintInputs(tracked, config.ignore ?? [], configPath, (blob) => trackedBlobs[blob] ?? blob);
  const lintHash = config.lint ? taskHash({ task: 'lint', command: config.lint, node, trees, shared: {} }) : '';
  const checks = config.checks ?? [];
  const checkHashes = Object.fromEntries(
    checks.map(({ name, run }) => [name, taskHash({ task: `check:${name}`, command: run, node, trees, shared: {} })])
  );
  return { tasks: config.tasks ?? [], packages, hashes, lintHash, checks, checkHashes };
}

function main([command]) {
  const { CONFIG = '.github/gaio-ci.json', BASE = '', MANIFEST = '.validated', PASSED_DIR = 'passed', LEGS = '[]', LINT_HASH = '', CHECK_HASHES = '' } = process.env;
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const previous = readText(MANIFEST);

  switch (command) {
    case 'plan': {
      const { names, legName } = resolveNaming(config);
      const buildCache = resolveBuildCache(config).join('\n');
      const changed = BASE ? git('diff', '--name-only', `${BASE}...HEAD`).split('\n').filter(Boolean) : undefined;
      if (changed && skipsAll(changed, config.ignore ?? [], CONFIG)) {
        output('skip', true);
        output('names', JSON.stringify(names));
        output('build-cache', '');
        output('legs', '[]');
        output('lint-hash', '');
        output('lint-needed', false);
        output('checks', '[]');
        return output('check-hashes', '[]');
      }
      const validated = new Set(previous.split('\n').filter(Boolean));
      const { tasks, packages, hashes, lintHash, checks, checkHashes } = computeHashes(config, CONFIG);
      output('skip', false);
      output('names', JSON.stringify(names));
      output('build-cache', buildCache);
      output('legs', JSON.stringify(planLegs({ tasks, packages, hashes, validated, legName })));
      output('lint-hash', lintHash);
      output('lint-needed', lintHash !== '' && !validated.has(lintHash));
      const checkPlan = checkLegs({ checks, hashOf: (check) => checkHashes[check.name], validated, legName });
      output('checks', JSON.stringify(checkPlan));
      return output('check-hashes', JSON.stringify(checkPlan.map((leg) => leg.hash)));
    }
    case 'merge': {
      const passed = existsSync(PASSED_DIR) ? readdirSync(PASSED_DIR) : [];
      return writeFileSync(MANIFEST, mergeManifest(previous, greenHashes(passed, expectedCounts(JSON.parse(LEGS), LINT_HASH, JSON.parse(CHECK_HASHES || '[]')))));
    }
    case 'all': {
      const { tasks, packages, hashes, lintHash, checks, checkHashes } = computeHashes(config, CONFIG);
      const taskHashes = planLegs({ tasks, packages, hashes, validated: new Set() }).map((leg) => leg.hash);
      // Advisory checks pass under continue-on-error even when they fail, so only blocking ones are proven green.
      const blockingCheckHashes = checks.filter((check) => check.advisory !== true).map((check) => checkHashes[check.name]);
      const hashesToRecord = [...taskHashes, lintHash, ...blockingCheckHashes].filter(Boolean);
      return writeFileSync(MANIFEST, mergeManifest(previous, [...new Set(hashesToRecord)]));
    }
    default:
      throw new Error('usage: validated.mjs plan|merge|all');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
