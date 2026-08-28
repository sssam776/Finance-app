# better-sqlite3 is a native module, so the build stage needs a toolchain and
# the runtime stage must run the same base image and architecture — the
# compiled .node binary is copied across, not rebuilt.
#
# That also means the image must be built on the machine it will run on when
# that machine is ARM. Oracle's Always Free tier is Ampere, so `docker compose
# up --build` on the VM is not laziness: an image built on an x86 laptop
# carries an x86 .node binary that will not load there.
FROM node:22-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Dev dependencies are kept deliberately: db/migrate.ts runs through tsx at
# container start, and pruning them would leave no way to apply a migration on
# a machine that owns the only copy of the database.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts

# Runs as the image's unprivileged `node` user rather than as root.
#
# /data is created and owned here so the named volume inherits that ownership
# when Docker first mounts it. A volume mounted over a directory the container
# cannot write to fails at the first migration, which is a confusing place to
# discover a permissions problem.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

# Distinguishes a container that is serving from one that started and wedged.
# Without it a hung process looks identical to a healthy one, which is exactly
# the failure that wasted time during development.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run here rather than as a Fly release_command because the release
# machine does not mount the volume, and this database only exists on it.
# Drizzle's migrator records what it has applied, so re-running on every boot
# is a no-op once the schema is current.
CMD ["sh", "-c", "npx tsx db/migrate.ts && npm run start"]
