import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm/sql";

export function createDb(connectionString: string): {
  db: ReturnType<typeof drizzle>;
  client: ReturnType<typeof postgres>;
} {
  const parsed = parseInt(process.env.PG_MAX_CONNECTIONS ?? "", 10);
  const max = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  const ssl = process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false };

  const client = postgres(connectionString, {
    connection: {
      search_path: "regime_engine"
    },
    ssl,
    idle_timeout: 30,
    max_lifetime: 1800,
    connect_timeout: 10,
    max
  });

  const db = drizzle(client);

  return { db, client };
}

export const verifyPgConnection = async (db: Db): Promise<void> => {
  await db.execute(sql`SELECT 1`);
};

export const verifyPgSchema = async (db: Db): Promise<void> => {
  const result = await db.execute(
    sql`SELECT nspname FROM pg_namespace WHERE nspname = 'regime_engine'`
  );
  if (result.length === 0) {
    throw new Error("FATAL: regime_engine schema not found in Postgres");
  }
};

export type Db = ReturnType<typeof createDb>["db"];