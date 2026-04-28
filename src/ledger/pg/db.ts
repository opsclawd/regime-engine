import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm/sql";

export function createDb(connectionString: string): {
  db: ReturnType<typeof drizzle>;
  client: ReturnType<typeof postgres>;
} {
  const client = postgres(connectionString, {
    connection: {
      search_path: "regime_engine"
    },
    ssl: { rejectUnauthorized: false },
    idle_timeout: 30,
    max_lifetime: 1800,
    connect_timeout: 10,
    max: 10
  });

  const db = drizzle(client);

  return { db, client };
}

export const verifyPgConnection = async (db: ReturnType<typeof createDb>["db"]): Promise<void> => {
  await db.execute(sql`SELECT 1`);
};

export type Db = ReturnType<typeof createDb>["db"];