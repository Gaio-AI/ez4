import { readdirSync, readFileSync } from 'node:fs';

const changesetDir = '.changeset';

const offending = readdirSync(changesetDir)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .filter((file) => {
    const [, frontmatter = ''] = readFileSync(`${changesetDir}/${file}`, 'utf8').split('---');
    return /:\s*['"]?(minor|major)/.test(frontmatter);
  });

if (offending.length) {
  console.error(`Only patch changesets are allowed, the minor follows upstream (see RELEASING.md): ${offending.join(', ')}`);
  process.exit(1);
}
