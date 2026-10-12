import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface QueryResult<T> {
  rows: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  readonly kind: 'pglite' | 'postgres';
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DbOptions {
  /** postgres://... — when set, a real PostgreSQL server is used. */
  url?: string;
  /** Directory for the embedded PGlite database; 'memory://' for an in-memory DB (tests). */
  dataDir?: string;
}

export async function createDb(opts: DbOptions): Promise<Db> {
  if (opts.url) return createPg(opts.url);
  return createPglite(opts.dataDir ?? './data/pglite');
}

async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir !== 'memory://') fs.mkdirSync(dataDir, { recursive: true });
  const pg = dataDir === 'memory://' ? await PGlite.create() : await PGlite.create(dataDir);
  const q = async <T>(sql: string, params: unknown[] = []) => {
    const r = await pg.query<T>(sql, params);
    return { rows: r.rows };
  };
  return {
    kind: 'pglite',
    query: q,
    exec: async (sql) => {
      await pg.exec(sql);
    },
    transaction: (fn) =>
      pg.transaction(async (tx) =>
        fn({
          query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query<T>(sql, params)).rows }),
        }),
      ),
    close: () => pg.close(),
  };
}

async function createPg(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const q = async <T>(sql: string, params: unknown[] = []) => {
    const r = await pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[] };
  };
  return {
    kind: 'postgres',
    query: q,
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn({ query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params as unknown[])).rows as T[] }) });
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function defaultMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MIGRATIONS_DIR, path.join(here, 'migrations'), path.join(here, '..', 'migrations')].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`Migrations directory not found (looked in ${candidates.join(', ')})`);
}

/** Apply pending *.sql migrations in filename order, each in its own transaction. */
export async function migrate(db: Db, dir = defaultMigrationsDir()): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    // exec() handles multi-statement SQL; wrap in a transaction for atomicity.
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (version) VALUES ('${f.replace(/'/g, "''")}');\nCOMMIT;`).catch(async (e) => {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    });
    applied.push(f);
  }
  return applied;
}
