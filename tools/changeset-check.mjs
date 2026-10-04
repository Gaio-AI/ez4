// A major is the one release consumers take by editing their range, so a major changeset has to say
// what they must change: a line starting with `Breaking:` in its summary (see RELEASING.md).
import { readdirSync, readFileSync } from 'node:fs';

const changesetDir = '.changeset';

const unannounced = readdirSync(changesetDir)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .filter((file) => {
    const [, frontmatter = '', ...summary] = readFileSync(`${changesetDir}/${file}`, 'utf8').split('---');
    return /:\s*['"]?major/.test(frontmatter) && !/^Breaking: \S/m.test(summary.join('---'));
  });

if (unannounced.length) {
  console.error(
    `A major changeset needs a "Breaking:" line saying what consumers must change (see RELEASING.md): ${unannounced.join(', ')}`
  );
  process.exit(1);
}
