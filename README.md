# Porza Mobile Proxy — TypeScript

A fully typed TypeScript rewrite of the Porza Mobile App proxy backend. All runtime behaviour is preserved 1-to-1.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 20+ |
| npm | 9+ |
| PostgreSQL | 13+ |
| Redis | 6+ |

---

## Project structure

```
porzaMobileProxy-ts/
├── src/
│   ├── server.ts                   ← entry point
│   ├── types.ts                    ← shared interfaces
│   ├── routes/
│   │   └── homeRoutes.ts
│   ├── scrapers/
│   │   └── homeScraper.ts          ← Puppeteer tab pool + all API helpers
│   ├── services/
│   │   ├── API.ts                  ← Corenio REST client
│   │   ├── cartService.ts
│   │   ├── db.ts                   ← pg Client singleton
│   │   ├── redisClient.ts
│   │   ├── terminalExtractorService.ts
│   │   └── userCacheService.ts
│   └── controllers/
│       ├── store/
│       │   └── sessionStore.ts
│       └── *.ts                    ← one file per route handler
├── middleware/
│   └── silentReAuth.ts
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Setup

### 1. Copy environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in every value:

```env
END_POINT=https://nl.yoursite.corenio.com   # target Porza site
AUTH_CREDENTIALS=base64encodedcredentials    # Basic auth (base64 of user:pass)
API_KEY=your_corenio_api_key                 # Corenio REST API key
PG_HOST=localhost
PG_USER=postgres
PG_PASSWORD=password
PG_DB=coredata
PG_PORT=5432
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=                              # leave blank if no Redis password
MAX_TABS=3                                   # Puppeteer tab pool size
```

### 2. Install dependencies

```bash
npm install
```

> This will also download Chromium for Puppeteer automatically.

---

## Running

### Development (live reload with ts-node)

```bash
npm run dev
```

This uses `nodemon` + `ts-node` — no build step needed. The server restarts automatically on any `.ts` file change.

### Production (compile then run)

```bash
npm run build    # compiles TypeScript → dist/
npm start        # runs dist/server.js with Node
```

The compiled output lands in `dist/`. The `dist/src/server.js` file is the entry point, but `npm start` is already wired to the right path.

### Auto-rebuild on file change (alternative for production-like testing)

```bash
npm run dev:build
```

---

## Notes on top-level await

This project uses **ES module top-level `await`** (e.g., `await pgClient.connect()`, `await initTabPool()`). This is intentional — it matches the original JS project exactly and is fully supported in Node 20+ with `"module": "NodeNext"` in `tsconfig.json`.

If you see `ERR_REQUIRE_ESM` you are likely running with an older Node version or calling the file with `require()`. Use `node dist/src/server.js` directly, or `npm start`.

---

## TypeScript configuration highlights

| Option | Value | Why |
|--------|-------|-----|
| `target` | `ES2022` | Enables top-level await |
| `module` | `NodeNext` | Full ESM support with `.js` imports |
| `moduleResolution` | `NodeNext` | Resolves `.ts` → `.js` correctly |
| `strict` | `true` | Full type safety |

All internal imports use the `.js` extension (e.g. `import ... from "./db.js"`) — this is required for NodeNext ESM resolution and is correct TypeScript practice.

---

## Differences from the original JS project

| Area | Original JS | TypeScript version |
|------|-------------|-------------------|
| Language | Plain JS (ESM) | TypeScript (strict) |
| Types | None | Full interfaces in `src/types.ts` |
| Entry point | `server.js` | `src/server.ts` → compiled to `dist/src/server.js` |
| Start command | `nodemon server.js` | `npm run dev` (ts-node) or `npm start` (compiled) |
| `qs` dependency | Implicit (used in scraper) | Added to `package.json` explicitly |
| All logic | Unchanged | 100% preserved |

---

## Troubleshooting

**Puppeteer / Chromium fails to launch on Linux servers:**
```bash
# Install Chromium dependencies
sudo apt-get install -y libgbm-dev libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```

**Redis connection refused:**
Make sure Redis is running: `redis-server` or `sudo systemctl start redis`

**PostgreSQL connection refused:**
Make sure Postgres is running and the `PG_DB` database exists:
```bash
createdb coredata
```

**`ERR_UNKNOWN_FILE_EXTENSION` for `.ts` files:**
Make sure `ts-node` is installed (it's in `devDependencies`):
```bash
npm install
```
