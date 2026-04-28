import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/ledger/pg/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false }
  }
});