import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const v3Pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "password",
  database: process.env.PG_DB || "porza_mobile",
  port: Number(process.env.PG_PORT || 5432),
});

// Tags every Postgres query in PM2 logs with [DATABASE], mirroring
// [CORENIO_API] (v3CoreniService.ts) and [CACHE] (v3CacheMiddleware.ts) —
// one central wrap here covers every v3Pool.query() call across the whole
// codebase, so you can see at a glance where a given response's data
// actually came from. Logs the query template only (with $1/$2 etc.),
// never the parameter values — those can carry passwords, tokens, emails,
// addresses.
const originalQuery = v3Pool.query.bind(v3Pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
v3Pool.query = ((...args: any[]) => {
  const first = args[0];
  const queryText = typeof first === "string" ? first : (first?.text as string) ?? "<unknown query>";
  const summary = queryText.trim().replace(/\s+/g, " ").slice(0, 100);
  console.log(`[DATABASE] -> ${summary}`);

  const start = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = (originalQuery as any)(...args);

  if (result && typeof result.then === "function") {
    return result.then(
      (res: { rowCount: number | null }) => {
        console.log(`[DATABASE] <- ${res.rowCount ?? 0} row(s) (${Date.now() - start}ms)`);
        return res;
      },
      (err: Error) => {
        console.log(`[DATABASE] <- ERROR (${Date.now() - start}ms): ${err.message}`);
        throw err;
      }
    );
  }
  return result;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export default v3Pool;
