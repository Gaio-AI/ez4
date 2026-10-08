#!/usr/bin/env node
// Tags HEAD with one app's rendered tag template and publishes its GitHub Release from the changelog.
// Every step is skipped when its result already exists, so a re-run finishes a partial release.
//
//   release-tag.mjs <app-dir> [template]   writes tag=<tag>; template placeholders {package} {name} {version}
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function renderTag(template, pkg) {
  return template
    .replaceAll('{package}', pkg.name)
    .replaceAll('{name}', pkg.name.replace(/^@[^/]+\//, ''))
    .replaceAll('{version}', pkg.version);
}

/** The same format `changeset tag` writes. */
export const tagName = (pkg) => renderTag('{package}@{version}', pkg);

/** The body under `## <version>` up to the next `## `. */
export function notesFor(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.indexOf(`## ${version}`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const succeeds = (command, args) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};

function main([dir, template]) {
  if (!dir) throw new Error('usage: release-tag.mjs <app-dir> [template]');

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const tag = renderTag(template || '{package}@{version}', pkg);
  const ref = `refs/tags/${tag}`;

  const local = succeeds('git', ['rev-parse', '-q', '--verify', ref]);
  const remote = succeeds('git', ['ls-remote', '--exit-code', '--tags', 'origin', ref]);
  if (!local && !remote) {
    // Annotated tags need an identity, which a CI checkout lacks.
    run('git', [
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'tag',
      '-a',
      tag,
      '-m',
      tag
    ]);
  }
  if (local || !remote) run('git', ['push', 'origin', tag]);

  if (!succeeds('gh', ['release', 'view', tag])) {
    const changelog = join(dir, 'CHANGELOG.md');
    const notes = existsSync(changelog) ? notesFor(readFileSync(changelog, 'utf8'), pkg.version) : '';
    run('gh', ['release', 'create', tag, '--title', tag, '--notes', notes || 'No changelog entry.', '--verify-tag']);
  }

  output('tag', tag);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
