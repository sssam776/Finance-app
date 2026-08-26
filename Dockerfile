# better-sqlite3 is a native module, so the build stage needs a toolchain and
# the runtime stage must run the same base image and architecture — the
# compiled .node binary is copied across, not rebuilt.
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

EXPOSE 3000

# Migrations run here rather than as a Fly release_command because the release
# machine does not mount the volume, and this database only exists on it.
# Drizzle's migrator records what it has applied, so re-running on every boot
# is a no-op once the schema is current.
CMD ["sh", "-c", "npx tsx db/migrate.ts && npm run start"]
