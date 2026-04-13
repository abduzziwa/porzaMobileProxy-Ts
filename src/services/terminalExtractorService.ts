import puppeteer from "puppeteer";
import { Redis } from "ioredis";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Client } = pkg;

const pgClient = new Client({
  host: process.env.PG_HOST || "localhost",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "password",
  database: process.env.PG_DB || "porza_mobile",
  port: Number(process.env.PG_PORT || 5432),
});
await pgClient.connect();

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
});

export async function getVariable(
  url: string,
  cartId: string,
  cookie: string,
  referer: string,
  variableName: string
): Promise<unknown> {
  const cacheKey = `terminal:${cartId}:${variableName}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as unknown;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  const cookieArray = cookie.split(";").map((c) => {
    const [name, value] = c.trim().split("=");
    return { name, value, domain: new URL(url).hostname };
  });
  await page.setCookie(...cookieArray);

  await page.setExtraHTTPHeaders({
    Referer: referer,
    Authorization: `Basic ${process.env.AUTH_CREDENTIALS}`,
  });

  await page.goto(url, { waitUntil: "networkidle2" });

  const value = await page.evaluate((v: string) => {
    return (globalThis as Record<string, unknown>)[v] || null;
  }, variableName);

  await browser.close();

  if (!value) throw new Error(`Variable "${variableName}" not found on page`);

  await pgClient.query(
    "INSERT INTO request_logs (url, cart_id, variable_name, variable_value, response_snippet) VALUES ($1, $2, $3, $4, $5)",
    [url, cartId, variableName, JSON.stringify(value), JSON.stringify(value).slice(0, 2000)]
  );

  await redis.setex(cacheKey, 3600, JSON.stringify(value));

  return value;
}
