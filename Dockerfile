# ---- Build stage ----
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
COPY scripts/ scripts/

RUN npm run build

# ---- Production stage ----
FROM node:22-slim AS production

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Pre-create data directory writable by non-root user
RUN mkdir -p /app/tmp && chown app:app /app/tmp

USER app

ENV NODE_ENV=production
ENV PORT=8787
ENV LEDGER_DB_PATH=tmp/ledger.sqlite
EXPOSE 8787

# Optionally mount a .env file and load it via --env-file
CMD ["node", "--env-file=.env", "dist/src/server.js"]