import cron from "node-cron";
import v3Pool from "../db/v3Client.js";

// Final step of account deletion (Apple App Store Guideline 5.1.1(v)):
// login was already blocked the moment deletion was requested (see the
// `deleted` check in authLogin/deviceCheck) — this is what actually removes
// the PII once the 30-day retention window has passed. Email must stay
// unique (v3_users has a UNIQUE constraint on it) so this can't just reuse
// one tombstone string across every purged account.
function tombstoneEmail(userId: number): string {
  return `deleted-user-${userId}@porza-deleted.invalid`;
}

export async function purgeExpiredDeletedAccounts(): Promise<void> {
  const due = await v3Pool.query<{ user_id: number }>(
    `SELECT user_id FROM v3_users
     WHERE deleted = TRUE AND deletion_purge_at <= NOW() AND deletion_purged_at IS NULL`
  );

  if (!due.rows.length) {
    console.log("[AccountPurge] No accounts due for purge.");
    return;
  }

  console.log(`[AccountPurge] ${due.rows.length} account(s) due for purge.`);

  for (const { user_id } of due.rows) {
    try {
      await v3Pool.query(
        `UPDATE v3_users
         SET email = $2, corenio_token = NULL, deletion_purged_at = NOW()
         WHERE user_id = $1`,
        [user_id, tombstoneEmail(user_id)]
      );
      console.log(`[AccountPurge] Purged user_id=${user_id}`);
    } catch (err) {
      console.error(`[AccountPurge] Failed to purge user_id=${user_id}:`, (err as Error).message);
    }
  }
}

// Runs daily at 04:00 server time — after the filters warmup's 03:00/15:00
// slots, so the two background jobs don't compete for DB/Corenio at once.
export function scheduleAccountPurge(): void {
  cron.schedule("0 4 * * *", () => {
    console.log("[AccountPurge] Scheduled daily purge starting...");
    purgeExpiredDeletedAccounts().catch((err) => console.error("[AccountPurge] Scheduled run failed:", err instanceof Error ? err.message : String(err)));
  });
  console.log("[AccountPurge] Daily purge scheduled for 04:00 server time.");
}
