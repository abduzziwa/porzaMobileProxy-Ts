import cron from "node-cron";
import {
  fetchCategoriesByParent,
  isCorenioNoResultsError,
  isCorenioRateLimitError,
} from "../services/v3CoreniService.js";
import { refreshFiltersCache } from "../controllers/v3ProductsController.js";

const LANGUAGES = ["en", "nl", "de"];
const ROOT_PARENT_ID = 0;

// Conservative pacing — Corenio's burst limiter was confirmed live to trip
// around ~20 req/sec; this runs at ~2 req/sec, leaving generous headroom for
// real user traffic sharing the same API key/account.
const REQUEST_DELAY_MS = 500;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Transient network-level failures — confirmed live during the first real
// run of this job (several "socket hang up" errors across a few thousand
// sequential calls). Exactly as recoverable-on-retry as a 429; a job making
// this many calls over many minutes will hit some of these by chance, and
// treating them as permanent failures loses real, cacheable data for no
// reason. Matches by both Node's error `code` and the message text, since
// not every transient network error reliably carries the former.
function isTransientNetworkError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNABORTED" || code === "EAI_AGAIN") return true;
  const message = (err as Error | undefined)?.message ?? "";
  return message.includes("socket hang up") || message.includes("timeout");
}

// Wraps any single Corenio-calling call with automatic backoff-and-retry on
// anything recoverable (rate limiting or a transient network blip) — shared
// by the category-tree walk and the filter refresh itself, since both can
// hit either. Returns null (not a thrown error) for "genuinely nothing
// here" (404/no-results, or exhausted retries) so callers can just skip and
// move on rather than crash the whole run.
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  let backoff = INITIAL_BACKOFF_MS;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isCorenioNoResultsError(err)) return null;
      if (isCorenioRateLimitError(err) || isTransientNetworkError(err)) {
        const reason = isCorenioRateLimitError(err) ? "429" : "network blip";
        console.warn(`[FiltersWarmup] ${reason} on ${label} — backing off ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }
      console.error(`[FiltersWarmup] Failed ${label}:`, (err as Error).message);
      return null;
    }
  }
  console.error(`[FiltersWarmup] Gave up on ${label} after ${MAX_RETRIES} retries (still rate-limited)`);
  return null;
}

interface CategoryNode {
  id: number;
  name: string;
}

// Walks the entire category tree from the root, depth-first. A 404 from
// Corenio means "this category has no children" (same convention as every
// other Corenio "no results" case in this app) — not a failure, just a leaf.
async function walkCategoryTree(): Promise<CategoryNode[]> {
  const all: CategoryNode[] = [];
  const visited = new Set<number>();

  async function walk(parentId: number): Promise<void> {
    if (visited.has(parentId)) return;
    visited.add(parentId);

    const children = await withRetry(
      () => fetchCategoriesByParent(parentId, "en"),
      `categories/byParent(${parentId})`
    );
    if (!children) return;

    for (const c of children) {
      all.push({ id: c.id, name: c.name });
      await sleep(REQUEST_DELAY_MS);
      await walk(c.id);
    }
  }

  await walk(ROOT_PARENT_ID);
  return all;
}

// The full pre-warm: every category, in every supported app language.
// Idempotent and safe to re-run any time (it's the same cache-write path a
// live request uses) — a crash partway through just leaves the rest of the
// catalog to warm normally via real traffic, or fully on the next scheduled
// run. No resumability bookkeeping needed for that reason.
export async function warmAllFilters(): Promise<void> {
  const startedAt = Date.now();
  console.log("[FiltersWarmup] Starting: walking full category tree...");
  const categories = await walkCategoryTree();
  console.log(`[FiltersWarmup] Category tree walked: ${categories.length} categories found.`);

  const totalJobs = categories.length * LANGUAGES.length;
  let done = 0;
  let failed = 0;

  for (const category of categories) {
    for (const language of LANGUAGES) {
      const result = await withRetry(
        () => refreshFiltersCache({ category_ids: [category.id] }, language),
        `filters(category=${category.id} "${category.name}", lang=${language})`
      );
      done++;
      if (result === null) failed++;
      if (done % 50 === 0 || done === totalJobs) {
        console.log(`[FiltersWarmup] Progress: ${done}/${totalJobs} (${failed} empty/failed so far)`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`[FiltersWarmup] Done in ${minutes} min — ${done - failed}/${totalJobs} filter sets cached, ${failed} empty/failed.`);
}

// Runs every 12 hours — matches FILTERS_CACHE_TTL_MS in v3ProductsController
// exactly, so a real request never has to wait on a cold cache: entries are
// refreshed before they'd otherwise expire. A fixed low-traffic-friendly
// schedule (03:00/15:00 server time) rather than a real-time "idle
// detector" — simpler, and this app has no request-volume tracking to hook
// into for one; revisit if traffic patterns make that worth building later.
export function scheduleFiltersWarmup(): void {
  cron.schedule("0 3,15 * * *", () => {
    console.log("[FiltersWarmup] Scheduled 12-hourly refresh starting...");
    warmAllFilters().catch((err) => console.error("[FiltersWarmup] Scheduled run failed:", err instanceof Error ? err.message : String(err)));
  });
  console.log("[FiltersWarmup] Refresh scheduled for 03:00 and 15:00 server time (every 12h).");
}
