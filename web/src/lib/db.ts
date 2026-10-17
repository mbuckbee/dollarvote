import { Pool, types } from "pg";

// Return DATE columns as plain "YYYY-MM-DD" strings instead of local-midnight Date objects.
types.setTypeParser(types.builtins.DATE, (value) => value);
// count(*) and sum() come back as bigint/numeric strings; every count here fits in a JS number.
types.setTypeParser(types.builtins.INT8, Number);
types.setTypeParser(types.builtins.NUMERIC, Number);

const globalForPool = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPool.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost/dollarvote",
    ssl: process.env.DATABASE_URL?.includes("amazonaws.com") ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForPool.pool = pool;

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}
