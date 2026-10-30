// Creates the database the pgclient specs run against, when it is missing. They get one of their own because
// pgmigration's specs create tables of the same names (`table_a`, `table_b`) in `postgres`, and the suite can
// run both packages at once.
import pg from 'pg';

const DATABASE = 'pgclient_tests';

const client = new pg.Client({ database: 'postgres', password: 'postgres', user: 'postgres', host: '127.0.0.1' });

await client.connect();

try {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);

  if (!rowCount) {
    await client.query(`CREATE DATABASE "${DATABASE}"`);
  }
} catch (error) {
  // Another run created it between the check and the create.
  if (error.code !== '42P04') {
    throw error;
  }
} finally {
  await client.end();
}
