FROM node:22-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ libsecret-1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/package.json
COPY server/vendor server/vendor
RUN pnpm install --frozen-lockfile
# @esun/trade loads keytar at module startup.  pnpm may otherwise leave its
# native addon unbuilt, which makes the installed SDK look like it is missing.
RUN pnpm rebuild keytar \
    && test -f /app/node_modules/.pnpm/keytar@7.9.0/node_modules/keytar/build/Release/keytar.node \
    && cd /app/server \
    && node -e "import('@esun/trade').then(() => console.log('ESUN_IMPORT_OK'))"

COPY . .
RUN pnpm build && pnpm --filter kau-ik-pro-server typecheck

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsecret-1-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    KAUIK_HOST=0.0.0.0 \
    KAUIK_DATA_DIR=/app/data

COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
# Keep the server source explicit: the runtime starts TypeScript through tsx.
# This also avoids any Docker directory-copy edge case dropping src/.
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/dist ./dist
RUN test -f /app/server/src/index.ts

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["./server/node_modules/.bin/tsx", "server/src/index.ts"]
