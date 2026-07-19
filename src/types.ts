import type { Request } from "express";

// ─── Express Request augmentation ───────────────────────────────────────────
declare module "express-serve-static-core" {
  interface Request {
    silentReAuthed?: boolean;
    // Set once per request by v3SessionMiddleware (piggybacked on the session
    // validation query — no extra DB round trip) when the caller has an
    // authorised session with a stored Corenio token. Undefined for guests
    // and for the handful of session-exempt v3 paths.
    corenioToken?: string | null;
  }
}

// ─── Session / Cache ─────────────────────────────────────────────────────────
export interface UserCacheData {
  phpsessid: string;
  username: string;
  passwordHash: string;
}

export interface UserCacheRow {
  cartid: string;
  uniquedeviceid: string;
  data: UserCacheData;
  loggenin: number;
  createdat: Date;
}

// ─── Tab pool ────────────────────────────────────────────────────────────────
export interface TabEntry {
  page: import("puppeteer").Page;
  context: import("puppeteer").BrowserContext;
  busy: boolean;
  lastUsed: number;
  createdAt: number;
  tabId: number;
  requestCount: number;
  errorCount: number;
}

export interface TabStats {
  created: number;
  recreated: number;
  errors: number;
  totalRequests: number;
}

// ─── Scraper responses ────────────────────────────────────────────────────────
export type ApiData = Record<string, unknown> | unknown[] | string;

// ─── Pending order store ─────────────────────────────────────────────────────
export interface PendingOrderEntry {
  email: string;
  billing: Record<string, unknown>;
}

// ─── Cart service ────────────────────────────────────────────────────────────
export interface CartItem {
  product_id: string;
  quantity: number;
  deleted?: boolean;
  deleted_at?: Date | null;
}
