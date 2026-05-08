import { Redis } from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  lazyConnect: true,
});

redis.on("connect", () => console.log("[v3Redis] Connected"));
redis.on("error", (err: Error) => console.error("[v3Redis] Error:", err.message));

export default redis;
