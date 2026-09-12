# syntax=docker/dockerfile:1

# ── Builder ──────────────────────────────────────────────────────────────
# Full dependency set (including devDependencies) so tsc is available.
# Debian-based (not alpine) — Puppeteer's bundled Chromium needs glibc and
# a specific set of shared libraries alpine's musl libc doesn't provide.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# This stage only runs tsc — it never launches a browser — so skip
# Puppeteer's Chromium download here entirely; it'd just slow the build
# down for a binary this stage's layers never ship (multi-stage build,
# only dist/ crosses into the runtime image below).
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# Puppeteer's bundled Chromium requires these shared libraries at runtime —
# a bare node:slim image is missing all of them. This list is Puppeteer's
# own documented Debian/Ubuntu dependency set.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
      libatk1.0-0 libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 \
      libgtk-3-0 libnspr4 libnss3 libwayland-client0 libxcomposite1 \
      libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Chromium is downloaded during `npm ci` below, which runs as root (before
# USER node is set) — default puppeteer cache lives under root's home
# directory, which the non-root runtime user below can't read. Redirect it
# to a path under /app instead, so the later `chown -R node:node /app`
# sweeps it up along with everything else.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled output + the static assets the app actually serves at runtime.
# Deliberately NOT copied: .env, *.pem (real secrets — mounted at deploy
# time instead, see k8s/base/*-secret.yaml), .git, tests, graphify-out.
COPY --from=builder /app/dist ./dist
COPY data ./data
COPY danger.html ./danger.html
COPY src/public ./src/public

# Runs as a non-root user — the base image's built-in "node" user/group.
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
