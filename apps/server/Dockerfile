FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

# Stage 1: Prune workspace to only include @assistants/server dependencies
FROM base AS pruner
RUN bun add -g turbo
COPY . .
RUN turbo prune @assistants/server --docker

# Stage 2: Install dependencies
FROM base AS installer
# Copy pruned package.json(s) and lockfile
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock

# Install dependencies (including dev tools if needed)
RUN bun install --frozen-lockfile --production

# Copy the rest of the pruned workspace
COPY --from=pruner /app/out/full/ .

FROM installer AS builder
WORKDIR /app/apps/server

RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --outfile /app/server \
    src/index.ts && \
    bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --outfile /app/migrate \
    src/migrate.ts && \
    bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --outfile /app/seed \
    src/seed.ts && \
    bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --outfile /app/synchro \
    src/synchro.ts

# Stage 3: Runner
FROM oven/bun:1.3.14-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl

# Run as non-root user
RUN addgroup --system --gid 1001 assistants
RUN adduser --system --uid 1001 bunjs
USER bunjs

# Copy installed workspace
COPY --from=builder --chown=bunjs:assistants /app/server /app/server
COPY --from=builder --chown=bunjs:assistants /app/migrate /app/migrate
COPY --from=builder --chown=bunjs:assistants /app/seed /app/seed
COPY --from=builder --chown=bunjs:assistants /app/synchro /app/synchro
COPY --from=pruner --chown=bunjs:assistants /app/out/full/packages/database/src/migrations /app/migrations
ENV DRIZZLE_MIGRATIONS_FOLDER=/app/migrations

# Version deployee, exposee sur /health.
#
# Placee TOUT EN BAS a dessein : ces deux arguments changent a chaque construction, et
# chaque `ARG` invalide le cache des couches qui le suivent. Plus haut, ils feraient
# recompiler l'application entiere a chaque fois.
#
# Absents, /health rend « inconnue » — ce qui n'est PAS « ancienne » : une image montee a la
# main les porte aussi.
ARG GIT_COMMIT=inconnue
ARG BUILD_DATE=inconnue
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_DATE=$BUILD_DATE

EXPOSE 4000


CMD ["/app/server"]
