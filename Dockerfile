# --- Build stage -------------------------------------------------------------
# Compiles TypeScript and generates the Prisma client. Everything installed here
# stays out of the final image.
FROM node:22-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate && pnpm run build

# Drop dev dependencies so only what the server actually needs is carried over.
RUN pnpm prune --prod


# --- Runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime

# Needed by the container healthcheck below.
RUN apk add --no-cache wget

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Run unprivileged: a process that never needs root should not have it. The
# node image already ships a `node` user, so no extra account is created.
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# Migrations run at startup so a deploy can never serve a schema the code does
# not expect. Exec form keeps node as PID 1, so it receives SIGTERM directly and
# the graceful shutdown in server.ts actually runs.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
