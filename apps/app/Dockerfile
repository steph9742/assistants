FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS pruner
RUN bun add -g turbo
COPY . .
RUN turbo prune @assistants/app --docker

# Stage 2: Install and build
FROM base AS builder
# Copy pruned package.json(s) and lockfile
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock

# Install dependencies (incl. devDependencies: needed at build time, e.g.
# @iconify-json/lucide for @nuxt/icon's serverBundle. Runner only copies .output,
# so devDeps never reach the production image.)
# NB : sans --frozen-lockfile. Le lockfile a été réécrit sous pression disque et bun ne
# résout pas un tree identique dans le conteneur linux/arm64 (paquets optionnels par
# plateforme) → le mode figé échoue. Pour un outil interne, tolérer la résolution
# convient ; à re-figer une fois un lockfile propre committé.
RUN bun install

# Copy the rest of the pruned workspace
COPY --from=pruner /app/out/full/ .

# Build the Nuxt app in apps/app
RUN bun run --filter=@assistants/app build 

# Stage 3: Runner (production)
FROM oven/bun:1.3.14-alpine AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 assistants
RUN adduser --system --uid 1001 bunjs
USER bunjs

# Copy the built output from the builder stage
# The `.output` folder contains the compiled Nuxt server app
# We copy it into the runner. We might only need the .output folder for Nuxt production.
COPY --from=builder --chown=bunjs:assistants /app/apps/app/.output /app/.output

EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
# Tell Nuxt that we are running via bun, usually the preset is nitro 'bun' but it can run via node
CMD ["bun", "run", "/app/.output/server/index.mjs"]