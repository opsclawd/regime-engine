import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createDb(connectionString: string): {
  db: ReturnType<typeof drizzle>;
  client: ReturnType<typeof postgres>;
} {
  const client = postgres(connectionString, {
    connection: {
      search_path: "regime_engine"
    }
  });

  const db = drizzle(client);

  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];