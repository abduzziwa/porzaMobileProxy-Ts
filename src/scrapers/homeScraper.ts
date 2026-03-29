import puppeteer, {
  type Browser,
  type Page,
  type BrowserContext,
} from "puppeteer";
import pkg from "pg";
import dotenv from "dotenv";
import PQueue from "p-queue";
import fetch, { type RequestInit as NodeFetchRequestInit } from "node-fetch";
import axios from "axios";
import qs from "qs";

dotenv.config();
const { Client } = pkg;

// ────────────────────────────────────────────────────────────
// 1. Setup Postgres
// ────────────────────────────────────────────────────────────
const pgClient = new Client({
  host: process.env.PG_HOST || "localhost",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "password",
  database: process.env.PG_DB || "porza_mobile",
  port: Number(process.env.PG_PORT || 5432),
});
await pgClient.connect();

// ────────────────────────────────────────────────────────────
// 2. Browser management with restart capability
// ────────────────────────────────────────────────────────────
let browser: Browser | null = null;
let browserInitializing = false;

const BROWSER_ARGS: string[] = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-component-extensions-with-background-pages",
  "--disable-features=TranslateUI,BlinkGenPropertyTrees",
  "--disable-ipc-flooding-protection",
  "--disable-renderer-backgrounding",
  "--enable-features=NetworkService,NetworkServiceInProcess",
  "--force-color-profile=srgb",
  "--hide-scrollbars",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-first-run",
  "--disable-default-apps",
  "--disable-sync",
  "--js-flags=--max-old-space-size=512",
];

async function launchBrowser(): Promise<Browser> {
  console.log("[BROWSER] Launching new browser instance...");
  return await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
}

async function initializeBrowser(): Promise<Browser> {
  if (browserInitializing) {
    console.log("[BROWSER] Already initializing, waiting...");
    while (browserInitializing) {
      await new Promise((res) => setTimeout(res, 500));
    }
    return browser!;
  }

  browserInitializing = true;

  try {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.log(
          "[BROWSER] Error closing old browser:",
          (e as Error).message,
        );
      }
    }

    browser = await launchBrowser();
    console.log("[BROWSER] Browser launched successfully");

    browser.on("disconnected", async () => {
      console.error(
        "[BROWSER] Disconnected! Will reinitialize on next request.",
      );
      browserHealthy = false;
      browser = null;
      for (let i = 0; i < tabPool.length; i++) {
        tabPool[i] = null;
      }
    });

    return browser;
  } finally {
    browserInitializing = false;
  }
}

browser = await initializeBrowser();

// ────────────────────────────────────────────────────────────
// 3. Enhanced tab pool with auto-recovery
// ────────────────────────────────────────────────────────────
interface TabEntry {
  page: Page;
  context: BrowserContext;
  busy: boolean;
  lastUsed: number;
  createdAt: number;
  tabId: number;
  requestCount: number;
  errorCount: number;
}

const MAX_TABS = Number(process.env.MAX_TABS || 3);
const TAB_MAX_AGE_MS = 15 * 60 * 1000;
const TAB_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const MAX_REQUESTS_PER_TAB = 50;

const tabPool: (TabEntry | null)[] = [];
let nextTabId = 1;
let browserHealthy = true;

const tabStats = { created: 0, recreated: 0, errors: 0, totalRequests: 0 };

async function initTabPool(): Promise<void> {
  console.log("[TAB-POOL] Initializing tab pool...");
  if (!browser || !browser.isConnected()) await initializeBrowser();
  for (let i = 0; i < MAX_TABS; i++) await recreate(i);
  console.log(`[TAB-POOL] Initialized ${tabPool.length} tabs`);
  startHealthMonitoring();
}

async function recreate(i: number): Promise<TabEntry> {
  const startTime = Date.now();
  const existing = tabPool[i];

  if (existing) {
    try {
      if (existing.page && !existing.page.isClosed())
        await existing.page.close().catch(() => {});
    } catch {}
    try {
      if (existing.context) await existing.context.close().catch(() => {});
    } catch {}
  }

  if (!browser || !browser.isConnected()) {
    console.log(`[TAB-POOL] Browser not connected, reinitializing...`);
    await initializeBrowser();
    browserHealthy = true;
  }

  try {
    const context = await browser!.createBrowserContext();
    const page = await context.newPage();
    const tabId = nextTabId++;

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.setViewport({ width: 1024, height: 768 });
    await page.evaluateOnNewDocument(() => {
      console.log = () => {};
      console.warn = () => {};
      console.error = () => {};
    });

    attachLifecycle(i, page, context, tabId);

    tabPool[i] = {
      page,
      context,
      busy: false,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      tabId,
      requestCount: 0,
      errorCount: 0,
    };

    const isRecreate = !!existing;
    if (isRecreate) tabStats.recreated++;
    else tabStats.created++;
    console.log(
      `[TAB-POOL][tab:${tabId}] ${isRecreate ? "Recreated" : "Created"} slot ${i} in ${Date.now() - startTime}ms`,
    );
    return tabPool[i]!;
  } catch (e) {
    console.error(
      `[TAB-POOL] Failed to create tab slot ${i}: ${(e as Error).message}`,
    );
    tabStats.errors++;
    tabPool[i] = null;
    throw e;
  }
}

function attachLifecycle(
  i: number,
  page: Page,
  context: BrowserContext,
  tabId: number,
): void {
  page.on("close", async () => {
    console.warn(`[TAB-POOL][tab:${tabId}] Page closed unexpectedly`);
    try {
      await recreate(i);
    } catch (e) {
      console.error(
        `[TAB-POOL] Auto-recreate failed for slot ${i}: ${(e as Error).message}`,
      );
      tabPool[i] = null;
    }
  });

  page.on("error", (err) => {
    console.error(`[TAB-POOL][tab:${tabId}] Page error: ${err.message}`);
    tabStats.errors++;
    if (tabPool[i]) tabPool[i]!.errorCount++;
  });

  page.on("pageerror", (err) => {
    console.error(`[TAB-POOL][tab:${tabId}] Page script error: ${err.message}`);
  });
}

async function ensureHealthy(i: number): Promise<TabEntry> {
  const t = tabPool[i];
  if (!t || !t.page || !t.context) {
    console.warn(`[TAB-POOL] Slot ${i} missing components, recreating...`);
    return await recreate(i);
  }
  if (t.page.isClosed()) {
    console.warn(`[TAB-POOL] Slot ${i} page closed, recreating...`);
    return await recreate(i);
  }

  const age = Date.now() - t.createdAt;
  if (age > TAB_MAX_AGE_MS) {
    console.log(`[TAB-POOL] Slot ${i} exceeded max age, recreating...`);
    return await recreate(i);
  }
  if (t.requestCount >= MAX_REQUESTS_PER_TAB) {
    console.log(`[TAB-POOL] Slot ${i} exceeded max requests, recreating...`);
    return await recreate(i);
  }
  if (t.errorCount > 5) {
    console.warn(`[TAB-POOL] Slot ${i} has too many errors, recreating...`);
    return await recreate(i);
  }

  try {
    const client = await t.page.target().createCDPSession();
    await client.send("Runtime.evaluate", { expression: "1+1" });
    await client.detach();
    return t;
  } catch (e) {
    console.warn(
      `[TAB-POOL] Slot ${i} failed CDP health check: ${(e as Error).message}, recreating...`,
    );
    return await recreate(i);
  }
}

export async function acquireTab(timeoutMs = 30000): Promise<TabEntry> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (!browser || !browser.isConnected()) {
      console.error("[TAB-POOL] Browser disconnected, reinitializing...");
      try {
        await initializeBrowser();
        browserHealthy = true;
        for (let i = 0; i < MAX_TABS; i++) await recreate(i);
      } catch (e) {
        console.error(
          `[TAB-POOL] Failed to reinitialize browser: ${(e as Error).message}`,
        );
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
    }

    if (!browserHealthy) {
      await new Promise((res) => setTimeout(res, 1000));
      continue;
    }

    const i = tabPool.findIndex((t) => t && !t.busy);
    if (i >= 0) {
      try {
        const healthy = await ensureHealthy(i);
        if (healthy) {
          healthy.busy = true;
          healthy.lastUsed = Date.now();
          healthy.requestCount++;
          tabStats.totalRequests++;
          return healthy;
        }
      } catch (e) {
        console.error(
          `[TAB-POOL] Error acquiring slot ${i}: ${(e as Error).message}`,
        );
        tabPool[i] = null;
      }
    }

    await new Promise((res) => setTimeout(res, 100));
  }

  throw new Error(`Failed to acquire tab within ${timeoutMs}ms`);
}

export async function releaseTab(tab: TabEntry): Promise<void> {
  if (!tab) return;
  const idx = tabPool.indexOf(tab);
  if (idx === -1) {
    console.warn("[TAB-POOL] Attempted to release unknown tab");
    return;
  }

  try {
    await resetEnvironment(tab.page);
  } catch (e) {
    console.warn(
      `[TAB-POOL] Reset failed for slot ${idx}: ${(e as Error).message}`,
    );
    tab.errorCount++;
    try {
      await recreate(idx);
    } catch (recreateErr) {
      console.error(
        `[TAB-POOL] Recreate failed for slot ${idx}: ${(recreateErr as Error).message}`,
      );
      tabPool[idx] = null;
    }
  }

  const current = tabPool[idx];
  if (current) {
    current.busy = false;
    current.lastUsed = Date.now();
  }
}

async function resetEnvironment(page: Page): Promise<void> {
  if (!page || page.isClosed()) throw new Error("Page is closed");

  try {
    const client = await page.target().createCDPSession();

    await Promise.all([
      client.send("Network.clearBrowserCookies").catch(() => {}),
      client.send("Network.clearBrowserCache").catch(() => {}),
    ]);

    const origins = new Set(["about:blank"]);
    try {
      const url = page.url();
      if (url && url !== "about:blank") origins.add(new URL(url).origin);
    } catch {}

    for (const frame of page.mainFrame().childFrames()) {
      try {
        const frameUrl = frame.url();
        if (frameUrl && frameUrl !== "about:blank")
          origins.add(new URL(frameUrl).origin);
      } catch {}
    }

    for (const origin of origins) {
      await client
        .send("Storage.clearDataForOrigin", { origin, storageTypes: "all" })
        .catch(() => {});
    }

    await page
      .goto("about:blank", { waitUntil: "domcontentloaded", timeout: 5000 })
      .catch(() => {});
    await client.detach();
  } catch (e) {
    throw new Error(`Reset environment failed: ${(e as Error).message}`);
  }
}

function startHealthMonitoring(): void {
  setInterval(async () => {
    console.log("[HEALTH] Running periodic health check...");

    if (!browser || !browser.isConnected()) {
      console.error(
        "[HEALTH] Browser not connected, will recover on next request",
      );
      browserHealthy = false;
      return;
    }

    for (let i = 0; i < tabPool.length; i++) {
      const tab = tabPool[i];
      if (!tab) {
        try {
          await recreate(i);
        } catch (e) {
          console.error(
            `[HEALTH] Failed to recreate slot ${i}: ${(e as Error).message}`,
          );
        }
        continue;
      }
      if (tab.busy) continue;

      const age = Date.now() - tab.createdAt;
      const idle = Date.now() - tab.lastUsed;

      if (age > TAB_MAX_AGE_MS || idle > TAB_IDLE_TIMEOUT_MS) {
        try {
          await recreate(i);
        } catch (e) {
          console.error(
            `[HEALTH] Failed to recycle slot ${i}: ${(e as Error).message}`,
          );
          tabPool[i] = null;
        }
      }
    }

    console.log(
      `[HEALTH] Stats: Created=${tabStats.created}, Recreated=${tabStats.recreated}, Errors=${tabStats.errors}, Requests=${tabStats.totalRequests}`,
    );
  }, HEALTH_CHECK_INTERVAL_MS);
}

// ────────────────────────────────────────────────────────────
// 4. Concurrency control
// ────────────────────────────────────────────────────────────
export const queue: PQueue = new PQueue({
  concurrency: MAX_TABS,
  timeout: 60000,
});

queue.on("active", () => {
  if (queue.size > MAX_TABS * 3)
    console.warn(`[QUEUE] High backlog detected: ${queue.size} pending tasks`);
});
queue.on("error", (error: Error) => {
  console.error(`[QUEUE] Task error: ${error.message}`);
});

// ────────────────────────────────────────────────────────────
// 5. Helper functions
// ────────────────────────────────────────────────────────────
function parseCookieString(
  cookieString: string,
  url: string,
): { name: string; value: string; domain: string }[] {
  if (!cookieString) return [];
  const domain = new URL(url).hostname;
  return cookieString
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIdx = pair.indexOf("=");
      const name = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
      const value = eqIdx >= 0 ? pair.slice(eqIdx + 1) : "";
      return { name, value, domain };
    });
}

async function waitForWindowVariable(
  page: Page,
  variableName: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const exists = await Promise.race([
        page.evaluate((v: string) => {
          try {
            return !!(globalThis as Record<string, unknown>)[v];
          } catch {
            return false;
          }
        }, variableName),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Evaluation timeout")), 2000),
        ),
      ]);

      if (exists) {
        console.log(
          `[VARIABLE-WAIT] Found "${variableName}" after ${Date.now() - start}ms`,
        );
        return true;
      }
    } catch (err) {
      lastError = err as Error;
      if ((err as Error).message.includes("Execution context was destroyed")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    `Variable "${variableName}" did not appear within ${timeoutMs}ms. Last error: ${lastError?.message || "none"}`,
  );
}

// ────────────────────────────────────────────────────────────
// 6. Main extractor function
// ────────────────────────────────────────────────────────────
export async function getVariable(
  url: string,
  cartId: string,
  cookie: string,
  referer: string,
  variableName: string,
  useLegacyWait = false,
  waitForVariableMs: number | null = null,
  retries = 2,
): Promise<unknown> {
  return queue.add(async () => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let tab: TabEntry | null = null;

      try {
        tab = await acquireTab();
        const page = tab.page;

        const cookies = parseCookieString(cookie, url);
        if (cookies.length > 0) await page.setCookie(...cookies);

        const headers: Record<string, string> = { Referer: referer || "" };
        if (process.env.AUTH_CREDENTIALS) {
          headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;
        }
        await page.setExtraHTTPHeaders(headers);

        console.log(`[SCRAPER][${cartId}] Navigating to ${url}`);

        if (useLegacyWait) {
          await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        } else {
          await page.goto(url, {
            waitUntil: ["domcontentloaded", "networkidle0"],
            timeout: 30000,
          });
        }

        const stabilizationDelay = useLegacyWait ? 500 : 1500;
        console.log(
          `[SCRAPER][${cartId}] Waiting ${stabilizationDelay}ms for page to stabilize`,
        );
        await new Promise((resolve) => setTimeout(resolve, stabilizationDelay));

        console.log(
          `[SCRAPER][${cartId}] Page stabilized, extracting variable "${variableName}"`,
        );

        if (typeof waitForVariableMs === "number" && waitForVariableMs > 0) {
          await waitForWindowVariable(page, variableName, waitForVariableMs);
        }

        let value: unknown = null;
        let extractAttempts = 0;
        const maxExtractAttempts = 3;

        while (extractAttempts < maxExtractAttempts) {
          try {
            value = await page.evaluate((v: string) => {
              try {
                return (globalThis as Record<string, unknown>)[v] ?? null;
              } catch {
                return null;
              }
            }, variableName);
            break;
          } catch (err) {
            extractAttempts++;
            if (
              (err as Error).message.includes("Execution context was destroyed")
            ) {
              console.log(
                `[SCRAPER][${cartId}] Context destroyed during extraction, attempt ${extractAttempts}/${maxExtractAttempts}`,
              );
              if (extractAttempts < maxExtractAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                continue;
              }
            }
            throw err;
          }
        }

        if (value === null || value === undefined)
          throw new Error(`Variable "${variableName}" not found on page`);

        const serialized = JSON.stringify(value);
        await pgClient.query(
          `INSERT INTO request_logs (url, cat_id, variable_name, variable_value, response_snippet, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [url, cartId, variableName, serialized, serialized.slice(0, 2000)],
        );

        console.log(
          `[SCRAPER][${cartId}] Successfully extracted "${variableName}"`,
        );
        return value;
      } catch (err) {
        lastError = err as Error;
        console.error(
          `[ERROR][${cartId}][attempt:${attempt + 1}/${retries + 1}] ${(err as Error).message}`,
        );

        if (tab) tab.errorCount++;

        if (
          (err as Error).message.includes("Execution context was destroyed") &&
          attempt < retries
        ) {
          const backoffTime = 5000 * (attempt + 1);
          await new Promise((res) => setTimeout(res, backoffTime));
        } else if (attempt < retries) {
          await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
        }
      } finally {
        if (tab) await releaseTab(tab);
      }
    }

    throw lastError;
  });
}

// ────────────────────────────────────────────────────────────
// 7. API Functions
// ────────────────────────────────────────────────────────────
export async function getCheckoutData(
  cartId: string,
  phpsessid: string,
): Promise<unknown> {
  try {
    const url = `${process.env.END_POINT}/mijn-wagen/step3`;
    const headers: Record<string, string> = {
      Authorization: "Basic cG9yemE6cG9yemE=",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
      Cookie: `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`,
    };

    const response = await axios.get(url, {
      headers,
      maxRedirects: 5,
      validateStatus: () => true,
      timeout: 15000,
    });
    const html: string = response.data as string;
    const match = html.match(
      /window\.checkout\s*=\s*JSON\.parse\(\s*'([^']+)'/,
    );
    if (!match) throw new Error("checkout JSON not found in response");

    const checkout: unknown = JSON.parse(match[1]);
    const serialized = JSON.stringify(checkout);
    await pgClient.query(
      `INSERT INTO request_logs (url, cat_id, variable_name, variable_value, response_snippet, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [url, cartId, "checkout", serialized, serialized.slice(0, 2000)],
    );

    return checkout;
  } catch (err) {
    console.error("Checkout extraction failed:", (err as Error).message);
    throw err;
  }
}

export async function getApi(
  url: string,
  cartId: string,
  uniqueDeviceId: string,
  cookie: string,
  resource: string,
): Promise<unknown> {
  try {
    if (!cartId) throw new Error("Missing cartId");
    if (!uniqueDeviceId) throw new Error("Missing uniqueDeviceId");
    if (!resource) resource = "Default";

    const headers: Record<string, string> = { Cookie: cookie || "" };
    if (process.env.AUTH_CREDENTIALS)
      headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;

    const finalUrl = url.endsWith("/") ? url + resource : `${url}/${resource}`;
    console.log("URL: " + finalUrl);

    const response = await fetch(finalUrl, { headers } as NodeFetchRequestInit);
    if (!response.ok)
      throw new Error(`Request failed with status ${response.status}`);

    let data: unknown;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
      try {
        data = JSON.parse(data as string);
      } catch {}
    }

    const serialized = JSON.stringify(data);
    await pgClient.query(
      `INSERT INTO request_logs (url, cat_id, variable_name, variable_value, response_snippet, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [url, cartId, resource, serialized, serialized.slice(0, 2000)],
    );

    return data;
  } catch (err) {
    console.error(`[API-ERROR][${cartId}] ${(err as Error).message}`);
    throw err;
  }
}

export async function getApiWithParams(
  url: string,
  cartId: string,
  uniqueDeviceId: string,
  cookie: string,
  resource: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    if (!cartId) throw new Error("Missing cartId");
    if (!uniqueDeviceId) throw new Error("Missing uniqueDeviceId");
    if (typeof resource !== "object" || resource === null)
      throw new Error("Resource must be an object");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Cookie: cookie || "",
    };
    if (process.env.AUTH_CREDENTIALS)
      headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;

    console.log("Request Body:", resource);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(resource),
    } as NodeFetchRequestInit);
    if (!response.ok)
      throw new Error(`Request failed with status ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const responseData = await response.json();
      console.log("Response Data:", responseData);
      return responseData;
    }
    return await response.text();
  } catch (error) {
    console.error("getApiWithParams error:", error);
    throw error;
  }
}

export async function getApiWithParamsLogin(
  url: string,
  cartId: string,
  uniqueDeviceId: string,
  cookie: string,
  resource: Record<string, string> = {},
): Promise<unknown> {
  try {
    if (!cartId) throw new Error("Missing cartId");
    if (!uniqueDeviceId) throw new Error("Missing uniqueDeviceId");

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookie || "",
    };
    if (process.env.AUTH_CREDENTIALS)
      headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;

    const body = qs.stringify(resource);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    } as NodeFetchRequestInit);

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return await response.json();
    return await response.text();
  } catch (error) {
    console.error("getApiWithParamsLogin error:", error);
    throw error;
  }
}

export async function carSearchBy(
  url: string,
  cartId: string,
  uniqueDeviceId: string,
  cookie: string,
  licencePlate: string,
): Promise<Record<string, unknown>> {
  try {
    if (!cartId) throw new Error("Missing cartId");
    if (!uniqueDeviceId) throw new Error("Missing uniqueDeviceId");
    if (!licencePlate) throw new Error("Missing licencePlate");

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookie || "",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (process.env.AUTH_CREDENTIALS)
      headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;

    const finalUrl = `${url}/api/mod/ecommerce/cars/findCarByPlateOrVin`;
    const body = new URLSearchParams({
      searchType: "licenceplate",
      searchBy: licencePlate,
    }).toString();

    const response = await fetch(finalUrl, {
      method: "POST",
      headers,
      body,
    } as NodeFetchRequestInit);
    const clone = response.clone();
    const rawText = await clone.text();
    const parsedResponse = (await response.json()) as Record<string, unknown>;

    parsedResponse.uniqueDeviceId = uniqueDeviceId;

    await pgClient.query(
      `INSERT INTO request_logs (url, cat_id, variable_name, variable_value, response_snippet, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        url,
        cartId,
        "licencePlate",
        JSON.stringify(parsedResponse),
        rawText.slice(0, 2000),
      ],
    );

    if (!response.ok)
      throw new Error(`Request failed with status ${response.status}`);

    return parsedResponse;
  } catch (err) {
    console.error(`[API-ERROR][${cartId}] ${(err as Error).message}`);
    throw err;
  }
}

export async function postApi(
  url: string,
  cartId: string,
  phpsessid: string,
  data: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    if (!cartId) throw new Error("Missing cartId");
    if (!phpsessid) throw new Error("Missing phpSessionId");
    if (!url) throw new Error("Missing URL");

    const authHeader = process.env.AUTH_CREDENTIALS
      ? `Basic ${process.env.AUTH_CREDENTIALS}`
      : "";
    const cookieHeader = `PHPSESSID=${phpsessid}; cartId=${cartId}; eucookie=1`;

    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authHeader, Cookie: cookieHeader },
      body: JSON.stringify(data),
    } as NodeFetchRequestInit);

    if (!response.ok)
      throw new Error(`Request failed with status ${response.status}`);

    const contentType = response.headers.get("content-type") || "";
    let responseData: unknown;
    if (contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
      try {
        responseData = JSON.parse(responseData as string);
      } catch {}
    }

    const serialized = JSON.stringify(responseData);
    await pgClient.query(
      `INSERT INTO request_logs (url, cat_id, variable_name, variable_value, response_snippet, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [url, cartId, "POST_DATA", serialized, serialized.slice(0, 2000)],
    );

    return responseData;
  } catch (err) {
    console.error(`[POST-API-ERROR][${cartId}] ${(err as Error).message}`);
    throw err;
  }
}

export async function getApiWithParamsLoginForm(
  url: string,
  cartId: string,
  phpsessid: string,
  resource: Record<string, unknown> = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Cookie: `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`,
  };
  if (process.env.AUTH_CREDENTIALS)
    headers["Authorization"] = `Basic ${process.env.AUTH_CREDENTIALS}`;

  const body = qs.stringify(resource);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  } as NodeFetchRequestInit);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface PostOrderFinishedParams {
  url: string;
  cartId: string;
  phpsessid: string;
  authCredentials: string;
  bodyParams: Record<string, string>;
}

export async function postOrderFinished({
  url,
  cartId,
  phpsessid,
  authCredentials,
  bodyParams,
}: PostOrderFinishedParams): Promise<string> {
  const body = new URLSearchParams(bodyParams).toString();
  const host = new URL(url).host;

  const headers: Record<string, string> = {
    Authorization: `Basic ${authCredentials}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Origin: `https://${host}`,
    Referer: `https://${host}/mijn-wagen/step3`,
    "User-Agent": "Mozilla/5.0",
    Cookie: `cartId=${cartId}; eucookie=1; PHPSESSID=${phpsessid}`,
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  } as NodeFetchRequestInit);
  return response.text();
}

// ────────────────────────────────────────────────────────────
// 8. Initialize
// ────────────────────────────────────────────────────────────
await initTabPool();

// ────────────────────────────────────────────────────────────
// 9. Graceful shutdown
// ────────────────────────────────────────────────────────────
async function shutdown(): Promise<void> {
  console.log("Shutting down gracefully...");
  queue.pause();

  const waitStart = Date.now();
  while (queue.pending > 0 && Date.now() - waitStart < 10000) {
    await new Promise((res) => setTimeout(res, 500));
  }

  try {
    for (const item of tabPool) {
      if (item) {
        try {
          if (item.page && !item.page.isClosed()) await item.page.close();
        } catch {}
        try {
          if (item.context) await item.context.close();
        } catch {}
      }
    }
    if (browser) await browser.close();
    await pgClient.end();
    console.log("Shutdown complete");
  } catch (e) {
    console.error(`Shutdown error: ${(e as Error).message}`);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  void shutdown();
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
