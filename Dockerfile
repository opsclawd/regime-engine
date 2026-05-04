# ---- Build stage ----
FROM node:22-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0

COPY package.json pnpm-lock.yaml ./
COPY .npmrc ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
COPY scripts/ scripts/
COPY drizzle/ drizzle/
COPY drizzle.config.ts drizzle.config.ts

RUN pnpm run build

# ---- Production stage ----
FROM node:22-slim AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0

RUN groupadd --system app && useradd --system --gid app app

COPY package.json pnpm-lock.yaml ./
COPY .npmrc ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts/start.sh ./scripts/start.sh
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

RUN chmod +x scripts/start.sh

RUN mkdir -p /home/app/.cache && chown -R app:app /home/app

RUN mkdir -p /app/tmp && chown app:app /app/tmp

USER app

ENV NODE_ENV=production
ENV PORT=8787
ENV LEDGER_DB_PATH=tmp/ledger.sqlite
EXPOSE 8787

# --env-file-if-exists makes .env optional (won't crash if absent)
# For deployments that inject env vars directly (Docker -e, K8s env:), no .env is needed.
CMD ["bash", "scripts/start.sh"]