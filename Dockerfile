# One image, one process: the API serves the built frontend from the same
# origin, so /api/v1 needs no CORS and no proxy. Build with
#   docker build -t agricope-pos .
# and run with DATABASE_URL, JWT_SECRET and PIN_PEPPER in the environment.

# ---- the frontend, built for the real API (mocks OFF) ----
FROM node:22-alpine AS app
WORKDIR /build/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
ENV VITE_USE_MOCKS=false
RUN npm run build

# ---- the API, compiled, with only its runtime dependencies kept ----
FROM node:22-alpine AS api
WORKDIR /build/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/srv/public
WORKDIR /srv
COPY --from=api /build/api/package.json ./
COPY --from=api /build/api/node_modules ./node_modules
COPY --from=api /build/api/dist ./dist
COPY --from=api /build/api/migrations ./migrations
COPY --from=app /build/app/dist ./public
USER node
EXPOSE 8080
# Migrations are idempotent; running them at boot keeps a single-service
# deploy simple. Move them to a release step once more than one instance runs.
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/src/index.js"]
