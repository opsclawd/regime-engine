import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // schema is only needed for `drizzle-kit generate` and `drizzle-kit push`, not for `migrate`.
  // `drizzle-kit migrate` (used in Railway preDeployCommand) only reads out/, dialect, dbCredentials, and migrations.
  schema: "./src/ledger/pg/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false }
  },
  migrations: {
    schema: "regime_engine",
    table: "regime_engine_migrations"
  }
});
