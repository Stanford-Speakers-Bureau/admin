import { SeedPostgres } from "@snaplet/seed/adapter-postgres";
import { defineConfig } from "@snaplet/seed/config";
import postgres from "postgres";

export default defineConfig({
  adapter: () => {
    const client = postgres(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    return new SeedPostgres(client);
  },
  select: [
    "!auth.*",
    "!storage.*",
    "!realtime.*",
    "!extensions.*",
    "!supabase_functions.*",
    "!_realtime.*",
    "!supabase_migrations.*",
    "!pgsodium.*",
    "!pgsodium_masks.*",
    "!vault.*",
    "!net.*",
    "!_analytics.*",
  ],
});
