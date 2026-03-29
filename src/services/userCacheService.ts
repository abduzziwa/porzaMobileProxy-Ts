import pkg from "pg";
import type { UserCacheRow } from "../types.js";

const { Pool } = pkg;

const pool = new pkg.Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DB,
  port: Number(process.env.PG_PORT || 5432),
});

interface SaveUserCacheParams {
  cartId: string;
  uniqueDeviceId: string;
  phpsessid: string;
  username: string;
  passwordHash: string;
}

export async function saveUserCache({
  cartId,
  uniqueDeviceId,
  phpsessid,
  username,
  passwordHash,
}: SaveUserCacheParams): Promise<void> {
  const data = JSON.stringify({ phpsessid, username, passwordHash });

  await pool.query(
    `INSERT INTO user_cache (cartid, uniquedeviceid, data, loggenin, createdat)
     VALUES ($1, $2, $3::json, 1, NOW())
     ON CONFLICT (uniquedeviceid)
     DO UPDATE SET
       cartid       = EXCLUDED.cartid,
       data         = EXCLUDED.data,
       loggenin     = 1,
       createdat    = NOW()`,
    [cartId, uniqueDeviceId, data]
  );
  console.log("Insert Called.");
}

export async function markUserLoggedOut(cartId: string): Promise<void> {
  await pool.query(`UPDATE user_cache SET loggenin = 0 WHERE cartid = $1`, [
    cartId,
  ]);
  console.log("markUserLoggedOut Called");
}

export async function getUserCache(
  uniqueDeviceId: string
): Promise<UserCacheRow | null> {
  const result = await pool.query<UserCacheRow>(
    `SELECT * FROM user_cache WHERE uniquedeviceid = $1 LIMIT 1`,
    [uniqueDeviceId]
  );
  return result.rows[0] || null;
}

export async function updateSessionInCache(
  uniqueDeviceId: string,
  newPhpsessid: string
): Promise<void> {
  const result = await pool.query<{ data: Record<string, unknown> }>(
    `SELECT data FROM user_cache WHERE uniquedeviceid = $1`,
    [uniqueDeviceId]
  );
  if (!result.rows[0]) return;

  const existing = result.rows[0].data;
  const updated = JSON.stringify({ ...existing, phpsessid: newPhpsessid });

  await pool.query(
    `UPDATE user_cache SET data = $1::json, loggenin = 1, createdat = NOW()
     WHERE uniquedeviceid = $2`,
    [updated, uniqueDeviceId]
  );
}
