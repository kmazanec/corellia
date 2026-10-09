/**
 * A throwaway Postgres schema per test suite. Every table the stores create
 * lands in it (through the pool's search_path), so suites running in
 * parallel never see — or truncate — each other's rows.
 */

import pg from 'pg';

export async function isolatedPool(url: string, label: string, max = 10): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const schema = `t_${label}_${process.pid}_${Date.now().toString(36)}`.replace(/[^a-z0-9_]/g, '_');
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: url, max, options: `-c search_path=${schema}` });
  return {
    pool,
    drop: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      await c.query(`DROP SCHEMA ${schema} CASCADE`);
      await c.end();
    },
  };
}
